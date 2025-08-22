export interface InMemoryChunkData {
    content: string;
    embedding: number[];
    pageNumber: number;
    chunkIndex: number;
    metadata: any;
    fileName: string;
}

export interface SimilarChunk extends InMemoryChunkData {
    similarity: number;
}

export interface VectorSearchStats {
    chunkCount: number;
    totalEmbeddings: number;
    estimatedMemoryMB: number;
    averageChunkSize: number;
}

export interface SimilaritySearchResult {
    chunks: SimilarChunk[];
    searchMethod: "HNSW" | "Cosine Similarity";
    queryTime: number;
    totalCandidates: number;
}

export interface SearchScoreDistribution {
    range: string;
    count: number;
}

export interface SearchAnalytics {
    averageScore: number;
    minScore: number;
    maxScore: number;
    distribution: SearchScoreDistribution[];
}
