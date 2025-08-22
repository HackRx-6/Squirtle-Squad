import { parseOfficeAsync } from "officeparser";
import { sentryMonitoringService } from "../monitoring";
import { TextCleaningService } from "../cleaning";
import type { UnifiedExtractionResult } from "./index";

export class XlsxExtractionService {
    private readonly MAX_TOKENS_PER_CHUNK = 1000; // Safe limit for embeddings (~4000 chars)
    private readonly MIN_TOKENS_PER_CHUNK = 200; // Minimum tokens to maintain context
    private readonly OVERLAP_ROWS = 2; // Number of rows to overlap between chunks

    /**
     * Split Excel text into semantic chunks based on sheets and rows
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

        // First, split by sheets (if multiple sheets exist, they're usually separated by multiple newlines)
        // Excel data typically comes as tabular data with consistent line breaks
        const sections = text
            .split(/\n{3,}/) // Split on 3+ newlines which might indicate sheet boundaries
            .filter((s) => s.trim().length > 0);

        let currentChunk = "";
        let previousRows: string[] = []; // For overlap between chunks

        for (const section of sections) {
            // Split section into rows (lines)
            const rows = section
                .split(/\n/)
                .filter((row) => row.trim().length > 0);

            for (const row of rows) {
                const rowTokens = estimateTokens(row);
                const currentChunkTokens = estimateTokens(currentChunk);

                // Check if adding this row would exceed the token limit
                if (
                    currentChunkTokens + rowTokens >
                        this.MAX_TOKENS_PER_CHUNK &&
                    currentChunk.length > 0
                ) {
                    // Current chunk is full, save it and start a new one
                    if (
                        estimateTokens(currentChunk) >=
                        this.MIN_TOKENS_PER_CHUNK
                    ) {
                        chunks.push(currentChunk.trim());

                        // Start new chunk with overlap from previous rows
                        const overlapText = previousRows
                            .slice(-this.OVERLAP_ROWS)
                            .join("\n");
                        currentChunk = overlapText
                            ? overlapText + "\n" + row
                            : row;
                        previousRows = [row];
                    } else {
                        // Current chunk is too small, add row anyway
                        currentChunk +=
                            (currentChunk.length > 0 ? "\n" : "") + row;
                        previousRows.push(row);
                    }
                } else {
                    // Add row to current chunk
                    currentChunk += (currentChunk.length > 0 ? "\n" : "") + row;
                    previousRows.push(row);

                    // Keep only recent rows for overlap
                    if (previousRows.length > this.OVERLAP_ROWS * 2) {
                        previousRows = previousRows.slice(
                            -this.OVERLAP_ROWS * 2
                        );
                    }
                }
            }

            // Add section break after processing all rows in the section
            if (currentChunk.length > 0 && !currentChunk.endsWith("\n\n")) {
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

    async extractFromXlsx(
        buffer: Buffer,
        filename: string
    ): Promise<UnifiedExtractionResult> {
        return await sentryMonitoringService.track(
            `XLSX extraction: ${filename}`,
            "extraction",
            { filename, bufferSize: buffer.length },
            async () => {
                const startTime = Date.now();

                try {
                    console.log(
                        `📊 Starting Excel extraction for ${filename} (${buffer.length} bytes)`
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
                            "officeparser returned undefined/null - the Excel file may be corrupted or not a valid Excel format"
                        );
                    }

                    if (typeof result !== "string") {
                        console.warn(
                            `⚠️ officeparser returned unexpected type: ${typeof result}`,
                            result
                        );
                        // Try to convert to string if possible
                        const textStr = String(result);
                        if (
                            !textStr ||
                            textStr === "undefined" ||
                            textStr === "null"
                        ) {
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
                    const sanitizationResult =
                        TextCleaningService.sanitizeForAI(textString, "xlsx", {
                            maxRiskScore: 40,
                            enableStrictMode: false,
                        });

                    const cleanedText = sanitizationResult.sanitizedContent;

                    // Log security report
                    if (
                        sanitizationResult.securityReport.initialRiskScore > 25
                    ) {
                        console.warn(`🚨 XLSX security report:`, {
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

                    console.log(
                        `✅ Excel content extracted and sanitized - ${cleanedText.length} characters`
                    );

                    // Split Excel text into semantic chunks for proper token management
                    // This maintains semantic meaning while preventing embedding token limits
                    const pageTexts = this.splitIntoSemanticChunks(cleanedText);

                    console.log(
                        `📊 Split Excel into ${pageTexts.length} semantic chunks`
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
                        `📊 Excel Extraction Performance: ${performance.pages_per_second.toFixed(
                            1
                        )} chunks/sec, ${
                            performance.characters_extracted
                        } chars, avg ${
                            performance.average_chars_per_page
                        } chars/chunk`
                    );

                    return {
                        fullText: cleanedText,
                        pageTexts: pageTexts, // Use the semantic chunks
                        totalPages: pageTexts.length, // Actual number of semantic chunks
                        extractionTime,
                        library: "officeparser",
                        method: "xlsx" as any, // Extending the type
                        performance,
                    };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    console.error(
                        `❌ Excel extraction failed for ${filename}:`,
                        errorMessage
                    );

                    // Try alternative extraction method or return empty result
                    console.log(
                        `🔄 Attempting fallback extraction for ${filename}...`
                    );

                    try {
                        // Fallback: Return minimal structure with error indication
                        const fallbackText = `[Excel extraction failed: ${errorMessage}. File may be corrupted or not a valid Excel format.]`;

                        return {
                            fullText: fallbackText,
                            pageTexts: [fallbackText],
                            totalPages: 1,
                            extractionTime: (Date.now() - startTime) / 1000,
                            library: "officeparser (fallback)",
                            method: "xlsx" as any,
                            performance: {
                                pages_per_second: 0,
                                characters_extracted: fallbackText.length,
                                average_chars_per_page: fallbackText.length,
                            },
                        };
                    } catch (fallbackError) {
                        throw new Error(
                            `Failed to extract text from Excel file ${filename}: ${errorMessage}`
                        );
                    }
                }
            }
        );
    }
}
