import OpenAI from "openai";
import { Config } from "../../config";
import { sentryMonitoringService } from "../monitoring";
import { loggingService } from "../logging";
import type { EmbeddingProvider } from "./types";

/**
 * Utility function to add timeout to any promise
 */
function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    identifier?: string
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(
                () =>
                    reject(
                        new Error(
                            `Timeout after ${timeoutMs}ms${
                                identifier ? ` for ${identifier}` : ""
                            }`
                        )
                    ),
                timeoutMs
            )
        ),
    ]);
}

export class EmbeddingService implements EmbeddingProvider {
    private primaryClient: OpenAI;
    private secondaryClient: OpenAI | null = null;
    private logger: ReturnType<typeof loggingService.createComponentLogger>;

    constructor() {
        const aiConfig = Config.ai;

        this.logger = loggingService.createComponentLogger("EmbeddingService");

        // Log initialization
        this.logger.info("Initializing Embedding Service", {
            loadBalancingEnabled: true, // Load balancing is now always enabled
        });

        // Initialize primary client
        const primaryConfig = aiConfig.getPrimaryOpenAIConfig();
        this.primaryClient = new OpenAI({
            apiKey: primaryConfig.apiKey,
            baseURL: `${primaryConfig.endpoint}/openai/deployments/${primaryConfig.deploymentName}`,
            defaultQuery: {
                "api-version": primaryConfig.apiVersion || "2024-06-01",
            },
            defaultHeaders: {
                "api-key": primaryConfig.apiKey,
            },
        });

        this.logger.info("Primary embedding client initialized", {
            endpoint: primaryConfig.endpoint,
            deploymentName: primaryConfig.deploymentName,
            apiVersion: primaryConfig.apiVersion || "2024-06-01",
        });

        // Initialize secondary client if available (load balancing is always enabled)
        if (aiConfig.hasSecondaryEmbedding()) {
            const secondaryConfig = aiConfig.getSecondaryOpenAIConfig()!;
            this.secondaryClient = new OpenAI({
                apiKey: secondaryConfig.apiKey,
                baseURL: `${secondaryConfig.endpoint}/openai/deployments/${secondaryConfig.deploymentName}`,
                defaultQuery: {
                    "api-version": secondaryConfig.apiVersion || "2024-06-01",
                },
                defaultHeaders: {
                    "api-key": secondaryConfig.apiKey,
                },
            });

            this.logger.info("Secondary embedding client initialized", {
                endpoint: secondaryConfig.endpoint,
                deploymentName: secondaryConfig.deploymentName,
                apiVersion: secondaryConfig.apiVersion || "2024-06-01",
            });

            console.log(
                `🔀 Load balancing enabled for embeddings with secondary model`
            );
        } else {
            this.logger.info(
                "Single client mode - no secondary client available"
            );
            console.log(`🔀 Single embedding client mode`);
        }
    }

