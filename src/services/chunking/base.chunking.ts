import type { DocumentChunk } from "../../types/document.types";
import type { ChunkingStrategy } from "./types"


export abstract class BaseChunkingStrategy implements ChunkingStrategy {
    abstract chunk(
        text: string | string[],
        filename: string
    ): DocumentChunk[] | Promise<DocumentChunk[]>;

    protected logChunkingStats(
        chunks: DocumentChunk[],
        filename: string,
        strategy: string
    ): void {
        const chunkSizes = chunks.map((chunk) => chunk.content.length);
        const avgSize = Math.round(
            chunkSizes.reduce((sum, size) => sum + size, 0) / chunkSizes.length
        );
        const maxSize = Math.max(...chunkSizes);
        const minSize = Math.min(...chunkSizes);

        console.log(
            `📦 Created ${chunks.length} ${strategy} chunks for ${filename}`
        );
        console.log(
            `📊 ${strategy} statistics - Average: ${avgSize} chars, Min: ${minSize} chars, Max: ${maxSize} chars`
        );

        // Log page-wise specific information if available
        const pagesPerChunkInfo = chunks
            .map((chunk) => chunk.metadata?.pagesInChunk)
            .filter((pages): pages is number => pages !== undefined);
        if (pagesPerChunkInfo.length > 0) {
            const avgPages =
                pagesPerChunkInfo.reduce((sum, pages) => sum + pages, 0) /
                pagesPerChunkInfo.length;
            console.log(
                `📄 Pages per chunk - Average: ${avgPages.toFixed(
                    1
                )}, Total chunks: ${chunks.length}`
            );

            // Show distribution of pages per chunk
            const pageDistribution: { [key: number]: number } = {};
            pagesPerChunkInfo.forEach((pages) => {
                pageDistribution[pages] = (pageDistribution[pages] || 0) + 1;
            });

            const distributionStr = Object.entries(pageDistribution)
                .map(([pages, count]) => `${pages}pg:${count}`)
                .join(", ");
            console.log(`📈 Page distribution: ${distributionStr}`);
        }
    }
}
