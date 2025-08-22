import { sentryMonitoringService } from "../monitoring";
import { UnifiedTextExtractionService } from "../extraction";
import { TextCleaningService } from "../cleaning";
import { ChunkingService } from "../chunking";
import type {
    FileMetadata,
    ProcessedDocumentResult,
} from "../../types/document.types";

export class DocumentProcessingService {
    private textExtractionService: UnifiedTextExtractionService;
    private chunkingService: ChunkingService;

    constructor() {
        this.textExtractionService = new UnifiedTextExtractionService();
        this.chunkingService = new ChunkingService();
    }
    private async getFileMetadata(url: string): Promise<FileMetadata> {
        try {
            console.log(`🔍 Attempting to fetch metadata from: ${url}`);

            // Try HEAD request first (most efficient)
            let response: Response;
            try {
                response = await fetch(url, {
                    method: "HEAD",
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (compatible; DocumentProcessor/1.0)",
                    },
                });

                if (!response.ok) {
                    throw new Error(
                        `HEAD request failed: ${response.status} ${response.statusText}`
                    );
                }

                console.log(`✅ HEAD request successful for ${url}`);
            } catch (headError) {
                console.warn(
                    `⚠️ HEAD request failed, trying GET with range: ${headError}`
                );

                // Fallback: GET request with Range header to get minimal data
                try {
                    response = await fetch(url, {
                        method: "GET",
                        headers: {
                            Range: "bytes=0-0", // Request only first byte
                            "User-Agent":
                                "Mozilla/5.0 (compatible; DocumentProcessor/1.0)",
                        },
                    });

                    if (!response.ok && response.status !== 206) {
                        // 206 = Partial Content
                        throw new Error(
                            `GET with range failed: ${response.status} ${response.statusText}`
                        );
                    }

                    console.log(`✅ GET with range successful for ${url}`);
                } catch (rangeError) {
                    console.warn(
                        `⚠️ GET with range failed, trying simple GET: ${rangeError}`
                    );

                    // Final fallback: Simple GET request (less efficient but more compatible)
                    response = await fetch(url, {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (compatible; DocumentProcessor/1.0)",
                        },
                    });

                    if (!response.ok) {
                        throw new Error(
                            `All metadata fetch attempts failed. Final GET status: ${response.status} ${response.statusText}`
                        );
                    }

                    console.log(`✅ Simple GET successful for ${url}`);
                }
            }
            const metadata: FileMetadata = {
                url,
                contentLength:
                    response.headers.get("content-length") || undefined,
                contentType: response.headers.get("content-type") || undefined,
                lastModified:
                    response.headers.get("last-modified") || undefined,
                server: response.headers.get("server") || undefined,
            };

            console.log("📊 File Metadata:");
            console.log("🔗 URL:", url);
            console.log("📏 Content-Length:", metadata.contentLength);
            console.log("📄 Content-Type:", metadata.contentType);
            console.log("🕒 Last-Modified:", metadata.lastModified);
            console.log("🖥️ Server:", metadata.server);