    async generateEmbeddings(
        text: string,
        timeoutSeconds?: number
    ): Promise<number[]> {
        const qaConfig = Config.app.getQAConfig();
        const timeout =
            timeoutSeconds !== undefined
                ? timeoutSeconds
                : qaConfig.embeddingTimeout;
        const timeoutMs = timeout * 1000;

        const result = await sentryMonitoringService.track(
            "embeddings_generation",
            "embedding",
            {
                text_length: text.length,
                text_preview: text.substring(0, 100),
                model: "text-embedding-3-large",
                timeout_seconds: timeout,
                load_balancing_enabled: true,
                has_secondary_client: !!this.secondaryClient,
                client_type: "primary_single",
            },
            async () => {
                try {
                    this.logger.debug("Starting embedding generation", {
                        textLength: text.length,
                        textPreview: text.substring(0, 100),
                        timeout: timeout === 0 ? "disabled" : `${timeout}s`,
                        loadBalancing: true,
                    });

                    console.log(
                        `🧮 Generating embeddings for text: "${text.substring(
                            0,
                            100
                        )}..." (timeout: ${
                            timeout === 0 ? "disabled" : `${timeout}s`
                        }) [Load Balancing: ON]`
                    );

                    // Use primary client for single text generation
                    const embeddingPromise =
                        this.primaryClient.embeddings.create({
                            model: "text-embedding-3-large",
                            input: text,
                            encoding_format: "float",
                        });

                    const response =
                        timeout > 0
                            ? await withTimeout(
                                  embeddingPromise,
                                  timeoutMs,
                                  `embedding generation (${text.length} chars)`
                              )
                            : await embeddingPromise;

                    if (!response.data[0]?.embedding) {
                        const errorMsg =
                            "No embeddings returned from embedding service";
                        this.logger.error(errorMsg, {
                            textLength: text.length,
                            responseData: response.data,
                        });
                        throw new Error(errorMsg);
                    }

                    const embeddings = response.data[0].embedding;
                    const cost = this.calculateEmbeddingCost(response.usage);

                    this.logger.info("Embedding generation successful", {
                        textLength: text.length,
                        embeddingDimensions: embeddings.length,
                        model: "text-embedding-3-large",
                        cost,
                        tokensUsed: response.usage?.total_tokens,
                    });

                    console.log(
                        `✅ Generated embeddings with text-embedding-3-large model (${embeddings.length} dimensions) in time`
                    );

                    // Return with usage data for monitoring
                    return {
                        result: embeddings,
                        usage: {
                            ...response.usage,
                            cost,
                            model: "text-embedding-3-large",
                            provider: "azure_openai",
                        },
                    };
                } catch (error) {
                    if (
                        error instanceof Error &&
                        error.message.includes("Timeout")
                    ) {
                        this.logger.warn("Embedding generation timeout", {
                            textLength: text.length,
                            textPreview: text.substring(0, 100),
                            timeoutSeconds: timeout,
                            error: error.message,
                        });

                        console.warn(
                            `⏰ Embedding generation timed out after ${timeout}s for text: "${text.substring(
                                0,
                                100
                            )}..."`
                        );
                        throw new Error(`Embedding timeout after ${timeout}s`);
                    }

                    this.logger.error("Embedding generation failed", {
                        textLength: text.length,
                        textPreview: text.substring(0, 100),
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        loadBalancing: true,
                    });

                    console.error("❌ Error generating embeddings:", error);
                    throw new Error(
                        `Failed to generate embeddings: ${
                            error instanceof Error
                                ? error.message
                                : "Unknown error"
                        }`
                    );
                }
            },
            {
                provider: "embedding_service",
                model: "text-embedding-3-large",
                dimensions: 3072,
                timeout_enabled: true,
                load_balancing_enabled: true,
            }
        );

        // Extract just the embeddings for the return value
        return typeof result === "object" && result && "result" in result
            ? result.result
            : (result as number[]);
    }

    /**
     * Generate embeddings for multiple texts with load balancing
     * This is where the load balancing magic happens for batch operations
     */
    async generateBatchEmbeddings(
        texts: string[],
        timeoutSeconds?: number
    ): Promise<(number[] | null)[]> {
        if (texts.length === 0) {
            return [];
        }

        const qaConfig = Config.app.getQAConfig();
        const timeout =
            timeoutSeconds !== undefined
                ? timeoutSeconds
                : qaConfig.embeddingTimeout;

        return await sentryMonitoringService.track(
            "batch_embeddings_generation",
            "embedding",
            {
                batch_size: texts.length,
                timeout_seconds: timeout,
                load_balancing_enabled: true,
                has_secondary_client: !!this.secondaryClient,
                total_text_length: texts.reduce(
                    (sum, text) => sum + text.length,
                    0
                ),
                avg_text_length: Math.round(
                    texts.reduce((sum, text) => sum + text.length, 0) /
                        texts.length
                ),
            },
            async () => {
                console.log(
                    `🧮 Processing ${texts.length} embeddings with load balancing [ENABLED]...`
                );

                // If no secondary client, use primary for all
                if (!this.secondaryClient) {
                    console.log(
                        `🧮 Processing ${texts.length} embeddings with primary model only`
                    );
                    return await this.processBatchWithSingleClient(
                        texts,
                        this.primaryClient,
                        "primary",
                        timeout
                    );
                }

                // Load balancing: split texts between two models
                const midpoint = Math.ceil(texts.length / 2);
                const firstHalf = texts.slice(0, midpoint);
                const secondHalf = texts.slice(midpoint);

                console.log(
                    `🔀 Load balancing ${texts.length} embeddings: ${firstHalf.length} to primary, ${secondHalf.length} to secondary`
                );

                // Process both halves in parallel
                const [firstHalfResults, secondHalfResults] = await Promise.all(
                    [
                        firstHalf.length > 0
                            ? this.processBatchWithSingleClient(
                                  firstHalf,
                                  this.primaryClient,
                                  "primary",
                                  timeout
                              )
                            : Promise.resolve([]),
                        secondHalf.length > 0
                            ? this.processBatchWithSingleClient(
                                  secondHalf,
                                  this.secondaryClient!,
                                  "secondary",
                                  timeout
                              )
                            : Promise.resolve([]),
                    ]
                );

                // Combine results in original order
                const combinedResults = [
                    ...firstHalfResults,
                    ...secondHalfResults,
                ];
                const successCount = combinedResults.filter(
                    (r) => r !== null
                ).length;

                console.log(
                    `✅ Completed batch embedding generation: ${successCount}/${texts.length} successful`
                );

                return combinedResults;
            },
            {
                provider: "load_balanced_embedding_service",
                model: "text-embedding-3-large",
                component: "ai",
                batch_processing: true,
                load_balancing: this.isLoadBalancingActive(),
            }
        );
    }

