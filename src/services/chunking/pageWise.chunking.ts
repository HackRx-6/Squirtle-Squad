import { BaseChunkingStrategy } from "./base.chunking";
import type { DocumentChunk } from "../../types/document.types";
import type { PageWiseConfig } from "./types";


export class PageWiseChunkingStrategy extends BaseChunkingStrategy {
    constructor(private config: PageWiseConfig) {
        super();
    }

    chunk(pageTexts: string[], filename: string): DocumentChunk[] {
        const chunks: DocumentChunk[] = [];
        const { pagesPerChunk } = this.config;

        for (let i = 0; i < pageTexts.length; i += pagesPerChunk) {
            const pageGroup = pageTexts.slice(i, i + pagesPerChunk);
            const combinedContent = pageGroup
                .map((pageText) => pageText.trim())
                .filter((text) => text.length > 0)
                .join("\n\n"); // Separate pages with double newline

            if (combinedContent.length > 0) {
                const startPage = i + 1;
                const endPage = Math.min(i + pagesPerChunk, pageTexts.length);

                chunks.push({
                    pageNumber: startPage, // Use start page as primary reference
                    content: combinedContent,
                    metadata: {
                        chunkType: "page-wise",
                        actualPageNumber: startPage,
                        endPageNumber: endPage,
                        pagesInChunk: endPage - startPage + 1,
                        characterCount: combinedContent.length,
                    },
                });
            }
        }

        this.logChunkingStats(
            chunks,
            filename,
            `page-wise (${pagesPerChunk} pages/chunk)`
        );
        return chunks;
    }
}
