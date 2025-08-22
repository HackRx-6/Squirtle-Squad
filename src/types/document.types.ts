export interface DocumentChunk {
    pageNumber: number;
    content: string;
    metadata: {
        chunkType?: "page-wise" | "character-wise";
        startIndex?: number;
        endIndex?: number;
        actualPageNumber?: number;
        endPageNumber?: number;
        pagesInChunk?: number;
        characterCount?: number;
    };
}

export interface ProcessedPDFResult {
    filename: string;
    totalPages: number;
    content: string;
    chunks: DocumentChunk[];
}

export interface FileMetadata {
    contentLength?: string;
    contentType?: string;
    lastModified?: string;
    server?: string;
    url: string;
}

export interface ProcessedDocumentResult {
    filename: string;
    documentType: "pdf" | "docx" | "email" | "image" | "bin" | "zip" | "xlsx" | "pptx";
    totalPages: number;
    content: string;
    chunks: DocumentChunk[];
    metadata?: FileMetadata; // For URL-based files like .bin/.zip
}

export interface DocumentEmbeddingData {
    documentId: string;
    fileName: string;
    content: string;
    chunkIndex: number;
    totalChunks: number;
    pageNumber?: number;
    metadata?: any;
    $vectorize: string;
}

// Simplified question format - just an array of strings
export type Question = string;

export interface DocumentChunkResult {
    _id?: string;
    documentId: string;
    fileName: string;
    content: string;
    chunkIndex: number;
    totalChunks: number;
    pageNumber?: number;
    metadata?: any;
    $similarity?: number;
}

// Simplified answer format - clean response without metadata
export interface QuestionAnswer {
    question: string;
    answer: string;
}

// Simplified API response format
export interface ChunkingResult {
    success: boolean;
    message: string;
    data?: QuestionAnswer[];
}

// Internal processing result with metadata
export interface InternalProcessingResult {
    success: boolean;
    message: string;
    data?: {
        documentId: string;
        totalChunks: number;
        insertedCount: number;
    };
}
