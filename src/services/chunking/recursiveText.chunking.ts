import { BaseChunkingStrategy } from "./base.chunking";
import { sentryMonitoringService } from "../monitoring";
import type { DocumentChunk } from "../../types/document.types";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

export interface RecursiveChunkingOptions {
    chunkSize: number;
    chunkOverlap: number;
    separators?: string[];
    lengthFunction?: (text: string) => number;
    keepSeparator?: boolean;
}

export class RecursiveTextChunkingStrategy extends BaseChunkingStrategy {
    private options: RecursiveChunkingOptions;
    private textSplitter: RecursiveCharacterTextSplitter;

    constructor(options: RecursiveChunkingOptions) {
        super();
        this.options = {
            separators: ["\n\n", "\n", " ", ""],
            lengthFunction: (text: string) => text.length,
            keepSeparator: false,
            ...options,
        };

        // Initialize the LangChain recursive text splitter
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: this.options.chunkSize,
            chunkOverlap: this.options.chunkOverlap,
            separators: this.options.separators,
            lengthFunction: this.options.lengthFunction,
            keepSeparator: this.options.keepSeparator,
        });

        console.log(
            `🔄 Initialized Recursive Text Splitter with chunk size: ${this.options.chunkSize}, overlap: ${this.options.chunkOverlap}`
        );
        console.log(
            `📝 Using separators: ${JSON.stringify(this.options.separators)}`
        );
    }

    async chunk(
        text: string | string[],
        filename: string
    ): Promise<DocumentChunk[]> {
        const fullText = Array.isArray(text) ? text.join("\n\n") : text;

        // Only add monitoring for large documents that could be computationally intensive
        if (fullText.length > 50000) {
            // Monitor only for documents larger than 50KB
            return await sentryMonitoringService.track(
                `Recursive chunking: ${filename}`,
                "chunking",
                {
                    filename,
                    textLength: fullText.length,
                    chunkSize: this.options.chunkSize,
                    chunkOverlap: this.options.chunkOverlap,
                },
                async () => {
                    return await this.performChunking(fullText, filename);
                }
            );
        } else {
            // For smaller documents, skip monitoring to avoid overhead
            return await this.performChunking(fullText, filename);
        }
    }

    private async performChunking(
        fullText: string,
        filename: string
    ): Promise<DocumentChunk[]> {
        console.log(
            `🔄 Starting recursive text splitting for ${filename} (${fullText.length} characters)`
        );

        try {
            // Use LangChain's recursive text splitter to split the text
            const textChunks = await this.textSplitter.splitText(fullText);

            const chunks: DocumentChunk[] = textChunks.map(
                (chunkText: string, index: number) => {
                    // Calculate approximate page number based on chunk position
                    // Assuming average 2000 characters per page
                    const approximatePageNumber =
                        Math.floor((index * this.options.chunkSize) / 2000) + 1;

                    return {
                        content: chunkText.trim(),
                        pageNumber: approximatePageNumber,
                        metadata: {
                            chunkType: "character-wise" as const,
                            startIndex: index * this.options.chunkSize,
                            endIndex:
                                index * this.options.chunkSize +
                                chunkText.length,
                            characterCount: chunkText.length,
                            // Store additional recursive chunking metadata as a custom property
                            recursiveMetadata: {
                                chunkIndex: index,
                                chunkingStrategy: "recursive",
                                chunkSize: chunkText.length,
                                totalChunks: textChunks.length,
                                originalTextLength: fullText.length,
                                chunkOverlap: this.options.chunkOverlap,
                                separatorsUsed: this.options.separators,
                                // Additional metadata for recursive chunking
                                isCompleteThought:
                                    this.isCompleteThought(chunkText),
                                startsWithSeparator:
                                    this.startsWithMainSeparator(chunkText),
                                endsWithSeparator:
                                    this.endsWithMainSeparator(chunkText),
                            },
                        } as any, // Use 'any' to allow additional properties
                    };
                }
            );

            // Do not remove small chunks; keep all generated chunks
            this.logChunkingStats(chunks, filename, "recursive");
            this.logRecursiveSpecificStats(chunks, fullText);

            return chunks;
        } catch (error) {
            console.error(
                `❌ Error in recursive text chunking for ${filename}:`,
                error
            );
            throw error;
        }
    }

    /**
     * Log specific statistics for recursive chunking
     */
    private logRecursiveSpecificStats(
        chunks: DocumentChunk[],
        originalText: string
    ): void {
        const chunkSizes = chunks.map((chunk) => chunk.content.length);
        const totalChunkedLength = chunkSizes.reduce(
            (sum, size) => sum + size,
            0
        );

        // Calculate overlap efficiency
        const theoreticalLength = chunks.length * this.options.chunkSize;
        const overlapRatio =
            (theoreticalLength - totalChunkedLength) / theoreticalLength;

        // Count chunks that start/end with separators (indicating good splits)
        const goodStartSeparators = chunks.filter(
            (chunk) =>
                (chunk.metadata as any)?.recursiveMetadata?.startsWithSeparator
        ).length;
        const goodEndSeparators = chunks.filter(
            (chunk) =>
                (chunk.metadata as any)?.recursiveMetadata?.endsWithSeparator
        ).length;

        // Count complete thoughts
        const completeThoughts = chunks.filter(
            (chunk) =>
                (chunk.metadata as any)?.recursiveMetadata?.isCompleteThought
        ).length;

        console.log(`🔄 Recursive chunking metrics:`);
        console.log(
            `   📊 Text coverage: ${(
                (totalChunkedLength / originalText.length) *
                100
            ).toFixed(1)}%`
        );
        console.log(
            `   🔗 Effective overlap ratio: ${(overlapRatio * 100).toFixed(1)}%`
        );
        console.log(
            `   ✂️  Good splits: ${goodStartSeparators}/${chunks.length} start, ${goodEndSeparators}/${chunks.length} end`
        );
        console.log(
            `   💭 Complete thoughts: ${completeThoughts}/${chunks.length} (${(
                (completeThoughts / chunks.length) *
                100
            ).toFixed(1)}%)`
        );

        // Show separator usage distribution
        const separatorStats = this.analyzeSeparatorUsage(chunks);
        if (Object.keys(separatorStats).length > 0) {
            const separatorDistribution = Object.entries(separatorStats)
                .map(([sep, count]) => `${this.getSeparatorName(sep)}:${count}`)
                .join(", ");
            console.log(`   🔍 Separator usage: ${separatorDistribution}`);
        }
    }

    /**
     * Analyze which separators were most effective in splitting
     */
    private analyzeSeparatorUsage(chunks: DocumentChunk[]): {
        [separator: string]: number;
    } {
        const separatorCounts: { [separator: string]: number } = {};

        for (const chunk of chunks) {
            const content = chunk.content;
            // Check which separator is most prominent at chunk boundaries
            for (const separator of this.options.separators || []) {
                if (
                    separator &&
                    (content.startsWith(separator) ||
                        content.endsWith(separator))
                ) {
                    separatorCounts[separator] =
                        (separatorCounts[separator] || 0) + 1;
                }
            }
        }

        return separatorCounts;
    }

    /**
     * Get human-readable name for separator
     */
    private getSeparatorName(separator: string): string {
        switch (separator) {
            case "\n\n":
                return "¶¶"; // Double paragraph
            case "\n":
                return "¶"; // Single paragraph
            case " ":
                return "space";
            case "":
                return "char";
            default:
                return `"${separator}"`;
        }
    }

    /**
     * Check if a chunk represents a complete thought/sentence
     */
    private isCompleteThought(text: string): boolean {
        const trimmedText = text.trim();
        if (trimmedText.length === 0) return false;

        // Check if ends with sentence terminators
        const sentenceEnders = /[.!?;:]$/;

        // Check if starts with capital letter or common sentence starters
        const sentenceStarters = /^[A-Z]|^[0-9]|^\s*[-•*]/;

        return (
            sentenceEnders.test(trimmedText) &&
            sentenceStarters.test(trimmedText)
        );
    }

    /**
     * Check if chunk starts with a main separator (paragraph breaks)
     */
    private startsWithMainSeparator(text: string): boolean {
        const mainSeparators = ["\n\n", "\n"];
        return mainSeparators.some((sep) => text.startsWith(sep));
    }

    /**
     * Check if chunk ends with a main separator (paragraph breaks)
     */
    private endsWithMainSeparator(text: string): boolean {
        const mainSeparators = ["\n\n", "\n"];
        return mainSeparators.some((sep) => text.endsWith(sep));
    }

    /**
     * Update chunking options at runtime
     */
    public updateOptions(newOptions: Partial<RecursiveChunkingOptions>): void {
        this.options = { ...this.options, ...newOptions };

        // Reinitialize the text splitter with new options
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: this.options.chunkSize,
            chunkOverlap: this.options.chunkOverlap,
            separators: this.options.separators,
            lengthFunction: this.options.lengthFunction,
            keepSeparator: this.options.keepSeparator,
        });

        console.log(
            `🔄 Updated recursive chunking options: chunk size: ${this.options.chunkSize}, overlap: ${this.options.chunkOverlap}`
        );
    }
}
