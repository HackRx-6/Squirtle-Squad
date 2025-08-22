import { BaseChunkingStrategy } from "./base.chunking";
import type { DocumentChunk } from "../../types/document.types";

export interface CharacterWiseConfig {
    chunkSize: number;
    overlap: number;
    minChunkSizeRatio: number;
}

export class CharacterWiseChunkingStrategy extends BaseChunkingStrategy {
    constructor(private config: CharacterWiseConfig) {
        super();
    }

    chunk(text: string, filename: string): DocumentChunk[] {
        const { chunkSize, overlap, minChunkSizeRatio } = this.config;
        const chunks: DocumentChunk[] = [];

        if (text.length <= chunkSize) {
            chunks.push({
                pageNumber: 1,
                content: text,
                metadata: {
                    chunkType: "character-wise",
                    startIndex: 0,
                    endIndex: text.length,
                },
            });
            return chunks;
        }

        let startIndex = 0;
        let chunkNumber = 1;

        while (startIndex < text.length) {
            let endIndex = Math.min(startIndex + chunkSize, text.length);

            if (endIndex < text.length) {
                const lastPeriod = text.lastIndexOf(".", endIndex);
                const lastNewline = text.lastIndexOf("\n", endIndex);
                const lastSpace = text.lastIndexOf(" ", endIndex);

                const breakPoint = Math.max(lastPeriod, lastNewline, lastSpace);
                if (breakPoint > startIndex + chunkSize * minChunkSizeRatio) {
                    endIndex = breakPoint + 1;
                }
            }

            const chunkContent = text.slice(startIndex, endIndex).trim();

            if (chunkContent.length > 0) {
                chunks.push({
                    pageNumber: chunkNumber,
                    content: chunkContent,
                    metadata: {
                        chunkType: "character-wise",
                        startIndex,
                        endIndex,
                    },
                });
            }

            startIndex = Math.max(endIndex - overlap, startIndex + 1);
            chunkNumber++;
        }

        this.logChunkingStats(chunks, filename, "character-wise");
        return chunks;
    }
}
