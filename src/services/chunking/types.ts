import type { DocumentChunk } from "../../types/document.types";

export interface ChunkingStrategy {
    chunk(
        text: string | string[],
        filename: string
    ): DocumentChunk[] | Promise<DocumentChunk[]>;
}

export interface PageWiseConfig {
    pagesPerChunk: number;
}

export interface RecursiveChunkingOptions {
    chunkSize: number;
    chunkOverlap: number;
    separators?: string[];
    lengthFunction?: (text: string) => number;
    keepSeparator?: boolean;
}

export interface ChunkingOptions {
    chunkSize?: number;
    overlapSize?: number;
    preserveWords?: boolean;
    minChunkSize?: number;
    maxChunkSize?: number;
}

export interface ChunkingStats {
    totalChunks: number;
    averageChunkSize: number;
    minChunkSize: number;
    maxChunkSize: number;
    strategy: string;
    filename: string;
}

export interface RecursiveChunkingConfig {
    separators: string[];
    chunkSize: number;
    chunkOverlap: number;
    lengthFunction: (text: string) => number;
}

export interface PageWiseChunkingConfig {
    mergeShortPages: boolean;
    minPageLength: number;
    preservePageBoundaries: boolean;
}

export interface CharacterWiseChunkingConfig {
    chunkSize: number;
    overlap: number;
    preserveWords: boolean;
    separator: string;
}

export interface ChunkingMetrics {
    processingTime: number;
    inputLength: number;
    outputChunks: number;
    compressionRatio: number;
}
