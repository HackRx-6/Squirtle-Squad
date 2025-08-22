import { parseOfficeAsync } from "officeparser";
import { sentryMonitoringService } from "../monitoring";
import { TextCleaningService } from "../cleaning";
import type { UnifiedExtractionResult } from "./index";

export class DocxExtractionService {
    private readonly MAX_TOKENS_PER_CHUNK = 1000; // Safe limit for embeddings (~4000 chars)
    private readonly MIN_TOKENS_PER_CHUNK = 200; // Minimum tokens to maintain context
    private readonly OVERLAP_SENTENCES = 2; // Number of sentences to overlap between chunks

    /**
     * Split DOCX text into semantic chunks based on sentences and paragraphs
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

        // First, split by paragraphs (double newlines)
        const paragraphs = text
            .split(/\n\s*\n/)
            .filter((p) => p.trim().length > 0);

        let currentChunk = "";
        let previousSentences: string[] = []; // For overlap between chunks

        for (const paragraph of paragraphs) {
            // Split paragraph into sentences
            const sentences = this.splitIntoSentences(paragraph);

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

                        // Start new chunk with overlap from previous sentences
                        const overlapText = previousSentences
                            .slice(-this.OVERLAP_SENTENCES)
                            .join(" ");
                        currentChunk = overlapText
                            ? overlapText + " " + sentence
                            : sentence;
                        previousSentences = [sentence];
                    } else {
                        // Current chunk is too small, add sentence anyway
                        currentChunk +=
                            (currentChunk.length > 0 ? " " : "") + sentence;
                        previousSentences.push(sentence);
                    }
                } else {
                    // Add sentence to current chunk
                    currentChunk +=
                        (currentChunk.length > 0 ? " " : "") + sentence;
                    previousSentences.push(sentence);

                    // Keep only recent sentences for overlap
                    if (previousSentences.length > this.OVERLAP_SENTENCES * 2) {
                        previousSentences = previousSentences.slice(
                            -this.OVERLAP_SENTENCES * 2
                        );
                    }
                }
            }

            // Add paragraph break after processing all sentences in the paragraph
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

    async extractFromDocx(
        buffer: Buffer,
        filename: string
    ): Promise<UnifiedExtractionResult> {
        const startTime = Date.now();

        try {
            console.log(
                `🔍 Starting DOCX extraction for ${filename} (${buffer.length} bytes)`
            );

            // Extract text using officeparser
            const result = await parseOfficeAsync(buffer);
            const extractionTime = (Date.now() - startTime) / 1000;

            console.log(
                `📊 officeparser result - Type: ${typeof result}, Length: ${
                    result?.length || "N/A"
                }`
            );

            // Validate extraction result
            if (result === undefined || result === null) {
                throw new Error(
                    "officeparser returned undefined/null - the DOCX file may be corrupted or not a valid DOCX format"
                );
            }

            if (typeof result !== "string") {
                console.warn(
                    `⚠️ officeparser returned unexpected type: ${typeof result}`,
                    result
                );
                // Try to convert to string if possible
                const textStr = String(result);
                if (!textStr || textStr === "undefined" || textStr === "null") {
                    throw new Error(
                        `officeparser returned invalid data type: ${typeof result}`
                    );
                }
            }

            // Ensure we have a string to work with
            const textString =
                typeof result === "string" ? result : String(result);

            console.log(
                `🧹 Applying enhanced cleaning with prompt injection protection...`
            );

            // Apply comprehensive sanitization for AI processing with prompt injection protection
            const sanitizationResult = TextCleaningService.sanitizeForAI(
                textString,
                "docx",
                {
                    maxRiskScore: 40,
                    enableStrictMode: false,
                }
            );

            const cleanedText = sanitizationResult.sanitizedContent;

            // Log security report
            if (sanitizationResult.securityReport.initialRiskScore > 25) {
                console.warn(`🚨 DOCX security report:`, {
                    filename,
                    initialRisk:
                        sanitizationResult.securityReport.initialRiskScore,
                    finalRisk: sanitizationResult.securityReport.finalRiskScore,
                    riskReduction: `${sanitizationResult.securityReport.riskReduction.toFixed(
                        1
                    )}%`,
                    isSafe: sanitizationResult.securityReport.isSafe,
                    appliedFilters:
                        sanitizationResult.securityReport.appliedFilters,
                });
            }

            // Split DOCX text into semantic chunks for proper token management
            // This maintains semantic meaning while preventing embedding token limits
            const pageTexts = this.splitIntoSemanticChunks(cleanedText);

            console.log(
                `📄 Split DOCX into ${pageTexts.length} semantic chunks`
            );
            console.log(
                `📊 Chunk sizes (tokens): ${pageTexts
                    .map((chunk) => Math.ceil(chunk.length / 4))
                    .join(", ")}`
            );

            const performance = {
                pages_per_second: pageTexts.length / extractionTime,
                characters_extracted: cleanedText.length,
                average_chars_per_page: Math.round(
                    cleanedText.length / pageTexts.length
                ),
            };

            // Log extraction performance
            console.log(
                `📄 DOCX Extraction Performance: ${performance.pages_per_second.toFixed(
                    1
                )} chunks/sec, ${performance.characters_extracted} chars, avg ${
                    performance.average_chars_per_page
                } chars/chunk`
            );

            return {
                fullText: cleanedText,
                pageTexts: pageTexts, // Use the semantic chunks
                totalPages: pageTexts.length, // Actual number of semantic chunks
                extractionTime,
                library: "officeparser",
                method: "docx" as any, // Extending the type
                performance,
            };
        } catch (error) {
            // Capture error with Sentry monitoring service
            sentryMonitoringService.captureError(error as Error, {
                name: "docx_extraction",
                filename,
                extraction_time: (Date.now() - startTime) / 1000,
            });

            const errorMessage =
                error instanceof Error ? error.message : String(error);
            console.error(
                `❌ DOCX extraction failed for ${filename}:`,
                errorMessage
            );

            // Try alternative extraction method or return empty result
            console.log(`🔄 Attempting fallback extraction for ${filename}...`);

            try {
                // Fallback: Return minimal structure with error indication
                const fallbackText = `[DOCX extraction failed: ${errorMessage}. File may be corrupted or not a valid DOCX format.]`;

                return {
                    fullText: fallbackText,
                    pageTexts: [fallbackText],
                    totalPages: 1,
                    extractionTime: (Date.now() - startTime) / 1000,
                    library: "officeparser (fallback)",
                    method: "docx" as any,
                    performance: {
                        pages_per_second: 0,
                        characters_extracted: fallbackText.length,
                        average_chars_per_page: fallbackText.length,
                    },
                };
            } catch (fallbackError) {
                throw new Error(
                    `Failed to extract text from DOCX file ${filename}: ${errorMessage}`
                );
            }
        }
    }
}