    /**
     * Process a batch of texts with a single client
     */
    private async processBatchWithSingleClient(
        texts: string[],
        client: OpenAI,
        clientType: "primary" | "secondary",
        timeoutSeconds: number
    ): Promise<(number[] | null)[]> {
        const timeoutMs = timeoutSeconds * 1000;

        return await sentryMonitoringService.track(
            `load_balanced_batch_embeddings_${clientType}`,
            "embedding",
            {
                batch_size: texts.length,
                client_type: clientType,
                timeout_seconds: timeoutSeconds,
                model: "text-embedding-3-large",
                total_text_length: texts.reduce(
                    (sum, text) => sum + text.length,
                    0
                ),
            },
            async () => {
                console.log(
                    `🚀 Starting ${clientType} embedding generation for ${texts.length} texts - ALL IN PARALLEL with individual ${timeoutSeconds}s timeouts...`
                );

                // Process ALL texts in parallel with individual timeout handling (no concurrency limit)
                const embeddingPromises = texts.map(async (text, index) => {
                    const requestId = `${clientType}-${index}`;

                    return await sentryMonitoringService
                        .track(
                            `individual_embedding_${clientType}`,
                            "embedding",
                            {
                                text_length: text.length,
                                text_preview: text.substring(0, 50),
                                index,
                                client_type: clientType,
                                request_id: requestId,
                                timeout_seconds: timeoutSeconds,
                            },
                            async () => {
                                const embeddingPromise =
                                    client.embeddings.create({
                                        model: "text-embedding-3-large",
                                        input: text,
                                        encoding_format: "float",
                                    });

                                const response =
                                    timeoutSeconds > 0
                                        ? await withTimeout(
                                              embeddingPromise,
                                              timeoutMs,
                                              `batch embedding ${index} (${clientType})`
                                          )
                                        : await embeddingPromise;

                                if (!response.data[0]?.embedding) {
                                    console.warn(
                                        `⚠️ No embeddings returned for text ${index} (${clientType})`
                                    );
                                    return null;
                                }

                                const embedding = response.data[0].embedding;

                                return {
                                    result: embedding,
                                    usage: {
                                        ...response.usage,
                                        cost: this.calculateEmbeddingCost(
                                            response.usage
                                        ),
                                        model: "text-embedding-3-large",
                                        provider: `load_balanced_${clientType}_azure_openai`,
                                    },
                                };
                            },
                            {
                                provider: `load_balanced_embedding_${clientType}`,
                                model: "text-embedding-3-large",
                                individual_request: true,
                            }
                        )
                        .catch((error) => {
                            // Log the timeout/error but don't fail the entire process
                            const errorMsg =
                                error instanceof Error
                                    ? error.message
                                    : "Unknown error";

                            if (errorMsg.includes("Timeout")) {
                                console.warn(
                                    `⏰ Skipping text ${index} (${clientType}) due to embedding timeout after ${timeoutSeconds}s`
                                );
                            } else {
                                console.warn(
                                    `⚠️ Skipping text ${index} (${clientType}) due to error: ${errorMsg}`
                                );
                            }
                            return null;
                        });
                });

                // Wait for ALL requests to complete in parallel
                const results = await Promise.all(embeddingPromises);

                const successCount = results.filter((r) => r !== null).length;
                const failedCount = results.length - successCount;

                console.log(
                    `✅ Generated ${successCount}/${texts.length} embeddings with ${clientType} client` +
                        (failedCount > 0
                            ? ` (${failedCount} failed/timed out gracefully)`
                            : "")
                );

                // Extract just the embeddings from results
                return results.map((result) =>
                    result && typeof result === "object" && "result" in result
                        ? result.result
                        : result
                );
            },
            {
                provider: `load_balanced_embedding_${clientType}`,
                model: "text-embedding-3-large",
                batch_processing: true,
                component: "ai",
            }
        );
    }

    /**
     * Calculate the cost of embedding generation based on token consumption
     */
    private calculateEmbeddingCost(usage: any): number {
        if (!usage?.total_tokens) {
            return 0;
        }

        // Pricing for text-embedding-3-large: $0.00013 per 1K tokens
        const pricePerThousandTokens = 0.00013;
        const cost = (usage.total_tokens / 1000) * pricePerThousandTokens;

        return Number(cost.toFixed(6));
    }

    /**
     * Get current load balancing status
     */
    public isLoadBalancingActive(): boolean {
        return !!this.secondaryClient;
    }
}
