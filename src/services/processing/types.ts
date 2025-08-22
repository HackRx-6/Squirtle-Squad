import type { DocumentChunk } from "../../types/document.types";
import type { UnifiedExtractionResult } from "../extraction/types";

export interface ProcessingOptions {
    enableChunking?: boolean;
    enableEmbedding?: boolean;
    chunkingStrategy?: "page" | "character" | "recursive";
    preserveMetadata?: boolean;
    timeout?: number;
}

export interface ProcessingResult {
    extractionResult: UnifiedExtractionResult;
    chunks: DocumentChunk[];
    processingTime: number;
    metrics: ProcessingMetrics;
}

export interface ProcessingMetrics {
    extractionTime: number;
    chunkingTime: number;
    embeddingTime: number;
    totalTime: number;
    chunksGenerated: number;
    memoryUsed: number;
}

export interface ProcessingRequest {
    file: Buffer;
    fileName: string;
    documentType: "pdf" | "docx" | "email" | "image" | "xlsx" | "pptx";
    options?: ProcessingOptions;
}

export interface ProcessingStageResult {
    stage: "extraction" | "chunking" | "embedding" | "indexing";
    success: boolean;
    duration: number;
    output?: any;
    error?: string;
}

export interface DocumentProcessingPipeline {
    stages: ProcessingStageResult[];
    totalDuration: number;
    success: boolean;
    finalResult?: ProcessingResult;
}
