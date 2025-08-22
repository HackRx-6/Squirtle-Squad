import { sentryMonitoringService } from "../monitoring";
import { TextCleaningService } from "../cleaning";
import type { UnifiedExtractionResult } from "./index";
import type { PptxPythonResponse } from "./types";

export class PptxExtractionService {
    private readonly MAX_TOKENS_PER_CHUNK = 1000; // Safe limit for embeddings (~4000 chars)
    private readonly MIN_TOKENS_PER_CHUNK = 200; // Minimum tokens to maintain context
    private readonly OVERLAP_SENTENCES = 2; // Number of sentences to overlap between chunks
    private readonly PYTHON_SERVICE_URL =
        process.env.PDF_SERVICE_URL || "http://localhost:8000"; // Use same env var as PDF service
    private readonly SERVICE_TIMEOUT = 10000; // 10 seconds timeout

    /**
     * Split PPTX text into semantic chunks based on slides and content structure
     * This maintains semantic meaning and context better than character-based chunking
     */
    private splitIntoSemanticChunks(text: string): string[] {
        // Rough token estimation: 1 token ≈ 4 characters
        const estimateTokens = (text: string): number =>
            Math.ceil(text.length / 4);

        if (estimateTokens(text) <= this.MAX_TOKENS_PER_CHUNK) {
            return [text];
        }

        const chunks: string[] = [];

        // First, split by slides (typically separated by double newlines in OCR output)
        const slides = text
            .split(/\n\s*\n/)
            .filter((slide) => slide.trim().length > 0);

        let currentChunk = "";
        let previousContent: string[] = []; // For overlap between chunks

        for (const slide of slides) {
            // Split slide content into sentences
            const sentences = this.splitIntoSentences(slide);

            for (const sentence of sentences) {
                const sentenceTokens = estimateTokens(sentence);
                const currentChunkTokens = estimateTokens(currentChunk);

                // Check if adding this sentence would exceed the token limit
                if (
                    currentChunkTokens + sentenceTokens >
                        this.MAX_TOKENS_PER_CHUNK &&
                    currentChunk.length > 0
                ) {
                    // Current chunk is full, save it and start a new one
                    if (
                        estimateTokens(currentChunk) >=
                        this.MIN_TOKENS_PER_CHUNK
                    ) {
                        chunks.push(currentChunk.trim());

                        // Start new chunk with overlap from previous content
                        const overlapText = previousContent
                            .slice(-this.OVERLAP_SENTENCES)
                            .join(" ");
                        currentChunk = overlapText
                            ? overlapText + " " + sentence
                            : sentence;
                        previousContent = [sentence];
                    } else {
                        // Current chunk is too small, add sentence anyway
                        currentChunk +=
                            (currentChunk.length > 0 ? " " : "") + sentence;
                        previousContent.push(sentence);
                    }
                } else {
                    // Add sentence to current chunk
                    currentChunk +=
                        (currentChunk.length > 0 ? " " : "") + sentence;
                    previousContent.push(sentence);

                    // Keep only recent content for overlap
                    if (previousContent.length > this.OVERLAP_SENTENCES * 2) {
                        previousContent = previousContent.slice(
                            -this.OVERLAP_SENTENCES * 2
                        );
                    }
                }
            }

            // Add slide break after processing all sentences in the slide
            if (currentChunk.length > 0 && !currentChunk.endsWith("\n")) {
                currentChunk += "\n\n";
            }
        }

        // Add the last chunk if it has content
        if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim());
        }

        // If we ended up with no chunks (shouldn't happen), return original text
        if (chunks.length === 0) {
            chunks.push(text);
        }

        return chunks;
    }

    /**
     * Split text into sentences using multiple delimiters
     * Handles common sentence endings and abbreviations
     */
    private splitIntoSentences(text: string): string[] {
        // Common abbreviations that shouldn't trigger sentence splits
        const abbreviations = new Set([
            "dr",
            "mr",
            "mrs",
            "ms",
            "prof",
            "inc",
            "ltd",
            "corp",
            "co",
            "vs",
            "etc",
            "i.e",
            "e.g",
            "ca",
            "approx",
            "est",
            "fig",
            "no",
        ]);

        // Split on sentence endings, but be careful with abbreviations
        const sentences: string[] = [];
        const parts = text.split(/([.!?]+\s+)/);

        let currentSentence = "";

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part) continue; // Skip undefined/empty parts

            currentSentence += part;

            // Check if this might be the end of a sentence
            if (/[.!?]+\s+/.test(part) && i < parts.length - 1) {
                // Look at the word before the punctuation to check for abbreviations
                const words = currentSentence.split(/\s+/);
                const beforePunct =
                    words.length >= 2 ? words[words.length - 2] : "";
                const isAbbreviation =
                    beforePunct &&
                    abbreviations.has(
                        beforePunct.toLowerCase().replace(/\.$/, "")
                    );

                if (!isAbbreviation) {
                    // This looks like a real sentence ending
                    sentences.push(currentSentence.trim());
                    currentSentence = "";
                }
            }
        }

        // Add any remaining text as the last sentence
        if (currentSentence.trim().length > 0) {
            sentences.push(currentSentence.trim());
        }

        return sentences.filter((s) => s.length > 0);
    }

    /**
     * Call Python service to extract text from PPTX
     */
    private async callPythonService(
        buffer: Buffer,
        filename: string
    ): Promise<PptxPythonResponse> {
        return await sentryMonitoringService.track(
            "pptx_python_service_call",
            "extraction",
            {
                filename,
                file_size_bytes: buffer.length,
                service_url: this.PYTHON_SERVICE_URL,
            },
            async () => {
                try {
                    console.log(
                        `🐍 Calling Python service for PPTX extraction: ${filename}`
                    );

                    const formData = new FormData();
                    const blob = new Blob([buffer], {
                        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    });
                    formData.append("file", blob, filename);

                    const response = await fetch(
                        `${this.PYTHON_SERVICE_URL}/process-pptx`,
                        {
                            method: "POST",
                            body: formData,
                        }
                    );

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(
                            `Python service error (${response.status}): ${errorText}`
                        );
                    }

                    const result =
                        (await response.json()) as PptxPythonResponse;

                    if (!result.success) {
                        throw new Error(
                            `Python service returned failure for ${filename}`
                        );
                    }

                    console.log(
                        `✅ Python service response: ${result.pages.length} pages, ${result.metadata.total_characters} chars`
                    );

                    return result;
                } catch (error) {
                    console.error(
                        `❌ Error calling Python service for ${filename}:`,
                        error
                    );
                    throw new Error(
                        `Failed to call Python PPTX extraction service: ${
                            error instanceof Error
                                ? error.message
                                : "Unknown error"
                        }`
                    );
                }
            }
        );
    }

    /**
     * Check if Python service is available
     */
    async checkPythonServiceHealth(): Promise<boolean> {
        return await sentryMonitoringService.track(
            "pptx_python_health_check",
            "extraction",
            {
                service_url: this.PYTHON_SERVICE_URL,
            },
            async () => {
                try {
                    const response = await fetch(
                        `${this.PYTHON_SERVICE_URL}/health`,
                        {
                            method: "GET",
                            headers: {
                                Accept: "application/json",
                            },
                        }
                    );

                    if (response.ok) {
                        const health = (await response.json()) as {
                            status: string;
                        };
                        console.log("🐍 Python service health check:", health);
                        return health.status === "healthy";
                    }

                    return false;
                } catch (error) {
                    console.error(
                        "❌ Python service health check failed:",
                        error
                    );
                    return false;
                }
            }
        );
    }

    async extractFromPptx(
        buffer: Buffer,
        filename: string
    ): Promise<UnifiedExtractionResult> {
        return await sentryMonitoringService.track(
            "pptx_extraction",
            "extraction",
            {
                filename,
                file_size_bytes: buffer.length,
                file_size_mb: (buffer.length / 1024 / 1024).toFixed(2),
            },
            async () => {
                const startTime = Date.now();

                try {
                    console.log(
                        `🎯 Starting PPTX extraction for ${filename} (${buffer.length} bytes)`
                    );

                    // Check if Python service is available
                    const isServiceHealthy =
                        await this.checkPythonServiceHealth();
                    if (!isServiceHealthy) {
                        throw new Error(
                            "Python PPTX extraction service is not available or unhealthy"
                        );
                    }

                    // Call Python service for PPTX processing
                    const pythonResult = await this.callPythonService(
                        buffer,
                        filename
                    );
                    const extractionTime = pythonResult.processing_time_seconds;

                    // Extract text from pages
                    const pageTexts = pythonResult.pages.map(
                        (page) => page.text
                    );
                    const fullText = pageTexts.join("\n\n");

                    console.log(
                        `📊 PPTX extraction result - ${pythonResult.pages.length} pages, ${pythonResult.metadata.total_characters} characters`
                    );

                    console.log(
                        `🧹 Applying enhanced cleaning with prompt injection protection...`
                    );

                    // Apply comprehensive sanitization for AI processing with prompt injection protection
                    const sanitizationResult =
                        TextCleaningService.sanitizeForAI(fullText, "pptx", {
                            maxRiskScore: 40,
                            enableStrictMode: false,
                        });

                    const cleanedText = sanitizationResult.sanitizedContent;

                    // Log security report
                    if (
                        sanitizationResult.securityReport.initialRiskScore > 25
                    ) {
                        console.warn(`🚨 PPTX security report:`, {
                            filename,
                            initialRisk:
                                sanitizationResult.securityReport
                                    .initialRiskScore,
                            finalRisk:
                                sanitizationResult.securityReport
                                    .finalRiskScore,
                            riskReduction: `${sanitizationResult.securityReport.riskReduction.toFixed(
                                1
                            )}%`,
                            isSafe: sanitizationResult.securityReport.isSafe,
                            appliedFilters:
                                sanitizationResult.securityReport
                                    .appliedFilters,
                        });
                    }

                    // Split PPTX text into semantic chunks for proper token management
                    // This maintains semantic meaning while preventing embedding token limits
                    const semanticChunks =
                        this.splitIntoSemanticChunks(cleanedText);

                    console.log(
                        `🎯 Split PPTX into ${semanticChunks.length} semantic chunks`
                    );
                    console.log(
                        `📊 Chunk sizes (tokens): ${semanticChunks
                            .map((chunk) => Math.ceil(chunk.length / 4))
                            .join(", ")}`
                    );

                    const performance = {
                        pages_per_second:
                            semanticChunks.length / extractionTime,
                        characters_extracted: cleanedText.length,
                        average_chars_per_page: Math.round(
                            cleanedText.length / semanticChunks.length
                        ),
                    };

                    // Log extraction performance
                    console.log(
                        `🎯 PPTX Extraction Performance: ${performance.pages_per_second.toFixed(
                            1
                        )} chunks/sec, ${
                            performance.characters_extracted
                        } chars, avg ${
                            performance.average_chars_per_page
                        } chars/chunk`
                    );

                    return {
                        fullText: cleanedText,
                        pageTexts: semanticChunks, // Use the semantic chunks
                        totalPages: semanticChunks.length, // Actual number of semantic chunks
                        extractionTime,
                        library: "pptx-python-ocr",
                        method: "pptx" as any, // Extending the type
                        performance,
                    };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    console.error(
                        `❌ PPTX extraction failed for ${filename}:`,
                        errorMessage
                    );

                    // Try fallback extraction method or return empty result
                    console.log(
                        `🔄 Attempting fallback extraction for ${filename}...`
                    );

                    try {
                        // Fallback: Return minimal structure with error indication
                        const fallbackText = `[PPTX extraction failed: ${errorMessage}. File may be corrupted or Python service unavailable.]`;

                        return {
                            fullText: fallbackText,
                            pageTexts: [fallbackText],
                            totalPages: 1,
                            extractionTime: (Date.now() - startTime) / 1000,
                            library: "pptx-fallback",
                            method: "pptx" as any,
                            performance: {
                                pages_per_second: 0,
                                characters_extracted: fallbackText.length,
                                average_chars_per_page: fallbackText.length,
                            },
                        };
                    } catch (fallbackError) {
                        throw new Error(
                            `Failed to extract text from PPTX file ${filename}: ${errorMessage}`
                        );
                    }
                }
            }
        );
    }
}
