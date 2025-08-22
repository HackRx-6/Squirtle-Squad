import type { DocumentChunk } from "../../types/document.types";
import { EmbeddingService, BatchedEmbeddingService } from "../embeddings";
import { sentryMonitoringService } from "../monitoring";
import { HierarchicalNSW } from "hnswlib-node";
import { AppConfigService } from "../../config";
import type { VectorSearchConfig } from "../../config";
import type { InMemoryChunkData, SimilarChunk, VectorSearchStats } from "./types";

export class InMemoryVectorService {
    private embeddings: InMemoryChunkData[] = [];
    private hnswIndex: HierarchicalNSW | null = null;
    private dimensions: number = 0;
    private configService: AppConfigService;

    constructor() {
        this.configService = AppConfigService.getInstance();
    }

    /**
     * Get the vector search configuration
     */
    private getVectorSearchConfig(): VectorSearchConfig {
        return this.configService.getQAConfig().vectorSearch;
    }

    /**
     * Append precomputed embeddings to the existing in-memory index
     * Rebuilds HNSW index if enabled.
     */
    async appendPrecomputedEmbeddings(
        data: Array<{
            content: string;
            embedding: number[];
            pageNumber: number;
            chunkIndex: number;
            metadata: any;
            fileName: string;
        }>
    ): Promise<void> {
        if (!data || data.length === 0) return;

        // Initialize dimensions if needed
        if (this.dimensions === 0 && data[0]) {
            this.dimensions = data[0].embedding.length;
        }

        // Simple dedupe for web content by content hash and url when available
        const existing = new Set(
            this.embeddings
                .filter((e) => e.metadata?.source === "web")
                .map((e) => `${e.metadata?.url || ""}::${e.content}`)
        );

        for (const item of data) {
            const key = `${item.metadata?.url || ""}::${item.content}`;
            if (existing.has(key)) continue;
            this.embeddings.push({
                content: item.content,
                embedding: item.embedding,
                pageNumber: item.pageNumber,
                chunkIndex: item.chunkIndex,
                metadata: item.metadata,
                fileName: item.fileName,
            });
        }

        // Rebuild index for simplicity
        const searchConfig = this.getVectorSearchConfig();
        if (searchConfig.useHNSW) {
            await this.buildHNSWIndex();
        }
    }

