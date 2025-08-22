import { AppConfigService } from "../../config/app.config";
import { sentryMonitoringService } from "../monitoring";
import { TextCleaningService } from "../cleaning";
import type { PdfExtractionResult } from "./types";

export class PythonPdfExtractionService {
    private configService: AppConfigService;
    private pdfServiceUrl: string;
    private serviceTimeout: number;

    constructor() {
        this.configService = AppConfigService.getInstance();
        const config = this.configService.getQAConfig().textExtraction;
        this.pdfServiceUrl = config.pythonService.url;
        this.serviceTimeout = config.pythonService.timeout;
        console.log(`🐍 Python PDF Service Configuration:`);
        console.log(`   URL: ${this.pdfServiceUrl}`);
        console.log(`   Timeout: ${this.serviceTimeout}ms`);
    }

    /**
     * Extract text from PDF using Python microservice
     */
    async extractTextFromPdf(
        pdfBuffer: Buffer,
        filename: string
    ): Promise<{
        text: string;
        pages: Array<{ pageNumber: number; text: string }>;
        metadata: any;
        processingTime: number;
    }> {
        return await sentryMonitoringService.track(
            "python_pdf_text_extraction",
            "extraction",
            {
                filename,
                file_size_bytes: pdfBuffer.length,
                file_size_mb: (pdfBuffer.length / 1024 / 1024).toFixed(2),
                service_url: this.pdfServiceUrl,
            },
            async () => {
                const startTime = Date.now();

                try {
                    // Ultra-fast FormData creation
                    const formData = new FormData();
                    formData.append(
                        "file",
                        new Blob([pdfBuffer], { type: "application/pdf" }),
                        filename
                    );

                    // Optimized fetch with configurable timeout
                    const controller = new AbortController();
                    const timeoutId = setTimeout(
                        () => controller.abort(),
                        this.serviceTimeout
                    );

                    const response = await fetch(
                        `${this.pdfServiceUrl}/extract-text`,
                        {
                            method: "POST",
                            body: formData,
                            signal: controller.signal,
                            keepalive: true, // Reuse connections
                        }
                    );

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(
                            `Python PDF service error (${response.status}): ${errorText}`
                        );
                    }

                    const result =
                        (await response.json()) as PdfExtractionResult;

                    if (!result.success) {
                        throw new Error(
                            "Python PDF service returned unsuccessful result"
                        );
                    }

                    // Transform Python service response to match existing interface with sanitization
                    const pages = result.pages.map((page) => {
                        // Sanitize each page text for security
                        const sanitizationResult =
                            TextCleaningService.sanitizeForAI(
                                page.text,
                                "pdf",
                                { maxRiskScore: 50, enableStrictMode: false }
                            );

                        // Log security issues if detected
                        if (!sanitizationResult.securityReport.isSafe) {
                            console.warn(
                                `🚨 Security risks detected in PDF page ${page.page_number}:`,
                                {
                                    filename,
                                    pageNumber: page.page_number,
                                    initialRisk:
                                        sanitizationResult.securityReport
                                            .initialRiskScore,
                                    finalRisk:
                                        sanitizationResult.securityReport
                                            .finalRiskScore,
                                    appliedFilters:
                                        sanitizationResult.securityReport
                                            .appliedFilters,
                                }
                            );
                        }

                        return {
                            pageNumber: page.page_number,
                            text: sanitizationResult.sanitizedContent,
                        };
                    });

                    // Combine all sanitized page texts
                    const fullText = pages
                        .map((page) => page.text)
                        .join("\n\n");

                    const totalTime = Date.now() - startTime;

                    // Minimal logging for speed

                    return {
                        text: fullText,
                        pages: pages,
                        metadata: {
                            totalPages: result.metadata.total_pages,
                            totalCharacters: result.metadata.total_characters,
                            title: result.metadata.title,
                            author: result.metadata.author,
                            subject: result.metadata.subject,
                            creator: result.metadata.creator,
                            producer: result.metadata.producer,
                            creationDate: result.metadata.creation_date,
                            modificationDate: result.metadata.modification_date,
                            extractionMethod: result.extraction_method,
                        },
                        processingTime: totalTime,
                    };
                } catch (error) {
                    // Fast error handling - no logging
                    throw error;
                }
            }
        );
    }

    /**
     * Check if Python PDF service is healthy
     */
    async checkHealth(): Promise<boolean> {
        return await sentryMonitoringService.track(
            "python_pdf_health_check",
            "extraction",
            {
                service_url: this.pdfServiceUrl,
            },
            async () => {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(
                        () => controller.abort(),
                        Math.min(this.serviceTimeout / 2, 5000)
                    ); // Use half timeout for health check, max 5s

                    const response = await fetch(
                        `${this.pdfServiceUrl}/health`,
                        {
                            method: "GET",
                            signal: controller.signal,
                        }
                    );

                    clearTimeout(timeoutId);

                    if (response.ok) {
                        const health = (await response.json()) as {
                            status: string;
                        };
                        console.log(
                            `🐍 Python PDF service health: ${health.status}`
                        );
                        return health.status === "healthy";
                    }

                    return false;
                } catch (error) {
                    console.error(
                        `❌ Python PDF service health check failed:`,
                        error
                    );
                    return false;
                }
            }
        );
    }

    /**
     * Get service information
     */
    getServiceInfo(): { url: string; enabled: boolean } {
        return {
            url: this.pdfServiceUrl,
            enabled: !!this.pdfServiceUrl,
        };
    }
}