            return metadata;
        } catch (error) {
            console.error("❌ Error fetching metadata:", error);

            // Return partial metadata even if fetch fails
            const fallbackMetadata: FileMetadata = {
                url,
                contentLength: "Unable to fetch",
                contentType: "Unable to fetch",
                lastModified: "Unable to fetch",
                server: "Unable to fetch",
            };

            console.warn("⚠️ Using fallback metadata due to fetch failure");
            return fallbackMetadata;
        }
    }

    /**
     * Detect document type based on file signature and filename
     */
    private detectDocumentType(
        buffer: Buffer,
        filename: string
    ): "pdf" | "docx" | "email" | "image" | "bin" | "zip" | "xlsx" | "pptx" {
        // Check file signatures (magic numbers) - very fast
        const header = buffer.subarray(0, 8);

        // PDF: %PDF
        if (header.subarray(0, 4).toString() === "%PDF") {
            return "pdf";
        }
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (
            header[0] === 0x89 &&
            header[1] === 0x50 &&
            header[2] === 0x4e &&
            header[3] === 0x47
        ) {
            return "image";
        }

        // JPEG: FF D8 FF
        if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
            return "image";
        }
        // DOCX: PK (ZIP signature) + check for specific DOCX structure
        if (header[0] === 0x50 && header[1] === 0x4b) {
            // Additional validation: check if it's a DOCX by looking for the content types
            const zipCheck = buffer.toString("utf8", 0, 300);
            if (
                zipCheck.includes("word/") ||
                zipCheck.includes(
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                )
            ) {
                return "docx";
            }
            if (
                zipCheck.includes("xl/") ||
                zipCheck.includes("worksheets/") ||
                zipCheck.includes(
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                )
            ) {
                return "xlsx";
            }
            if (
                zipCheck.includes("ppt/") ||
                zipCheck.includes("slides/") ||
                zipCheck.includes(
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                )
            ) {
                return "pptx";
            }

            // Check filename extension as fallback for Office documents
            if (filename.toLowerCase().endsWith(".docx")) {
                return "docx";
            }
            if (filename.toLowerCase().endsWith(".xlsx")) {
                return "xlsx";
            }
            if (filename.toLowerCase().endsWith(".pptx")) {
                return "pptx";
            }

            // If it's a ZIP but not DOCX/XLSX/PPTX, treat as zip
            return "zip";
        }

        // Email: Check for common email headers or file extensions
        const content = buffer.toString("utf8", 0, 500).toLowerCase();
        if (
            filename.toLowerCase().match(/\.(eml|msg)$/) ||
            content.includes("from:") ||
            content.includes("to:") ||
            content.includes("subject:")
        ) {
            return "email";
        }

        // Fallback to filename extension
        const ext = filename.toLowerCase();
        if (ext.endsWith(".pdf")) return "pdf";
        if (ext.endsWith(".docx")) return "docx";
        if (ext.endsWith(".xlsx")) return "xlsx";
        if (ext.endsWith(".pptx")) return "pptx";
        if (ext.endsWith(".eml") || ext.endsWith(".msg")) return "email";

        throw new Error(`Unsupported document type: ${filename}`);
    }
    /**
     * Process URL-based files (.bin, .zip) by fetching metadata only
     */
    async processUrlFile(url: string): Promise<ProcessedDocumentResult> {
        try {
            // Extract filename from URL and remove query parameters
            const urlPath = url.split("?")[0]; // Remove query parameters first
            const filename = urlPath?.split("/").pop() || "unknown-file";

            // Detect document type from URL
            let docType: "bin" | "zip";
            if (filename.toLowerCase().endsWith(".bin")) {
                docType = "bin";
            } else if (filename.toLowerCase().endsWith(".zip")) {
                docType = "zip";
            } else {
                throw new Error(`Unsupported URL file type: ${filename}`);
            }

            console.log(`🔍 Processing URL file: ${docType} for ${filename}`);

            // Fetch metadata instead of downloading the file
            const metadata = await sentryMonitoringService.track(
                "url_metadata_fetch",
                "extraction",
                {
                    url,
                    document_type: docType,
                    filename,
                },
                async () => this.getFileMetadata(url),
                {
                    component: "url_processing",
                    operation: "metadata_fetch",
                }
            );

            // Create a summary content based on metadata
            const isMetadataAvailable =
                metadata.contentLength !== "Unable to fetch";

            let content: string;
            if (isMetadataAvailable) {
                content = `File: ${filename}
URL: ${url}
Type: ${docType.toUpperCase()}
Content-Length: ${metadata.contentLength || "Unknown"}
Content-Type: ${metadata.contentType || "Unknown"}
Last-Modified: ${metadata.lastModified || "Unknown"}
Server: ${metadata.server || "Unknown"}

Analysis: This is a ${docType.toUpperCase()} file accessible via URL. The file metadata has been successfully retrieved.`;
            } else {
                // Provide more context when metadata fetch fails
                content = `File: ${filename}
URL: ${url}
Type: ${docType.toUpperCase()}
Status: File exists at the provided URL but detailed metadata could not be retrieved.

Analysis: This is a ${docType.toUpperCase()} file. The server hosting this file may have restrictions on metadata requests (HEAD/Range requests), which is common for:
- Speed test files (like Hetzner speed test files)
- Download servers with CORS restrictions
- Servers that only support simple GET requests

The file is likely accessible for download but cannot provide detailed metadata information such as file size, content type, or modification dates through automated requests.`;
            }

            console.log(
                `✅ ${docType.toUpperCase()} URL processing complete: ${
                    isMetadataAvailable
                        ? "Metadata fetched"
                        : "Fallback content generated"
                } for ${filename}`
            );

            return {
                filename,
                documentType: docType,
                totalPages: 0, // No pages for URL files
                content,
                chunks: [], // No chunks for URL files
                metadata,
            };
        } catch (error) {
            console.error(`❌ Error processing URL file ${url}:`, error);
            throw new Error(
                `Failed to process URL file: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`
            );
        }
    }

    async processDocument(
        buffer: Buffer,
        filename: string
    ): Promise<ProcessedDocumentResult> {
        try {
            // Detect document type
            const docType = this.detectDocumentType(buffer, filename);
            console.log(
                `🔍 Detected document type: ${docType} for ${filename}`
            );

            // Handle URL-based files (.bin, .zip) differently
            // Note: .xlsx, .docx, and .pptx files should be processed normally, not as URL-based files
            if (
                docType === "bin" ||
                (docType === "zip" &&
                    !filename.toLowerCase().endsWith(".xlsx") &&
                    !filename.toLowerCase().endsWith(".docx") &&
                    !filename.toLowerCase().endsWith(".pptx"))
            ) {
                throw new Error(
                    `Use processUrlFile() method for ${docType} files instead`
                );
            }

            // If it's detected as zip but it's actually an Office document, correct the type
            let processType:
                | "pdf"
                | "docx"
                | "email"
                | "image"
                | "xlsx"
                | "pptx";
            if (docType === "zip") {
                if (filename.toLowerCase().endsWith(".xlsx")) {
                    processType = "xlsx";
                } else if (filename.toLowerCase().endsWith(".docx")) {
                    processType = "docx";
                } else if (filename.toLowerCase().endsWith(".pptx")) {
                    processType = "pptx";
                } else {
                    processType = "xlsx"; // Default fallback for other zip files that got through
                }
            } else if (docType === "pptx") {
                processType = "pptx";
            } else {
                processType = docType as
                    | "pdf"
                    | "docx"
                    | "email"
                    | "image"
                    | "xlsx"
                    | "pptx";
            }

            // Extract text based on document type
            const extractionResult =
                await this.textExtractionService.extractFromDocument(
                    buffer,
                    filename,
                    processType
                );

            // Clean extracted text before chunking (skip for PPTX as Python service already cleans)
            const cleanedPageTexts = await sentryMonitoringService.track(
                "text_cleaning",
                "extraction",
                {
                    total_pages: extractionResult.totalPages,
                    original_length: extractionResult.fullText.length,
                    extraction_method: extractionResult.method,
                    library_used: extractionResult.library,
                    extraction_time: extractionResult.extractionTime,
                    performance: extractionResult.performance,
                    document_type: docType,
                },
                async () => {
                    if (processType === "pptx") {
                        // PPTX text is already cleaned by Python OCR service - skip redundant cleaning
                        console.log(
                            "📄 Skipping text cleaning for PPTX (already cleaned by Python service)"
                        );
                        return {
                            pageTexts: extractionResult.pageTexts,
                            fullText: extractionResult.fullText,
                        };
                    }

                    // Apply enhanced text cleaning with prompt injection protection for documents
                    console.log(
                        `🛡️ Applying enhanced text cleaning with security protection for Azure...`
                    );

                    const sanitizationResults =
                        TextCleaningService.sanitizeForAI(
                            extractionResult.fullText,
                            "document",
                            {
                                maxRiskScore: 25, // Very strict for Azure content policy
                                enableStrictMode: true, // Enable strict mode for Azure
                            }
                        );

                    // Apply enhanced cleaning to individual pages as well with strict settings
                    const cleanedPages = TextCleaningService.cleanPageTexts(
                        extractionResult.pageTexts,
                        {
                            enablePromptInjectionProtection: true,
                            strictSanitization: true, // Always use strict sanitization for Azure
                        }
                    );

                    // Log cleaning and security statistics
                    const stats = TextCleaningService.getCleaningStats(
                        extractionResult.fullText,
                        sanitizationResults.sanitizedContent
                    );

                    console.log(
                        `🧹 Text cleaning stats: Reduced from ${stats.originalLength} to ${stats.cleanedLength} characters (${stats.reductionPercent} reduction)`
                    );

                    console.log(`🛡️ Security report:`, {
                        initialRisk:
                            sanitizationResults.securityReport.initialRiskScore,
                        finalRisk:
                            sanitizationResults.securityReport.finalRiskScore,
                        riskReduction: `${sanitizationResults.securityReport.riskReduction.toFixed(
                            1
                        )}%`,
                        isSafe: sanitizationResults.securityReport.isSafe,
                        appliedFilters:
                            sanitizationResults.securityReport.appliedFilters,
                    });

                    if (
                        sanitizationResults.securityReport.recommendations
                            .length > 0
                    ) {
                        console.warn(
                            `📋 Security recommendations:`,
                            sanitizationResults.securityReport.recommendations
                        );
                    }

                    // Debug: Show a sample of the original vs sanitized content if there was high risk
                    if (
                        sanitizationResults.securityReport.initialRiskScore > 30
                    ) {
                        console.warn(
                            `🚨 High-risk content detected in document:`,
                            {
                                originalContentSample:
                                    extractionResult.fullText.substring(
                                        0,
                                        500
                                    ) + "...",
                                sanitizedContentSample:
                                    sanitizationResults.sanitizedContent.substring(
                                        0,
                                        500
                                    ) + "...",
                                contentLength: extractionResult.fullText.length,
                                sanitizedLength:
                                    sanitizationResults.sanitizedContent.length,
                            }
                        );
                    }

                    return {
                        pageTexts: cleanedPages,
                        fullText: sanitizationResults.sanitizedContent,
                    };
                },
                {
                    component: "text_processing",
                    operation: "text_cleaning",
                }
            );

            // Create chunks from cleaned text
            const chunks = await sentryMonitoringService.track(
                "document_chunking",
                "chunking",
                {
                    total_pages: extractionResult.totalPages,
                    total_characters: cleanedPageTexts.fullText.length,
                    chunking_method: "page-wise",
                    document_type: docType,
                },
                async () =>
                    await this.chunkingService.createChunks(
                        cleanedPageTexts.pageTexts,
                        cleanedPageTexts.fullText,
                        filename
                    ),
                {
                    component: "text_processing",
                }
            );

            console.log(
                `✅ ${docType.toUpperCase()} processing complete: ${
                    chunks.length
                } chunks ready for in-memory processing`
            );

            return {
                filename,
                documentType: docType,
                totalPages: extractionResult.totalPages,
                content: cleanedPageTexts.fullText,
                chunks,
            };
        } catch (error) {
            console.error(`❌ Error processing document ${filename}:`, error);
            throw new Error(
                `Failed to process document: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`
            );
        }
    }

    /**
     * Legacy method for backward compatibility
     */
    async processPDF(
        pdfBuffer: Buffer,
        filename: string
    ): Promise<ProcessedDocumentResult> {
        return this.processDocument(pdfBuffer, filename);
    }
}