    /**
     * Add document chunks to in-memory storage with embeddings
     * Uses configurable batched embedding processing
     */
    async addChunks(
        chunks: DocumentChunk[],
        embeddingService: EmbeddingService,
        fileName: string
    ): Promise<void> {
        return await sentryMonitoringService.track(
            "in_memory_embeddings_generation",
            "embedding",
            {
                filename: fileName,
                total_chunks: chunks.length,
            },
            async () => {
                const qaConfig = this.configService.getQAConfig();
                const batchConfig = qaConfig.embeddingBatch;

                console.log(
                    `🧮 Generating embeddings for ${chunks.length} chunks with ${qaConfig.embeddingTimeout}s timeout per chunk...`
                );

                if (batchConfig.enabled) {
                    console.log(
                        `🔄 Using batched embedding processing with load balancing: ${batchConfig.batchSize} chunks per batch`
                    );
                } else {
                    console.log(
                        `🚀 Using traditional parallel embedding processing with load balancing`
                    );
                }

                // Create batched embedding service for advanced processing
                const batchedEmbeddingService = new BatchedEmbeddingService();

                // Extract text content from chunks
                const chunkTexts = chunks.map((chunk) => chunk.content);

                // Generate embeddings using batched service
                const embeddings =
                    await batchedEmbeddingService.generateBatchEmbeddings(
                        chunkTexts,
                        qaConfig.embeddingTimeout
                    );

                // Combine chunks with their embeddings, filtering out failures
                const successfulEmbeddings: InMemoryChunkData[] = [];
                let failedCount = 0;

                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const embedding = embeddings[i];

                    if (embedding && chunk) {
                        successfulEmbeddings.push({
                            content: chunk.content,
                            embedding,
                            pageNumber: chunk.pageNumber,
                            chunkIndex: i,
                            metadata: chunk.metadata,
                            fileName,
                        });
                    } else {
                        failedCount++;
                        console.warn(
                            `⏰ Skipping chunk ${i} (page ${
                                chunk?.pageNumber || "unknown"
                            }) due to embedding generation failure`
                        );
                    }
                }

                this.embeddings = successfulEmbeddings;

                if (failedCount > 0) {
                    console.warn(
                        `⚠️ Skipped ${failedCount} chunks due to embedding failures out of ${chunks.length} total chunks`
                    );
                }

                // Set dimensions from first successful embedding
                if (this.embeddings.length > 0 && this.dimensions === 0) {
                    this.dimensions = this.embeddings[0]!.embedding.length;
                }

                // Build HNSW index if enabled and we have embeddings
                const searchConfig = this.getVectorSearchConfig();
                if (searchConfig.useHNSW && this.embeddings.length > 0) {
                    await this.buildHNSWIndex();
                }

                const processingMode = batchConfig.enabled
                    ? `batched (${batchConfig.batchSize} per batch) with load balancing`
                    : "parallel with load balancing";

                console.log(
                    `✅ Successfully generated ${
                        this.embeddings.length
                    } embeddings out of ${chunks.length} chunks (${
                        this.embeddings[0]?.embedding.length || 0
                    } dimensions each) using ${processingMode} processing${
                        searchConfig.useHNSW ? " with HNSW index" : ""
                    }`
                );
            },
            {
                component: "in_memory_vector_service",
                operation: "embeddings_generation",
            }
        );
    }

    /**
     * Build HNSW index for fast approximate nearest neighbor search
     */
    private async buildHNSWIndex(): Promise<void> {
        if (this.embeddings.length === 0 || this.dimensions === 0) {
            return;
        }

        console.log(
            `🏗️ Building HNSW index for ${this.embeddings.length} vectors...`
        );

        // Create HNSW index with cosine distance
        this.hnswIndex = new HierarchicalNSW("cosine", this.dimensions);

        // Initialize index with expected number of elements
        this.hnswIndex.initIndex(Math.max(this.embeddings.length, 1000));

        // Add all embeddings to the index
        for (let i = 0; i < this.embeddings.length; i++) {
            this.hnswIndex.addPoint(this.embeddings[i]!.embedding, i);
        }

        console.log(`✅ HNSW index built successfully`);
    }

    /**
     * Find most similar chunks using HNSW or cosine similarity
     */
    findSimilar(queryEmbedding: number[], limit: number = 10): SimilarChunk[] {
        if (this.embeddings.length === 0) {
            console.warn("⚠️ No embeddings available for similarity search");
            return [];
        }

        console.log(
            `🔍 Searching ${
                this.embeddings.length
            } chunks for similar content using ${
                this.getVectorSearchConfig().useHNSW
                    ? "HNSW"
                    : "cosine similarity"
            }...`
        );

        const searchConfig = this.getVectorSearchConfig();
        if (searchConfig.useHNSW && this.hnswIndex) {
            return this.findSimilarHNSW(queryEmbedding, limit);
        } else {
            return this.findSimilarCosine(queryEmbedding, limit);
        }
    }

    /**
     * Find similar chunks using HNSW (fast approximate search)
     */
    private findSimilarHNSW(
        queryEmbedding: number[],
        limit: number
    ): SimilarChunk[] {
        if (!this.hnswIndex) {
            console.warn(
                "⚠️ HNSW index not available, falling back to cosine similarity"
            );
            return this.findSimilarCosine(queryEmbedding, limit);
        }

        try {
            const results = this.hnswIndex.searchKnn(queryEmbedding, limit);

            const similarChunks: SimilarChunk[] = results.neighbors.map(
                (index, i) => {
                    const chunk = this.embeddings[index];
                    if (!chunk) {
                        throw new Error(`Invalid chunk index: ${index}`);
                    }

                    // Convert distance to similarity (1 - distance for cosine)
                    const similarity = 1 - results.distances[i]!;

                    return {
                        ...chunk,
                        similarity: Math.max(0, similarity), // Ensure non-negative
                    };
                }
            );

            console.log(
                `✅ Found ${
                    similarChunks.length
                } similar chunks using HNSW (similarity range: ${similarChunks[
                    similarChunks.length - 1
                ]?.similarity.toFixed(
                    3
                )} - ${similarChunks[0]?.similarity.toFixed(3)})`
            );

            // Log detailed similarity scores
            this.logSimilarityScores(similarChunks, "HNSW");

            return similarChunks;
        } catch (error) {
            console.warn(
                "⚠️ HNSW search failed, falling back to cosine similarity:",
                error
            );
            return this.findSimilarCosine(queryEmbedding, limit);
        }
    }

    /**
     * Find similar chunks using exact cosine similarity (slower but exact)
     */
    private findSimilarCosine(
        queryEmbedding: number[],
        limit: number
    ): SimilarChunk[] {
        // Calculate similarities for all chunks
        const similarities = this.embeddings.map((item) => ({
            ...item,
            similarity: this.cosineSimilarity(queryEmbedding, item.embedding),
        }));

        // Sort by similarity (highest first) and return top results
        const results = similarities
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);

        console.log(
            `✅ Found ${
                results.length
            } similar chunks using cosine similarity (similarity range: ${results[
                results.length - 1
            ]?.similarity.toFixed(3)} - ${results[0]?.similarity.toFixed(3)})`
        );

        // Log detailed similarity scores
        this.logSimilarityScores(results, "Cosine Similarity");

        return results;
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            throw new Error(
                "Vector dimensions must match for cosine similarity calculation"
            );
        }

        const dotProduct = a.reduce(
            (sum, val, i) => sum + val * (b[i] || 0),
            0
        );
        const magnitudeA = Math.sqrt(
            a.reduce((sum, val) => sum + val * val, 0)
        );
        const magnitudeB = Math.sqrt(
            b.reduce((sum, val) => sum + val * val, 0)
        );

        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }

        return dotProduct / (magnitudeA * magnitudeB);
    }

    /**
     * Clear all stored embeddings (cleanup)
     */
    clear(): void {
        const chunkCount = this.embeddings.length;
        this.embeddings = [];
        this.hnswIndex = null;
        this.dimensions = 0;
        console.log(
            `🧹 Cleared ${chunkCount} embeddings and HNSW index from memory`
        );
    }

    /**
     * Get current search method (read-only, configured via app config)
     */
    getSearchMethod(): string {
        return this.getVectorSearchConfig().useHNSW
            ? "HNSW"
            : "Cosine Similarity";
    }

    /**
     * Log detailed similarity scores for analysis
     */
    private logSimilarityScores(chunks: SimilarChunk[], method: string): void {
        console.log(`\n📊 Similarity Scores Analysis (${method}):`);
        console.log("Rank | Score  | Page(s) | Chars | Content Preview");
        console.log("-----|--------|---------|-------|----------------");

        chunks.forEach((chunk, index) => {
            const pageInfo =
                chunk.metadata?.pagesInChunk > 1
                    ? `${chunk.metadata.actualPageNumber}-${chunk.metadata.endPageNumber}`
                    : `${chunk.pageNumber}`;

            const preview = chunk.content.substring(0, 50).replace(/\n/g, " ");
            console.log(
                `${(index + 1).toString().padStart(4)} | ` +
                    `${chunk.similarity.toFixed(3)} | ` +
                    `${pageInfo.padStart(7)} | ` +
                    `${chunk.content.length.toString().padStart(5)} | ` +
                    `${preview}...`
            );
        });

        // Statistics
        const scores = chunks.map((c) => c.similarity);
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        const minScore = Math.min(...scores);
        const maxScore = Math.max(...scores);

        console.log("\n📈 Score Statistics:");
        console.log(`   Average: ${avgScore.toFixed(3)}`);
        console.log(
            `   Range: ${minScore.toFixed(3)} - ${maxScore.toFixed(3)}`
        );
        console.log(
            `   Score distribution: ${this.getScoreDistribution(scores)}`
        );
        console.log("");
    }

    /**
     * Get score distribution for analysis
     */
    private getScoreDistribution(scores: number[]): string {
        const bins = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];
        const distribution: { [key: string]: number } = {};

        bins.forEach((bin, index) => {
            const nextBin = bins[index - 1] || 1.0;
            const count = scores.filter(
                (score) => score > bin && score <= nextBin
            ).length;
            if (count > 0) {
                distribution[`${bin.toFixed(1)}-${nextBin.toFixed(1)}`] = count;
            }
        });

        return Object.entries(distribution)
            .map(([range, count]) => `${range}:${count}`)
            .join(", ");
    }

    /**
     * Get memory usage statistics
     */
    getStats(): VectorSearchStats {
        const chunkCount = this.embeddings.length;
        const totalEmbeddings =
            chunkCount * (this.embeddings[0]?.embedding.length || 0);

        // Rough memory estimation (floats + text content)
        const embeddingMemory = totalEmbeddings * 4; // 4 bytes per float
        const textMemory = this.embeddings.reduce(
            (sum, chunk) => sum + chunk.content.length,
            0
        );
        const estimatedMemoryMB =
            (embeddingMemory + textMemory) / (1024 * 1024);

        const averageChunkSize =
            chunkCount > 0
                ? Math.round(
                      this.embeddings.reduce(
                          (sum, chunk) => sum + chunk.content.length,
                          0
                      ) / chunkCount
                  )
                : 0;

        return {
            chunkCount,
            totalEmbeddings,
            estimatedMemoryMB: Math.round(estimatedMemoryMB * 100) / 100,
            averageChunkSize,
        };
    }
}
