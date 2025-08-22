import { EmbeddingService } from ".";
import { Config } from "../../config";
import type { EmbeddingProvider, BatchEmbeddingResult } from "./types";

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

export class BatchedEmbeddingService implements EmbeddingProvider {
    private embeddingService: EmbeddingService;

    constructor() {
        this.embeddingService = new EmbeddingService();
    }

    /**
     * Generate embeddings for a single text (interface compatibility)
     * Uses load balanced service for consistency
     */
    async generateEmbeddings(
        text: string,
        timeoutSeconds?: number
    ): Promise<number[]> {
        return await this.embeddingService.generateEmbeddings(
            text,
            timeoutSeconds
        );
    }

    /**
     * Generate embeddings for multiple texts with configurable batch processing
     * @param texts Array of texts to generate embeddings for
     * @param timeoutSeconds Timeout for individual embedding generation
     * @returns Array of embeddings (null for failed generations)
     */
    async generateBatchEmbeddings(
        texts: string[],
        timeoutSeconds?: number
    ): Promise<(number[] | null)[]> {
        const qaConfig = Config.app.getQAConfig();
        const batchConfig = qaConfig.embeddingBatch;

        if (!batchConfig.enabled) {
            // Use traditional parallel processing if batch processing is disabled
            return await this.generateAllParallel(texts, timeoutSeconds);
        }

        return await this.generateBatchedParallel(texts, timeoutSeconds);
    }

    /**
     * Traditional parallel processing - generate all embeddings simultaneously with load balancing
     */
    private async generateAllParallel(
        texts: string[],
        timeoutSeconds?: number
    ): Promise<(number[] | null)[]> {
        console.log(
            `🚀 Generating ${texts.length} embeddings in parallel with load balancing (traditional mode)`
        );

        const startTime = Date.now();

        try {
            // Use the existing load balanced batch processing
            const results = await this.embeddingService.generateBatchEmbeddings(
                texts,
                timeoutSeconds
            );

            const processingTime = Date.now() - startTime;
            const successCount = results.filter(
                (result) => result !== null
            ).length;

            console.log(
                `✅ Load balanced parallel embedding generation complete: ${successCount}/${texts.length} successful in ${processingTime}ms`
            );

            return results;
        } catch (error) {
            console.error(
                "❌ Error in load balanced parallel embedding generation:",
                error
            );
            throw error;
        }
    }

    /**
     * Batched parallel processing - process embeddings in configurable batches
     */
    private async generateBatchedParallel(
        texts: string[],
        timeoutSeconds?: number
    ): Promise<(number[] | null)[]> {
        const qaConfig = Config.app.getQAConfig();
        const batchConfig = qaConfig.embeddingBatch;

        console.log(
            `🔄 Generating ${texts.length} embeddings in batches of ${batchConfig.batchSize} (load balanced)`
        );

        const startTime = Date.now();
        const batches = chunkArray(texts, batchConfig.batchSize);
        const allResults: (number[] | null)[] = [];

        let totalSuccessful = 0;
        let totalFailed = 0;

        try {
            for (
                let batchIndex = 0;
                batchIndex < batches.length;
                batchIndex++
            ) {
                const batch = batches[batchIndex];
                if (!batch) continue; // Skip undefined batches

                const batchStartIndex = batchIndex * batchConfig.batchSize;

                console.log(
                    `📦 Processing batch ${batchIndex + 1}/${batches.length} (${
                        batch.length
                    } items) with load balancing`
                );

                // Process current batch with load balancing
                const batchResults =
                    await this.embeddingService.generateBatchEmbeddings(
                        batch,
                        timeoutSeconds
                    );

                // Count successes and failures for this batch
                const batchSuccessful = batchResults.filter(
                    (r) => r !== null
                ).length;
                const batchFailed = batch.length - batchSuccessful;

                totalSuccessful += batchSuccessful;
                totalFailed += batchFailed;

                // Store results maintaining original order
                for (let i = 0; i < batchResults.length; i++) {
                    const result = batchResults[i];
                    allResults[batchStartIndex + i] = result || null;
                }

                console.log(
                    `✅ Batch ${batchIndex + 1} complete: ${batchSuccessful}/${
                        batch.length
                    } successful (load balanced)`
                );
            }

            const processingTime = Date.now() - startTime;

            console.log(
                `🎉 Batched load balanced embedding generation complete: ${totalSuccessful}/${texts.length} successful, ${totalFailed} failed in ${processingTime}ms`
            );
            console.log(
                `📊 Average batch processing time: ${Math.round(
                    processingTime / batches.length
                )}ms per batch (with load balancing)`
            );

            return allResults;
        } catch (error) {
            console.error("❌ Error in batched embedding generation:", error);
            throw error;
        }
    }

    /**
     * Generate embedding statistics for monitoring
     */
    async generateEmbeddingsBatch(
        texts: string[],
        timeoutSeconds?: number
    ): Promise<BatchEmbeddingResult> {
        const startTime = Date.now();

        const results = await this.generateBatchEmbeddings(
            texts,
            timeoutSeconds
        );

        const processingTime = Date.now() - startTime;
        const successful: number[] = [];
        const failed: number[] = [];

        results.forEach((result, index) => {
            if (result !== null) {
                successful.push(index);
            } else {
                failed.push(index);
            }
        });

        return {
            success: successful,
            failed: failed,
            totalProcessed: successful.length,
            totalRequested: texts.length,
            processingTime,
        };
    }

    /**
     * Update batch configuration at runtime
     */
    public updateBatchConfig(enabled: boolean, batchSize?: number): void {
        const qaConfig = Config.app.getQAConfig();

        qaConfig.embeddingBatch.enabled = enabled;
        if (batchSize !== undefined) {
            qaConfig.embeddingBatch.batchSize = batchSize;
        }

        console.log(
            `🔄 Updated batch embedding config: enabled=${enabled}, batchSize=${qaConfig.embeddingBatch.batchSize}`
        );
    }
    /**
     * Get current batch configuration
     */
    public getBatchConfig() {
        return Config.app.getQAConfig().embeddingBatch;
    }
}
