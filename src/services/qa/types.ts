import type { SimilarChunk } from "../search/types";

export interface QARequest {
    question: string;
    context?: string;
    options?: QAOptions;
}

export interface QAResponse {
    answer: string;
    confidence: number;
    sources: QASource[];
    processingTime: number;
    metadata: QAMetadata;
}

export interface QAOptions {
    maxChunks?: number;
    similarityThreshold?: number;
    includeImages?: boolean;
    documentType?: "general" | "excel";
    streaming?: boolean;
}

export interface QASource {
    content: string;
    pageNumber: number;
    fileName: string;
    similarity: number;
    chunkIndex: number;
    metadata?: any;
}

export interface QAMetadata {
    totalChunksSearched: number;
    chunksUsedInAnswer: number;
    searchMethod: string;
    embeddingTime: number;
    searchTime: number;
    llmTime: number;
    documentType: "general" | "excel";
}

export interface QAProcessingStats {
    documentsProcessed: number;
    totalChunks: number;
    averageProcessingTime: number;
    successRate: number;
    memoryUsage: number;
}

export interface ContextEnrichmentResult {
    originalChunks: SimilarChunk[];
    enrichedChunks: SimilarChunk[];
    webContent: Array<{
        url: string;
        content: string;
        relevance: number;
    }>;
    processingTime: number;
}

export interface DocumentProcessingResult {
    fileName: string;
    totalPages: number;
    chunksGenerated: number;
    embeddingsGenerated: number;
    processingTime: number;
    documentType: "general" | "excel";
}
