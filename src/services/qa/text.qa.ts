import { sentryMonitoringService } from "../monitoring";
import { InMemoryVectorService } from "../search";
import { AppConfigService } from "../../config/app.config";
import { EmbeddingService } from "../embeddings";
import { BatchedEmbeddingService } from "../embeddings";
import { LLMService } from "../LLM/core.LLM";
import { streamingService } from "../LLM";
import { FANTASTIC_ROBO_SYSTEM_PROMPT } from "../../prompts/prompt8";
import { TOOL_AWARE_SYSTEM_PROMPT_ENHANCED } from "../../prompts/prompts";
import {
  urlDetection as urlDetectionService,
  webContextService,
} from "../webScraping";
import type { DocumentChunk, QuestionAnswer } from "../../types/document.types";
import type { TimerContext } from "../timer";

export class InMemoryQAService {
  private embeddingService: EmbeddingService;
  private batchedEmbeddingService: BatchedEmbeddingService;
  private llmService: LLMService;
  private vectorService: InMemoryVectorService;
  private configService: AppConfigService;
  private totalPages: number = 0; // Store total pages for dynamic chunking
  private documentType: "general" | "excel" = "general"; // Track document type
  private fileName: string = ""; // Store filename for reference

  constructor() {
    this.embeddingService = new EmbeddingService();
    this.batchedEmbeddingService = new BatchedEmbeddingService();
    this.llmService = new LLMService();
    this.vectorService = new InMemoryVectorService();
    this.configService = AppConfigService.getInstance();
  }

  /**
   * Detect document type based on filename extension
   */
  private detectDocumentType(fileName: string): "general" | "excel" {
    const extension = fileName.toLowerCase().split(".").pop();
    return extension === "xlsx" || extension === "xls" ? "excel" : "general";
  }

