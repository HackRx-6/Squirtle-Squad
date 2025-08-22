export interface EmbeddingProvider {
    generateEmbeddings(
        text: string,
        timeoutSeconds?: number
    ): Promise<number[]>;

    // Optional batch method for load balancing
    // Returns nullable results to handle individual failures gracefully
    generateBatchEmbeddings?(
        texts: string[],
        timeoutSeconds?: number
    ): Promise<(number[] | null)[]>;
}

export interface BatchEmbeddingResult {
    success: number[];
    failed: number[];
    totalProcessed: number;
    totalRequested: number;
    processingTime: number;
}