  /**
   * Process document chunks and store them in memory with embeddings using load balancing
   */
  async processDocument(
    chunks: DocumentChunk[],
    fileName: string,
    totalPages?: number
  ): Promise<void> {
    // Store filename and detect document type
    this.fileName = fileName;
    this.documentType = this.detectDocumentType(fileName);

    // Store total pages for dynamic chunking
    if (totalPages !== undefined) {
      this.totalPages = totalPages;
    }

    console.log(
      `📄 Processing ${fileName} as ${this.documentType} document type (load balanced)`
    );

    return await sentryMonitoringService.track(
      "load_balanced_document_processing",
      "pdf_processing",
      {
        filename: fileName,
        total_chunks: chunks.length,
        embedding_load_balancing_enabled:
          this.embeddingService.isLoadBalancingActive(),
        has_secondary_embedding_client:
          this.embeddingService.isLoadBalancingActive(),
        total_content_length: chunks.reduce(
          (sum, chunk) => sum + chunk.content.length,
          0
        ),
        avg_chunk_length: Math.round(
          chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) /
            chunks.length
        ),
      },
      async () => {
        console.log(
          `📄 Processing ${chunks.length} chunks for in-memory storage with load balancing and batching...`
        );

        // Use the new batched embedding service which includes load balancing
        console.log(
          `🔀 Using batched embedding processing with load balancing for ${chunks.length} chunks`
        );

        // Extract all chunk texts
        const chunkTexts = chunks.map((chunk) => chunk.content);

        // Generate embeddings using batched service (includes load balancing)
        const qaConfig = this.configService.getQAConfig();
        const embeddings =
          await this.batchedEmbeddingService.generateBatchEmbeddings(
            chunkTexts,
            qaConfig.embeddingTimeout
          );

        // Store chunks and embeddings directly
        await this.storeChunksWithPrecomputedEmbeddings(
          chunks,
          embeddings,
          fileName
        );

        const stats = this.vectorService.getStats();
        console.log(
          `💾 Memory usage: ${stats.estimatedMemoryMB}MB (${
            stats.chunkCount
          } chunks) [Load Balancing: ${
            this.embeddingService.isLoadBalancingActive()
              ? "ACTIVE"
              : "INACTIVE"
          }]`
        );
      },
      {
        component: "load_balanced_in_memory_qa_service",
        operation: "document_processing",
        load_balancing_enabled: this.embeddingService.isLoadBalancingActive(),
      }
    );
  }

  /**
   * Store chunks with precomputed embeddings directly in vector service
   */
  private async storeChunksWithPrecomputedEmbeddings(
    chunks: DocumentChunk[],
    embeddings: (number[] | null)[],
    fileName: string
  ): Promise<void> {
    return await sentryMonitoringService.track(
      "load_balanced_store_precomputed_embeddings",
      "vector_search",
      {
        filename: fileName,
        total_chunks: chunks.length,
        total_embeddings: embeddings.length,
        successful_embeddings: embeddings.filter((e) => e !== null).length,
        failed_embeddings: embeddings.filter((e) => e === null).length,
      },
      async () => {
        // Filter successful embeddings and corresponding chunks
        const validData: Array<{
          chunk: DocumentChunk;
          embedding: number[];
        }> = [];

        chunks.forEach((chunk, index) => {
          const embedding = embeddings[index];
          if (embedding && embedding.length > 0) {
            validData.push({ chunk, embedding });
          }
        });

        // Store in vector service by accessing its internal storage directly
        // This bypasses the embedding generation since we already have embeddings
        const chunkData = validData.map(({ chunk, embedding }, index) => ({
          content: chunk.content,
          embedding,
          pageNumber: chunk.pageNumber,
          chunkIndex: index,
          metadata: chunk.metadata,
          fileName,
        }));

        // Store directly in the vector service's internal storage
        (this.vectorService as any).embeddings = chunkData;

        // Set dimensions from first embedding
        if (chunkData.length > 0 && chunkData[0]) {
          (this.vectorService as any).dimensions =
            chunkData[0].embedding.length;
        }

        // Build HNSW index if enabled
        const searchConfig = this.configService.getQAConfig().vectorSearch;
        if (searchConfig.useHNSW && chunkData.length > 0) {
          await (this.vectorService as any).buildHNSWIndex();
        }

        const failedCount = chunks.length - validData.length;
        if (failedCount > 0) {
          console.warn(
            `⚠️ Skipped ${failedCount} chunks due to embedding failures out of ${chunks.length} total chunks`
          );
        }

        console.log(
          `✅ Successfully stored ${
            validData.length
          } chunks with precomputed embeddings out of ${
            chunks.length
          } total chunks${searchConfig.useHNSW ? " with HNSW index" : ""}`
        );
      },
      {
        component: "load_balanced_in_memory_qa_service",
        operation: "store_precomputed_embeddings",
        vector_search_enabled:
          this.configService.getQAConfig().vectorSearch.useHNSW,
      }
    );
  }

  /**
   * Pre-generate embeddings for questions while PDF is downloading/processing
   * This optimization runs in parallel with PDF download to save time
   */
  async preGenerateQuestionEmbeddings(
    questions: string[]
  ): Promise<number[][]> {
    if (questions.length === 0) return [];

    console.log(
      `🧮 Pre-generating embeddings for ${questions.length} questions (parallel optimization)...`
    );

    try {
      // Get question embedding timeout from config
      const qaConfig = this.configService.getQAConfig();
      const questionTimeout = qaConfig.questionEmbeddingTimeout;

      console.log(
        `⏰ Using ${questionTimeout}s timeout for question embeddings`
      );

      if (
        this.embeddingService.isLoadBalancingActive() &&
        this.embeddingService.generateBatchEmbeddings
      ) {
        // Use batch processing with load balancing
        const embeddings = await this.embeddingService.generateBatchEmbeddings(
          questions,
          questionTimeout // Use question-specific timeout
        );

        // Filter out null results and only return successful embeddings
        const validEmbeddings = embeddings.filter(
          (embedding): embedding is number[] => embedding !== null
        );

        console.log(
          `✅ Pre-generated ${validEmbeddings.length}/${questions.length} question embeddings using load-balanced batch processing`
        );

        return validEmbeddings;
      } else {
        // Fallback to individual processing
        const embeddingPromises = questions.map(async (question) => {
          try {
            return await this.embeddingService.generateEmbeddings(
              question,
              questionTimeout // Use question-specific timeout
            );
          } catch (error) {
            console.warn(
              `⚠️ Failed to pre-generate embedding for question: "${question.substring(
                0,
                50
              )}..."`
            );
            return null;
          }
        });

        const embeddings = await Promise.all(embeddingPromises);
        const validEmbeddings = embeddings.filter(
          (embedding): embedding is number[] => embedding !== null
        );

        console.log(
          `✅ Pre-generated ${validEmbeddings.length}/${questions.length} question embeddings individually`
        );

        return validEmbeddings;
      }
    } catch (error) {
      console.error(
        `❌ Failed to pre-generate question embeddings: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      // Return empty array to indicate failure - caller will handle gracefully
      return [];
    }
  }

  /**
   * Answer multiple questions using precomputed embeddings for optimal performance
   * This method skips the embedding generation step and uses pre-generated embeddings
   */
  async answerMultipleQuestionsWithPrecomputedEmbeddings(
    questions: string[],
    precomputedEmbeddings: number[][],
    fileName: string
  ): Promise<QuestionAnswer[]> {
    if (questions.length === 0) return [];

    // Validate that we have embeddings for all questions
    if (precomputedEmbeddings.length !== questions.length) {
      console.warn(
        `⚠️ Mismatch between questions (${questions.length}) and precomputed embeddings (${precomputedEmbeddings.length}), falling back to regular processing`
      );
      return this.answerMultipleQuestions(questions, fileName);
    }

    return await sentryMonitoringService.track(
      "precomputed_embeddings_qa_pipeline",
      "qa_pipeline",
      {
        question_count: questions.length,
        file_name: fileName,
        optimization: "precomputed_embeddings",
      },
      async () => {
        console.log(
          `⚡ Processing ${questions.length} questions with PRECOMPUTED embeddings optimization...`
        );

        // Step 1: Process each question with its precomputed embedding
        const qaConfig = this.configService.getQAConfig();
        const dynamicChunksToLLM = this.configService.getDynamicChunksToLLM(
          this.totalPages
        );

        const contextPromises = questions.map(async (question, index) => {
          const queryEmbedding = precomputedEmbeddings[index]!;

          // Find similar chunks using precomputed embedding
          const similarChunks = await sentryMonitoringService.track(
            "precomputed_vector_search",
            "vector_search",
            {
              query_dimensions: queryEmbedding.length,
              search_limit: dynamicChunksToLLM,
              question_index: index,
              total_pages: this.totalPages,
              dynamic_chunks_enabled: qaConfig.dynamicChunking.enabled,
            },
            async () => {
              return this.vectorService.findSimilar(
                queryEmbedding,
                dynamicChunksToLLM
              );
            },
            {
              component: "vector_search",
              search_type: `precomputed_${this.vectorService
                .getSearchMethod()
                .toLowerCase()
                .replace(" ", "_")}_similarity`,
            }
          );

          if (similarChunks.length === 0) {
            return {
              question,
              systemPrompt: "",
              userMessage: "",
            };
          }

          // Build context from retrieved chunks
          const context = similarChunks
            .slice(0, dynamicChunksToLLM)
            .map(
              (chunk: any, chunkIndex: number) =>
                `[Context ${chunkIndex + 1}]:\n${chunk.content}\n`
            )
            .join("\n");

          const systemPrompt = FANTASTIC_ROBO_SYSTEM_PROMPT;
          const userMessage = `Context:\n${context}\n\nQuestion: ${question}`;

          return {
            question,
            systemPrompt,
            userMessage,
          };
        });

        // Wait for all context preparation to complete
        const contextResults = await Promise.all(contextPromises);

        // Step 2: Generate responses with load-balanced LLM processing
        let answers: string[] = [];

        if (
          this.llmService.isLoadBalancingActive() &&
          this.llmService.generateBatchResponses
        ) {
          console.log(
            `🤖 Generating ${contextResults.length} responses with load-balanced LLM processing (precomputed embeddings)...`
          );

          // Extract system prompts and user messages
          const systemPrompts = contextResults.map((ctx) => ctx.systemPrompt);
          const userMessages = contextResults.map((ctx) => ctx.userMessage);

          try {
            answers = await this.llmService.generateBatchResponses(
              systemPrompts,
              userMessages
            );
            console.log(
              `✅ Generated ${answers.length} responses using load-balanced LLM batch processing (precomputed embeddings)`
            );
          } catch (error) {
            console.error(
              "❌ Batch LLM generation failed, falling back to individual processing"
            );
            answers = await this.generateAnswersIndividually(contextResults);
          }
        } else {
          // Generate answers individually without load balancing
          answers = await this.generateAnswersIndividually(contextResults);
        }

        // Step 3: Create results array
        const results: QuestionAnswer[] = questions.map((question, index) => ({
          question,
          answer: answers[index] || "Unable to process this question.",
        }));

        console.log(
          `🎉 Completed PRECOMPUTED EMBEDDINGS processing of ${questions.length} questions`
        );
        return results;
      },
      {
        component: "precomputed_embeddings_qa_pipeline",
        version: "4.0.0",
        optimization: "precomputed_embeddings",
      }
    );
  }

  /**
   * Answer multiple questions efficiently with load-balanced batch processing
   */
  async answerMultipleQuestions(
    questions: string[],
    fileName: string
  ): Promise<QuestionAnswer[]> {
    if (questions.length === 0) return [];

    return await sentryMonitoringService.track(
      "load_balanced_batch_qa_pipeline",
      "qa_pipeline",
      {
        question_count: questions.length,
        file_name: fileName,
        embedding_load_balancing: this.embeddingService.isLoadBalancingActive(),
        llm_load_balancing: this.llmService.isLoadBalancingActive(),
        total_question_length: questions.reduce((sum, q) => sum + q.length, 0),
        avg_question_length: Math.round(
          questions.reduce((sum, q) => sum + q.length, 0) / questions.length
        ),
      },
      async () => {
        console.log(
          `❓ Processing ${questions.length} questions with LOAD-BALANCED optimization...`
        );
        console.log(
          `🔀 Embedding Load Balancing: ${
            this.embeddingService.isLoadBalancingActive()
              ? "ACTIVE"
              : "INACTIVE"
          }`
        );
        console.log(
          `🔀 LLM Load Balancing: ${
            this.llmService.isLoadBalancingActive() ? "ACTIVE" : "INACTIVE"
          }`
        );

        // Get question embedding timeout from config
        const qaConfig = this.configService.getQAConfig();
        const questionTimeout = qaConfig.questionEmbeddingTimeout;

        console.log(
          `⏰ Using ${questionTimeout}s timeout for question embeddings`
        );

        // Step 1: Generate ALL query embeddings with load balancing
        console.log(
          `🧮 Generating embeddings for ${questions.length} questions with load balancing...`
        );

        let queryEmbeddings: (number[] | null)[] = [];

        if (
          this.embeddingService.isLoadBalancingActive() &&
          this.embeddingService.generateBatchEmbeddings
        ) {
          // Use batch load-balanced embedding generation
          try {
            const batchEmbeddings =
              await this.embeddingService.generateBatchEmbeddings(
                questions,
                questionTimeout // Use question-specific timeout
              );
            queryEmbeddings = batchEmbeddings;
            console.log(
              `✅ Generated ${batchEmbeddings.length} embeddings using load-balanced batch processing`
            );
          } catch (error) {
            console.error(
              "❌ Batch embedding generation failed, falling back to individual processing"
            );
            // Fallback to individual processing
            queryEmbeddings = await this.generateEmbeddingsIndividually(
              questions
            );
          }
        } else {
          // Generate embeddings individually without load balancing
          queryEmbeddings = await this.generateEmbeddingsIndividually(
            questions
          );
        }

        // Filter out null results and track which questions succeeded
        const successfulQuestions: string[] = [];
        const validQueryEmbeddings: number[][] = [];
        const questionIndexMap: number[] = [];

        queryEmbeddings.forEach((embedding, originalIndex) => {
          if (embedding) {
            successfulQuestions.push(questions[originalIndex]!);
            validQueryEmbeddings.push(embedding);
            questionIndexMap.push(originalIndex);
          }
        });

        const failedQuestionCount =
          questions.length - successfulQuestions.length;
        if (failedQuestionCount > 0) {
          console.warn(
            `⚠️ ${failedQuestionCount} questions failed embedding generation and will be skipped`
          );
        }

        // Step 2: Process each successful question
        const dynamicChunksToLLM = this.configService.getDynamicChunksToLLM(
          this.totalPages
        );

        const contextPromises = successfulQuestions.map(
          async (question, successIndex) => {
            const queryEmbedding = validQueryEmbeddings[successIndex]!;

            // Find similar chunks using pre-generated embedding
            const similarChunks = await sentryMonitoringService.track(
              "load_balanced_vector_search",
              "vector_search",
              {
                query_dimensions: queryEmbedding.length,
                search_limit: dynamicChunksToLLM,
                question_index: successIndex,
                total_pages: this.totalPages,
                dynamic_chunks_enabled: qaConfig.dynamicChunking.enabled,
              },
              async () => {
                return this.vectorService.findSimilar(
                  queryEmbedding,
                  dynamicChunksToLLM
                );
              },
              {
                component: "vector_search",
                search_type: `load_balanced_${this.vectorService
                  .getSearchMethod()
                  .toLowerCase()
                  .replace(" ", "_")}_similarity`,
              }
            );

            if (similarChunks.length === 0) {
              return {
                question,
                systemPrompt: "",
                userMessage: "",
              };
            }

            // Build context from retrieved chunks
            const context = similarChunks
              .slice(0, dynamicChunksToLLM)
              .map(
                (chunk: any, index: number) =>
                  `[Context ${index + 1}]:\n${chunk.content}\n`
              )
              .join("\n");

            const systemPrompt = FANTASTIC_ROBO_SYSTEM_PROMPT;
            const userMessage = `Context:\n${context}\n\nQuestion: ${question}`;

            return {
              question,
              systemPrompt,
              userMessage,
            };
          }
        );

        // Wait for all context preparation to complete
        const contextResults = await Promise.all(contextPromises);

        // Step 3: Generate responses with load-balanced LLM processing
        let answers: string[] = [];

        if (
          this.llmService.isLoadBalancingActive() &&
          this.llmService.generateBatchResponses
        ) {
          console.log(
            `🤖 Generating ${contextResults.length} responses with load-balanced LLM processing...`
          );

          // Extract system prompts and user messages
          const systemPrompts = contextResults.map((ctx) => ctx.systemPrompt);
          const userMessages = contextResults.map((ctx) => ctx.userMessage);

          try {
            answers = await this.llmService.generateBatchResponses(
              systemPrompts,
              userMessages
            );
            console.log(
              `✅ Generated ${answers.length} responses using load-balanced LLM batch processing`
            );
          } catch (error) {
            console.error(
              "❌ Batch LLM generation failed, falling back to individual processing"
            );
            // Fallback to individual processing
            answers = await this.generateAnswersIndividually(contextResults);
          }
        } else {
          // Generate answers individually without load balancing
          answers = await this.generateAnswersIndividually(contextResults);
        }

        // Step 4: Create complete results array including failed questions
        const completeResults: QuestionAnswer[] = [];

        questions.forEach((originalQuestion, originalIndex) => {
          const successIndex = questionIndexMap.indexOf(originalIndex);

          if (successIndex !== -1 && answers[successIndex]) {
            completeResults.push({
              question: originalQuestion,
              answer: answers[successIndex]!,
            });
          } else {
            completeResults.push({
              question: originalQuestion,
              answer:
                "I couldn't process this question due to a timeout during embedding generation. Please try rephrasing your question or contact support if this persists.",
            });
          }
        });

        console.log(
          `🎉 Completed LOAD-BALANCED processing of ${questions.length} questions (${answers.length} successful, ${failedQuestionCount} failed)`
        );
        return completeResults;
      },
      {
        component: "load_balanced_batch_qa_pipeline",
        version: "3.0.0",
        embedding_load_balancing: this.embeddingService.isLoadBalancingActive(),
        llm_load_balancing: this.llmService.isLoadBalancingActive(),
      }
    );
  }

  /**
   * Fallback method to generate embeddings individually
   */
  private async generateEmbeddingsIndividually(
    questions: string[]
  ): Promise<(number[] | null)[]> {
    return await sentryMonitoringService.track(
      "load_balanced_individual_embeddings_generation",
      "embedding",
      {
        question_count: questions.length,
        fallback_mode: true,
        load_balancing_available: this.embeddingService.isLoadBalancingActive(),
      },
      async () => {
        console.log(
          `🧮 Generating ${questions.length} embeddings individually...`
        );

        // Get question embedding timeout from config
        const qaConfig = this.configService.getQAConfig();
        const questionTimeout = qaConfig.questionEmbeddingTimeout;

        console.log(
          `⏰ Using ${questionTimeout}s timeout for individual question embeddings`
        );

        const queryEmbeddingPromises = questions.map(
          async (question, index) => {
            return await sentryMonitoringService
              .track(
                "individual_question_embedding",
                "embedding",
                {
                  question_length: question.length,
                  question_preview: question.substring(0, 100),
                  question_index: index,
                },
                async () => {
                  return await this.embeddingService.generateEmbeddings(
                    question,
                    questionTimeout // Use question-specific timeout
                  );
                },
                {
                  component: "load_balanced_qa_service",
                  operation: "individual_embedding_fallback",
                }
              )
              .catch((error) => {
                console.error(
                  `❌ Failed to generate embedding for question ${index + 1}:`,
                  error
                );
                return null;
              });
          }
        );

        return await Promise.all(queryEmbeddingPromises);
      },
      {
        component: "load_balanced_qa_service",
        operation: "individual_embeddings_fallback",
        fallback_processing: true,
      }
    );
  }

  /**
   * Fallback method to generate answers individually
   */
  private async generateAnswersIndividually(
    contextResults: Array<{
      question: string;
      systemPrompt: string;
      userMessage: string;
    }>
  ): Promise<string[]> {
    return await sentryMonitoringService.track(
      "load_balanced_individual_answers_generation",
      "llm",
      {
        context_count: contextResults.length,
        fallback_mode: true,
        load_balancing_available: this.llmService.isLoadBalancingActive(),
        total_system_prompt_length: contextResults.reduce(
          (sum, ctx) => sum + ctx.systemPrompt.length,
          0
        ),
        total_user_message_length: contextResults.reduce(
          (sum, ctx) => sum + ctx.userMessage.length,
          0
        ),
      },
      async () => {
        console.log(
          `🤖 Generating ${contextResults.length} responses individually...`
        );

        const answerPromises = contextResults.map(
          async ({ question, systemPrompt, userMessage }, index) => {
            if (!systemPrompt || !userMessage) {
              return "No relevant context found to answer this question.";
            }

            try {
              return await sentryMonitoringService.track(
                "load_balanced_individual_llm_generation",
                "llm",
                {
                  question_index: index,
                  system_prompt_length: systemPrompt.length,
                  user_message_length: userMessage.length,
                  question_preview: question.substring(0, 100),
                  fallback_mode: true,
                },
                async () => {
                  // Use standard load-balanced LLM for all document types
                  return await this.llmService.generateResponse(
                    systemPrompt,
                    userMessage
                  );
                },
                {
                  component: "load_balanced_qa_service",
                  operation: "individual_answer_generation_fallback",
                }
              );
            } catch (error) {
              console.error(
                `❌ Failed to generate answer for question ${index + 1}:`,
                error
              );
              return "Unable to generate an answer due to an error.";
            }
          }
        );

        return await Promise.all(answerPromises);
      },
      {
        component: "load_balanced_qa_service",
        operation: "individual_answers_fallback",
        fallback_processing: true,
      }
    );
  }

  /**
   * Answer a single question (kept for backward compatibility)
   */
  async answerQuestion(
    question: string,
    fileName: string
  ): Promise<QuestionAnswer> {
    const results = await this.answerMultipleQuestions([question], fileName);
    return results[0]!;
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats() {
    return this.vectorService.getStats();
  }

  /**
   * Clean up memory by clearing all stored embeddings
   */
  cleanup(): void {
    console.log("🧹 Cleaning up load-balanced in-memory QA service...");
    this.vectorService.clear();
  }

  /**
   * Answer multiple questions with streaming responses and global timer support
   * This method implements the global timer and streaming functionality
   */
  async answerMultipleQuestionsWithStreaming(
    questions: string[],
    fileName: string,
    timerContext: TimerContext
  ): Promise<string[]> {
    if (questions.length === 0) return [];

    return await sentryMonitoringService.track(
      "load_balanced_streaming_qa_pipeline",
      "qa_pipeline",
      {
        question_count: questions.length,
        file_name: fileName,
        timer_enabled: !timerContext.isExpired,
        streaming_enabled: true,
        embedding_load_balancing: this.embeddingService.isLoadBalancingActive(),
        llm_load_balancing: this.llmService.isLoadBalancingActive(),
      },
      async () => {
        console.log(
          `🌊 Processing ${
            questions.length
          } questions with STREAMING + TIMER (${
            Math.round((timerContext.timeoutMs / 1000) * 10) / 10
          }s timeout)...`
        );

        // Check if timer is already expired before starting
        if (timerContext.isExpired) {
          console.warn("⚠️ Timer already expired before processing started");
          return questions.map(
            () =>
              "I apologize, but the request timed out before processing could begin. Please try again."
          );
        }

        // Step 1: Generate question embeddings (with timer check)
        const qaConfig = this.configService.getQAConfig();
        let questionEmbeddings: number[][] = [];

        try {
          if (timerContext.isExpired) {
            throw new Error("Timer expired during embedding generation");
          }

          if (
            this.embeddingService.isLoadBalancingActive() &&
            this.embeddingService.generateBatchEmbeddings
          ) {
            const batchResults =
              await this.embeddingService.generateBatchEmbeddings(
                questions,
                qaConfig.questionEmbeddingTimeout
              );
            questionEmbeddings = batchResults.filter(
              (emb): emb is number[] => emb !== null
            );
          } else {
            // Fallback to individual embeddings
            const embeddingPromises = questions.map(async (question, index) => {
              if (timerContext.isExpired) return null;
              try {
                return await this.embeddingService.generateEmbeddings(
                  question,
                  qaConfig.questionEmbeddingTimeout
                );
              } catch (error) {
                console.warn(
                  `⚠️ Failed to generate embedding for question ${index + 1}`
                );
                return null;
              }
            });

            const results = await Promise.all(embeddingPromises);
            questionEmbeddings = results.filter(
              (emb): emb is number[] => emb !== null
            );
          }

          console.log(
            `✅ Generated ${questionEmbeddings.length}/${questions.length} question embeddings`
          );
        } catch (error) {
          console.error("❌ Failed to generate question embeddings:", error);
          return questions.map(
            () =>
              "I apologize, but there was an error processing your question. Please try again."
          );
        }

        // Step 2: Prepare all contexts for batch streaming (respecting timer)
        const dynamicChunksToLLM = this.configService.getDynamicChunksToLLM(
          this.totalPages
        );

        console.log(
          `🔍 Preparing contexts for ${questions.length} questions with load-balanced batch streaming...`
        );

        // Prepare all system prompts and user messages in parallel
        const contextPromises = questions.map(async (question, index) => {
          if (timerContext.isExpired) {
            return {
              systemPrompt: "",
              userMessage: "",
              error: "Timer expired during context preparation",
            };
          }

          const embedding = questionEmbeddings[index];
          if (!embedding) {
            return {
              systemPrompt: "",
              userMessage: "",
              error: "No embedding available",
            };
          }

          try {
            // Find similar chunks
            const similarChunks = await this.vectorService.findSimilar(
              embedding,
              dynamicChunksToLLM
            );

            if (similarChunks.length === 0) {
              return {
                systemPrompt: "",
                userMessage: "",
                error: "No relevant context found",
              };
            }

            // Tool-call augmentation
            let augmentedChunks = similarChunks;
            try {
              const qaConfig2 = this.configService.getQAConfig();
              if (qaConfig2.toolCalls?.enabled) {
                const intent = urlDetectionService.classifyUrlIntent(question);
                if (intent.requiresUrl) {
                  const { webChunks } =
                    await webContextService.enrichContextWithWebContent({
                      question,
                      retrievedChunks: similarChunks.map((c) => ({
                        content: c.content,
                        pageNumber: c.pageNumber,
                        chunkIndex: c.chunkIndex,
                      })),
                      timerAbort: timerContext.abortController.signal,
                    });
                  if (webChunks.length > 0) {
                    const texts = webChunks.map((c) => c.content);
                    const embeddingsWeb =
                      await this.batchedEmbeddingService.generateBatchEmbeddings(
                        texts,
                        qaConfig2.embeddingTimeout
                      );
                    const appendPayload = webChunks
                      .map((c, i) => ({
                        content: c.content,
                        embedding: embeddingsWeb[i] || [],
                        pageNumber: c.pageNumber,
                        chunkIndex: i,
                        metadata: {
                          ...(c.metadata || {}),
                          source: "web",
                        },
                        fileName: this.fileName || "web",
                      }))
                      .filter((x) => x.embedding.length > 0);
                    await this.vectorService.appendPrecomputedEmbeddings(
                      appendPayload
                    );
                    augmentedChunks = await this.vectorService.findSimilar(
                      embedding,
                      dynamicChunksToLLM
                    );
                  }
                }
              }
            } catch (e) {
              console.warn(
                "Tool-call augmentation failed, continuing without web context"
              );
            }

            // Build context
            const context = augmentedChunks
              .slice(0, dynamicChunksToLLM)
              .map(
                (chunk: any, chunkIndex: number) =>
                  `[Context ${chunkIndex + 1}]:\n${chunk.content}\n`
              )
              .join("\n");

            const systemPrompt = this.configService.getQAConfig().toolCalls
              ?.enabled
              ? TOOL_AWARE_SYSTEM_PROMPT_ENHANCED
              : FANTASTIC_ROBO_SYSTEM_PROMPT;
            const userMessage = `Context:\n${context}\n\nQuestion: ${question}`;

            return {
              systemPrompt,
              userMessage,
              error: null,
            };
          } catch (error) {
            console.error(
              `❌ Error preparing context for question ${index + 1}:`,
              error
            );
            return {
              systemPrompt: "",
              userMessage: "",
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        });

        const contextResults = await Promise.all(contextPromises);

        // Filter out failed contexts and prepare arrays for batch streaming
        const systemPrompts: string[] = [];
        const userMessages: string[] = [];
        const contextQuestionMap: number[] = []; // Track original question indices

        contextResults.forEach((result, index) => {
          if (!result.error && result.systemPrompt && result.userMessage) {
            systemPrompts.push(result.systemPrompt);
            userMessages.push(result.userMessage);
            contextQuestionMap.push(index);
          }
        });

        console.log(
          `✅ Prepared ${systemPrompts.length}/${questions.length} contexts for batch streaming`
        );

        // Step 3: Use load-balanced batch streaming for all valid questions
        let streamResults: string[] = [];

        if (systemPrompts.length > 0) {
          try {
            if (this.llmService.isLoadBalancingActive()) {
              console.log(
                `🌊🔀 Using load-balanced batch streaming for ${systemPrompts.length} questions (racing when enabled, cost-effective distribution when disabled)`
              );

              // Get all streams created in parallel with load balancing
              // Use standard load-balanced batch streaming for all document types
              const streams =
                await this.llmService.generateBatchStreamingResponses(
                  systemPrompts,
                  userMessages,
                  timerContext
                );

              // Convert all streams to text in parallel
              const streamTextPromises = streams.map(async (stream, index) => {
                try {
                  return await streamingService.streamToText(stream);
                } catch (error) {
                  console.error(
                    `❌ Error processing stream ${index + 1}:`,
                    error
                  );
                  return "I apologize, but there was an error generating the response.";
                }
              });

              streamResults = await Promise.all(streamTextPromises);

              console.log(
                `✅ Completed load-balanced batch streaming for ${streamResults.length} questions`
              );
            } else {
              console.log(
                `🌊 Load balancing not available, using single stream processing for ${systemPrompts.length} questions`
              );

              // Use individual streaming when batch streaming is not available
              const streamPromises = systemPrompts.map(
                async (systemPrompt, index) => {
                  const userMessage = userMessages[index];
                  if (!userMessage) return "Error: Missing user message";

                  try {
                    // Use standard load-balanced streaming for all document types
                    const stream = await this.llmService
                      .generateStreamingResponse!(
                      systemPrompt,
                      userMessage,
                      timerContext
                    );
                    return await streamingService.streamToText(stream);
                  } catch (error) {
                    console.error(
                      `❌ Error processing individual stream ${index + 1}:`,
                      error
                    );
                    return "I apologize, but there was an error generating the response.";
                  }
                }
              );

              streamResults = await Promise.all(streamPromises);
            }
          } catch (error) {
            console.error("❌ Error in batch streaming processing:", error);
            streamResults = systemPrompts.map(
              () =>
                "I apologize, but there was an error generating the response."
            );
          }
        }

        // Step 4: Map results back to original questions
        const finalResults: string[] = [];

        questions.forEach((question, originalIndex) => {
          const contextResult = contextResults[originalIndex];

          if (contextResult?.error) {
            // Handle errors from context preparation
            if (
              contextResult.error === "Timer expired during context preparation"
            ) {
              finalResults.push(
                "I apologize, but the request timed out during processing."
              );
            } else if (contextResult.error === "No embedding available") {
              finalResults.push(
                "I couldn't process this question due to an embedding generation error."
              );
            } else if (contextResult.error === "No relevant context found") {
              finalResults.push(
                "I couldn't find any relevant information in the document to answer your question."
              );
            } else {
              finalResults.push(
                "I apologize, but there was an error processing your question."
              );
            }
          } else {
            // Find the corresponding stream result
            const streamIndex = contextQuestionMap.indexOf(originalIndex);
            if (streamIndex >= 0 && streamResults[streamIndex]) {
              finalResults.push(streamResults[streamIndex]);
            } else {
              finalResults.push(
                "I apologize, but there was an error generating the response."
              );
            }
          }
        });

        console.log(
          `🎉 Completed load-balanced streaming processing of ${questions.length} questions`
        );

        return finalResults;

        console.log(
          `🎉 Completed streaming processing of ${questions.length} questions`
        );

        return finalResults;
      },
      {
        component: "load_balanced_streaming_qa_service",
        version: "1.0.0",
        timer_enabled: true,
        streaming_enabled: true,
      }
    );
  }

  /**
   * Answer multiple questions by sending the FULL parsed document content to the LLM.
   * Skips embeddings and vector search entirely. Uses streaming with the global timer.
   */
  async answerMultipleQuestionsWithFullContent(
    questions: string[],
    fullContent: string,
    timerContext: TimerContext
  ): Promise<string[]> {
    if (questions.length === 0) return [];

    return await sentryMonitoringService.track(
      "full_content_streaming_qa_pipeline",
      "qa_pipeline",
      {
        question_count: questions.length,
        timer_enabled: !timerContext.isExpired,
        streaming_enabled: true,
        context_length: fullContent?.length || 0,
      },
      async () => {
        if (timerContext.isExpired) {
          return questions.map(
            () =>
              "I apologize, but the request timed out before processing could begin. Please try again."
          );
        }

        const qa = this.configService.getQAConfig();
        const systemPrompt = qa.toolCalls?.enabled
          ? TOOL_AWARE_SYSTEM_PROMPT_ENHANCED
          : FANTASTIC_ROBO_SYSTEM_PROMPT;

        const systemPrompts = questions.map(() => systemPrompt);
        const userMessages = questions.map(
          (q) => `Context:\n${fullContent}\n\nQuestion: ${q}`
        );

        try {
          // EXCEPTION: Tools require NON-STREAMING because SDK tool-calls need synchronous execution
          // This is the only case where non-streaming is still used by necessity
          if (qa.toolCalls?.enabled) {
            console.log(
              "🛠️ Tools enabled: using non-streaming batch responses (required for tool call execution)"
            );
            return await this.llmService.generateBatchResponses(
              systemPrompts,
              userMessages
            );
          }

          // Use batch streaming when load balancing is available
          if (this.llmService.isLoadBalancingActive()) {
            const streams = await this.llmService
              .generateBatchStreamingResponses!(
              systemPrompts,
              userMessages,
              timerContext
            );
            const texts = await Promise.all(
              streams.map((s) => streamingService.streamToText(s))
            );
            return texts;
          }

          // Use individual streaming responses
          const answers = await Promise.all(
            userMessages.map(async (msg, index) => {
              if (timerContext.isExpired) {
                return "I apologize, but the request timed out during processing.";
              }
              try {
                const stream = await this.llmService.generateStreamingResponse!(
                  systemPrompts[index]!,
                  msg,
                  timerContext
                );
                return await streamingService.streamToText(stream);
              } catch (e) {
                return "I apologize, but there was an error generating the response.";
              }
            })
          );
          return answers;
        } catch (error) {
          console.error(
            "❌ Error in full-content streaming QA pipeline:",
            error
          );
          return questions.map(
            () => "I apologize, but there was an error generating the response."
          );
        }
      },
      {
        component: "load_balanced_streaming_qa_service",
        operation: "full_content_streaming",
        streaming_enabled: true,
      }
    );
  }

  /**
   * Get current search method being used
   */
  getSearchMethod(): string {
    return this.vectorService.getSearchMethod();
  }

  /**
   * Get load balancing status
   */
  getLoadBalancingStatus(): {
    embedding: boolean;
    llm: boolean;
  } {
    return {
      embedding: this.embeddingService.isLoadBalancingActive(),
      llm: this.llmService.isLoadBalancingActive(),
    };
  }
}
