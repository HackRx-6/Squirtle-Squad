import OpenAI, { AzureOpenAI } from "openai";
import { Config } from "../../config";
import { sentryMonitoringService } from "../monitoring";
import { loggingService } from "../logging";
import { streamingService } from "./streaming.LLM";
import type { LLMProvider } from "./types";
import type { TimerContext } from "../timer";
import { runWithToolsIfRequested, getRecommendedToolChoice } from "../tools";
import { PromptInjectionProtectionService } from "../cleaning/promptInjection.protection";

export class LLMService implements LLMProvider {
  private primaryClient: OpenAI;
  private secondaryClient: OpenAI | null = null;
  private claudePrimaryClient: OpenAI | null = null;
  private claudeSecondaryClient: OpenAI | null = null;
  private primaryConfig: any;
  private secondaryConfig: any;
  private claudeConfig: any;
  private logger: ReturnType<typeof loggingService.createComponentLogger>;

  constructor() {
    const aiConfig = Config.ai;

    this.primaryConfig = aiConfig.getPrimaryLLMConfig();
    this.secondaryConfig = aiConfig.getSecondaryLLMConfig();
    this.claudeConfig = {
      primary: aiConfig.getPrimaryClaudeConfig(),
      secondary: aiConfig.getSecondaryClaudeConfig(),
    };
    this.logger = loggingService.createComponentLogger("LLMService");

    // Log initialization
    this.logger.info("Initializing LLM Service", {
      loadBalancingEnabled: true, // Load balancing is now always enabled
      primaryModel: this.primaryConfig.model,
      primaryService: this.primaryConfig.service,
      hasSecondaryConfig: !!this.secondaryConfig,
    });

    // Initialize primary client
    if (this.primaryConfig.service === "azure") {
      this.primaryClient = new AzureOpenAI({
        endpoint: this.primaryConfig.baseURL,
        apiKey: this.primaryConfig.apiKey,
        deployment: this.primaryConfig.name,
        apiVersion: this.primaryConfig.apiVersion,
      });
    } else {
      this.primaryClient = new OpenAI({
        apiKey: this.primaryConfig.apiKey,
        baseURL: this.primaryConfig.baseURL,
      });
    }

    this.logger.info("Primary LLM client initialized", {
      service: this.primaryConfig.service,
      baseURL: this.primaryConfig.baseURL,
      model: this.primaryConfig.model,
    });

    // Initialize secondary client if available (load balancing is always enabled)
    if (this.secondaryConfig) {
      if (this.secondaryConfig.service === "azure") {
        this.secondaryClient = new AzureOpenAI({
          endpoint: this.secondaryConfig.baseURL,
          apiKey: this.secondaryConfig.apiKey,
          deployment: this.secondaryConfig.name,
          apiVersion: this.secondaryConfig.apiVersion,
        });
      } else {
        this.secondaryClient = new OpenAI({
          apiKey: this.secondaryConfig.apiKey,
          baseURL: this.secondaryConfig.baseURL,
        });
      }

      this.logger.info("Secondary LLM client initialized", {
        service: this.secondaryConfig.service,
        baseURL: this.secondaryConfig.baseURL,
        model: this.secondaryConfig.model,
      });

      console.log(
        `🔀 Load balancing enabled for LLM with secondary model: ${this.secondaryConfig.model}`
      );
    } else {
      this.logger.info("Load balancing disabled for LLM", {
        reason: false
          ? "load_balancing_disabled"
          : !aiConfig.hasSecondaryLLM()
          ? "no_secondary_llm_available"
          : "no_secondary_config",
      });
      console.log(`🔀 Load balancing disabled for LLM`);
    }

    console.log(
      `🔗 LLM Service initialized with primary baseURL: ${this.primaryConfig.baseURL}`
    );
    console.log(`🤖 Primary model: ${this.primaryConfig.model}`);
    if (this.secondaryConfig) {
      console.log(`🤖 Secondary model: ${this.secondaryConfig.model}`);
    }

    // Initialize Claude clients for Excel processing
    if (aiConfig.hasClaudeConfigured() && this.claudeConfig.primary.apiKey) {
      this.claudePrimaryClient = new OpenAI({
        apiKey: this.claudeConfig.primary.apiKey,
        baseURL: this.claudeConfig.primary.baseURL,
      });

      this.logger.info(
        "Claude primary client initialized for Excel processing",
        {
          baseURL: this.claudeConfig.primary.baseURL,
          model: this.claudeConfig.primary.model,
        }
      );

      console.log(
        `🤖 Claude primary model for Excel: ${this.claudeConfig.primary.model}`
      );

      // Initialize secondary Claude client if available
      if (
        aiConfig.hasSecondaryClaudeConfigured() &&
        this.claudeConfig.secondary?.apiKey
      ) {
        this.claudeSecondaryClient = new OpenAI({
          apiKey: this.claudeConfig.secondary.apiKey,
          baseURL: this.claudeConfig.secondary.baseURL,
        });

        this.logger.info(
          "Claude secondary client initialized for Excel processing",
          {
            baseURL: this.claudeConfig.secondary.baseURL,
            model: this.claudeConfig.secondary.model,
          }
        );

        console.log(
          `🤖 Claude secondary model for Excel: ${this.claudeConfig.secondary.model}`
        );
      }
    } else {
      this.logger.info(
        "Claude clients not initialized - configuration missing",
        {
          hasClaudeConfig: aiConfig.hasClaudeConfigured(),
          hasPrimaryApiKey: !!this.claudeConfig.primary.apiKey,
        }
      );
    }
  }

  async generateResponse(
    systemPrompt: string,
    userMessage: string
  ): Promise<string> {
    return this.generateResponseWithDocumentType(
      systemPrompt,
      userMessage,
      "general"
    );
  }

  async generateResponseForExcel(
    systemPrompt: string,
    userMessage: string
  ): Promise<string> {
    return this.generateResponseWithDocumentType(
      systemPrompt,
      userMessage,
      "excel"
    );
  }

  private async generateResponseWithDocumentType(
    systemPrompt: string,
    userMessage: string,
    documentType: "general" | "excel" = "general"
  ): Promise<string> {
    const isExcelDocument = documentType === "excel";
    const shouldUseClaude =
      isExcelDocument &&
      (this.claudePrimaryClient || this.claudeSecondaryClient);

    if (shouldUseClaude) {
      return this.generateClaudeResponse(systemPrompt, userMessage);
    }

    const result = await sentryMonitoringService.track(
      "load_balanced_llm_generation",
      "llm",
      {
        model: this.primaryConfig.model,
        system_prompt_length: systemPrompt.length,
        user_message_length: userMessage.length,
        system_prompt_preview: systemPrompt.substring(0, 200),
        user_message_preview: userMessage.substring(0, 200),
        load_balancing_enabled: true,
        has_secondary_client: !!this.secondaryClient,
        client_type: "primary_single",
        document_type: documentType,
      },
      async () => {
        try {
          this.logger.debug("Starting LLM response generation", {
            model: this.primaryConfig.model,
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length,
            loadBalancing: true,
          });

          console.log(`🤖 Generating response with primary LLM...`);

          // Clean prompts for security before sending to LLM
          const cleanedSystemPrompt =
            PromptInjectionProtectionService.sanitizeText(systemPrompt, {
              strictMode: true,
              azureContentPolicy: true,
              logSuspiciousContent: true,
            });

          const cleanedUserMessage =
            PromptInjectionProtectionService.sanitizeText(userMessage, {
              strictMode: true,
              azureContentPolicy: true,
              logSuspiciousContent: true,
            });

          this.logger.debug("Prompts cleaned for security", {
            originalSystemLength: systemPrompt.length,
            cleanedSystemLength: cleanedSystemPrompt.length,
            originalUserLength: userMessage.length,
            cleanedUserLength: cleanedUserMessage.length,
          });

          const textOutput = await runWithToolsIfRequested(
            this.primaryClient,
            this.primaryConfig.model,
            cleanedSystemPrompt,
            cleanedUserMessage,
            {
              toolChoice: getRecommendedToolChoice(),
              maxToolLoops: 6, // Increased from 3 for better tool usage
              isAzure: this.primaryConfig.service === "azure",
            }
          );

          this.logger.info("LLM response generated successfully", {
            model: this.primaryConfig.model,
            responseLength: textOutput.length,
          });

          console.log(
            `✅ Generated text response (${textOutput.length} characters)`
          );

          // Return just the text output when using tool calls
          return textOutput;
        } catch (error) {
          this.logger.error("LLM response generation failed", {
            model: this.primaryConfig.model,
            error: error instanceof Error ? error.message : String(error),
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length,
          });

          console.error("❌ Error generating response:", error);
          throw error;
        }
      },
      {
        provider: "load_balanced_llm",
        model: this.primaryConfig.model,
        load_balancing_enabled: true,
      }
    );

    // Return the text output
    return result as string;
  }

  public async generateClaudeResponse(
    systemPrompt: string,
    userMessage: string
  ): Promise<string> {
    const result = await sentryMonitoringService.track(
      "claude_llm_generation",
      "llm",
      {
        model: this.claudeConfig.primary.model,
        system_prompt_length: systemPrompt.length,
        user_message_length: userMessage.length,
        system_prompt_preview: systemPrompt.substring(0, 200),
        user_message_preview: userMessage.substring(0, 200),
        has_secondary_claude: !!this.claudeSecondaryClient,
        client_type: "claude_excel",
      },
      async () => {
        try {
          this.logger.debug("Starting Claude response generation for Excel", {
            model: this.claudeConfig.primary.model,
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length,
          });

          console.log(`🤖 Generating Excel response with Claude...`);

          const claudeClient =
            this.claudePrimaryClient || this.claudeSecondaryClient;
          if (!claudeClient) {
            throw new Error("No Claude client available for Excel processing");
          }

          const response = await claudeClient.chat.completions.create({
            model: this.claudeConfig.primary.model,

            messages: [
              {
                role: "system",
                content: systemPrompt,
              },
              {
                role: "user",
                content: userMessage,
              },
            ],
          });

          if (!response.choices[0]?.message?.content) {
            const errorMsg = "No response content from Claude service";
            this.logger.error(errorMsg, {
              model: this.claudeConfig.primary.model,
              response: response.choices,
            });
            throw new Error(errorMsg);
          }

          const content = response.choices[0].message.content;

          this.logger.info("Claude response generated successfully for Excel", {
            model: this.claudeConfig.primary.model,
            responseLength: content.length,
            tokensUsed: response.usage?.total_tokens,
          });

          console.log(
            `✅ Claude response generated for Excel (${content.length} chars)`
          );
          return content;
        } catch (error) {
          this.logger.error("Failed to generate Claude response for Excel", {
            error: error instanceof Error ? error.message : String(error),
            model: this.claudeConfig.primary.model,
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length,
          });

          // If primary Claude fails, try secondary if available
          if (this.claudeSecondaryClient && this.claudePrimaryClient && error) {
            console.log("🔄 Retrying with secondary Claude client...");
            try {
              const secondaryResponse =
                await this.claudeSecondaryClient.chat.completions.create({
                  model:
                    this.claudeConfig.secondary?.model ||
                    this.claudeConfig.primary.model,

                  messages: [
                    {
                      role: "system",
                      content: systemPrompt,
                    },
                    {
                      role: "user",
                      content: userMessage,
                    },
                  ],
                });

              if (secondaryResponse.choices[0]?.message?.content) {
                const content = secondaryResponse.choices[0].message.content;
                console.log(
                  `✅ Secondary Claude response generated for Excel (${content.length} chars)`
                );
                return content;
              }
            } catch (secondaryError) {
              this.logger.error("Secondary Claude also failed", {
                error:
                  secondaryError instanceof Error
                    ? secondaryError.message
                    : String(secondaryError),
              });
            }
          }

          console.error(
            `❌ Claude failed for Excel processing: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          throw error;
        }
      }
    );

    return typeof result === "object" && result && "result" in result
      ? (result as any).result
      : (result as string);
  }

  async generateStreamingResponseForExcel(
    systemPrompt: string,
    userMessage: string,
    timerContext?: TimerContext
  ): Promise<ReadableStream<string>> {
    console.log(`🌊 Generating streaming Excel response with Claude...`);

    const claudeClient = this.claudePrimaryClient || this.claudeSecondaryClient;
    if (!claudeClient) {
      throw new Error("No Claude client available for Excel streaming");
    }

    try {
      const stream = await claudeClient.chat.completions.create({
        model: this.claudeConfig.primary.model,

        stream: true,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        reasoning_effort: "low",
      });

      // Convert OpenAI stream to ReadableStream<string>
      return new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                controller.enqueue(content);
              }
            }
            controller.close();
          } catch (error) {
            console.error("❌ Claude streaming error for Excel:", error);
            controller.error(error);
          }
        },
      });
    } catch (error) {
      console.error("❌ Failed to start Claude streaming for Excel:", error);
      throw error;
    }
  }

  /**
   * Generate a streaming response from the LLM with load balancing
   */
  async generateStreamingResponse(
    systemPrompt: string,
    userMessage: string,
    timerContext?: TimerContext
  ): Promise<ReadableStream<string>> {
    return this.generateStreamingResponseWithDocumentType(
      systemPrompt,
      userMessage,
      "general",
      timerContext
    );
  }

  async generateStreamingResponseForExcelFiles(
    systemPrompt: string,
    userMessage: string,
    timerContext?: TimerContext
  ): Promise<ReadableStream<string>> {
    return this.generateStreamingResponseWithDocumentType(
      systemPrompt,
      userMessage,
      "excel",
      timerContext
    );
  }

  private async generateStreamingResponseWithDocumentType(
    systemPrompt: string,
    userMessage: string,
    documentType: "general" | "excel" = "general",
    timerContext?: TimerContext
  ): Promise<ReadableStream<string>> {
    console.log(`🌊 Generating streaming response with load-balanced LLM...`);

    // If no timer context provided or timer is disabled, create a dummy one
    if (!timerContext) {
      const dummyTimer = {
        id: "no-timer",
        isExpired: false,
        abortController: new AbortController(),
        startTime: Date.now(),
        timeoutMs: Infinity,
        cleanupCallbacks: [],
      };
      timerContext = dummyTimer;
    }

    // Use primary client for streaming (load balancing doesn't make sense for single streams)
    return streamingService.streamLLMResponse(
      this.primaryClient,
      this.primaryConfig.model,
      systemPrompt,
      userMessage,
      timerContext
    );
  }

  /**
   * Generate a parallel streaming response from both LLMs (primary and secondary)
   * Returns the response from whichever LLM responds first (if racing is enabled)
   * OR uses load-balanced distribution if racing is disabled
   */
  async generateParallelStreamingResponse(
    systemPrompt: string,
    userMessage: string,
    timerContext?: TimerContext
  ): Promise<ReadableStream<string>> {
    // Check if parallel streaming is possible
    if (!true || !this.secondaryClient || !this.secondaryConfig) {
      this.logger.info(
        "Parallel streaming not available, falling back to primary only",
        {
          loadBalancingEnabled: true,
          hasSecondaryClient: !!this.secondaryClient,
          hasSecondaryConfig: !!this.secondaryConfig,
        }
      );

      // Track fallback to single stream
      return await sentryMonitoringService.track(
        "parallel_streaming_fallback_to_single",
        "streaming",
        {
          reason: false
            ? "load_balancing_disabled"
            : !this.secondaryClient
            ? "no_secondary_client"
            : "no_secondary_config",
          primaryModel: this.primaryConfig.model,
          systemPromptLength: systemPrompt.length,
          userMessageLength: userMessage.length,
        },
        async () => {
          // Fall back to single stream with primary
          return this.generateStreamingResponse!(
            systemPrompt,
            userMessage,
            timerContext
          );
        }
      );
    }

    // Check if LLM racing is enabled
    const isRacingEnabled = this.isLLMRacingEnabled();

    if (isRacingEnabled) {
      // EXPENSIVE MODE: Race both LLMs with the same question
      return await sentryMonitoringService.track(
        "llm_racing_parallel_streaming",
        "streaming",
        {
          mode: "racing",
          primaryModel: this.primaryConfig.model,
          secondaryModel: this.secondaryConfig.model,
          systemPromptLength: systemPrompt.length,
          userMessageLength: userMessage.length,
          hasTimerContext: !!timerContext,
          timerEnabled: timerContext ? !timerContext.isExpired : false,
          loadBalancingEnabled: true,
        },
        async () => {
          this.logger.info("Starting LLM racing with both LLMs (EXPENSIVE)", {
            primaryModel: this.primaryConfig.model,
            secondaryModel: this.secondaryConfig.model,
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length,
          });

          console.log(
            `�� LLM RACING MODE: Both LLMs processing same question (Primary: ${this.primaryConfig.model}, Secondary: ${this.secondaryConfig.model}) - EXPENSIVE!`
          );

          // If no timer context provided or timer is disabled, create a dummy one
          if (!timerContext) {
            const dummyTimer = {
              id: "no-timer",
              isExpired: false,
              abortController: new AbortController(),
              startTime: Date.now(),
              timeoutMs: Infinity,
              cleanupCallbacks: [],
            };
            timerContext = dummyTimer;
          }

          // Use the parallel streaming service for racing
          return streamingService.streamParallelLLMResponse(
            this.primaryClient,
            this.primaryConfig.model,
            this.secondaryClient!, // We already checked for null above
            this.secondaryConfig.model,
            systemPrompt,
            userMessage,
            timerContext
          );
        }
      );
    } else {
      // COST-EFFECTIVE MODE: Just use primary LLM for single questions
      // Note: Load balancing for multiple questions is handled in generateBatchStreamingResponses
      return await sentryMonitoringService.track(
        "load_balanced_single_streaming",
        "streaming",
        {
          mode: "cost_effective_single",
          primaryModel: this.primaryConfig.model,
          systemPromptLength: systemPrompt.length,
          userMessageLength: userMessage.length,
          hasTimerContext: !!timerContext,
          timerEnabled: timerContext ? !timerContext.isExpired : false,
          racingDisabled: true,
        },
        async () => {
          this.logger.info(
            "Using cost-effective single LLM streaming (racing disabled)",
            {
              primaryModel: this.primaryConfig.model,
              systemPromptLength: systemPrompt.length,
              userMessageLength: userMessage.length,
            }
          );

          console.log(
            `🌊💡 COST-EFFECTIVE MODE: Using primary LLM only (${this.primaryConfig.model}) - racing disabled for single questions`
          );

          // Use primary LLM only
          return this.generateStreamingResponse!(
            systemPrompt,
            userMessage,
            timerContext
          );
        }
      );
    }
  }

  /**
   * Generate streaming responses for multiple questions with load balancing
   * First half goes to primary LLM, second half to secondary LLM - all processed in parallel
   * This method implements the cost-effective approach when racing is disabled
   */
  async generateBatchStreamingResponses(
    systemPrompts: string[],
    userMessages: string[],
    timerContext?: TimerContext
  ): Promise<ReadableStream<string>[]> {
    return this.generateBatchStreamingResponsesWithDocumentType(
      systemPrompts,
      userMessages,
      "general",
      timerContext
    );
  }

  async generateBatchStreamingResponsesForExcel(
    systemPrompts: string[],
    userMessages: string[],
    timerContext?: TimerContext
  ): Promise<ReadableStream<string>[]> {
    return this.generateBatchStreamingResponsesWithDocumentType(
      systemPrompts,
      userMessages,
      "excel",
      timerContext
    );
  }

  private async generateBatchStreamingResponsesWithDocumentType(
    systemPrompts: string[],
    userMessages: string[],
    documentType: "general" | "excel" = "general",
    timerContext?: TimerContext
  ): Promise<ReadableStream<string>[]> {
    if (systemPrompts.length !== userMessages.length) {
      const errorMsg =
        "System prompts and user messages arrays must have the same length";
      throw new Error(errorMsg);
    }

    if (systemPrompts.length === 0) {
      return [];
    }

    const qaConfig = Config.app.getQAConfig();
    const isRacingEnabled = qaConfig.enableLLMRacing;

    return await sentryMonitoringService.track(
      "load_balanced_batch_streaming_generation",
      "streaming",
      {
        batch_size: systemPrompts.length,
        load_balancing_enabled: true,
        llm_racing_enabled: isRacingEnabled,
        has_secondary_client: !!this.secondaryClient,
        mode: isRacingEnabled
          ? "expensive_racing"
          : "cost_effective_distribution",
        total_system_prompt_length: systemPrompts.reduce(
          (sum, prompt) => sum + prompt.length,
          0
        ),
        total_user_message_length: userMessages.reduce(
          (sum, msg) => sum + msg.length,
          0
        ),
        avg_system_prompt_length: Math.round(
          systemPrompts.reduce((sum, prompt) => sum + prompt.length, 0) /
            systemPrompts.length
        ),
        avg_user_message_length: Math.round(
          userMessages.reduce((sum, msg) => sum + msg.length, 0) /
            userMessages.length
        ),
      },
      async () => {
        const mode = isRacingEnabled
          ? "RACING (EXPENSIVE)"
          : "COST-EFFECTIVE DISTRIBUTION";
        console.log(
          `🌊 Processing ${
            systemPrompts.length
          } streaming LLM requests with ${mode} [Load Balancing: ${"ENABLED"}]...`
        );

        // If no timer context provided, create a dummy one
        if (!timerContext) {
          const dummyTimer = {
            id: "batch-streaming-no-timer",
            isExpired: false,
            abortController: new AbortController(),
            startTime: Date.now(),
            timeoutMs: Infinity,
            cleanupCallbacks: [],
          };
          timerContext = dummyTimer;
        }

        // Debug: Check load balancing status
        console.log(`🔍 DEBUG: Load Balancing Status:`, {
          isLoadBalancingEnabled: true,
          hasSecondaryClient: !!this.secondaryClient,
          isRacingEnabled,
          condition1: false,
          condition2: !this.secondaryClient,
          overallCondition: !!this.secondaryClient,
        });

        // If load balancing is disabled or no secondary client, use primary for all
        if (!!this.secondaryClient) {
          console.log(
            `🌊 Processing ${systemPrompts.length} streaming requests with primary model only`
          );

          // Create all streams using primary client
          const streams: ReadableStream<string>[] = [];
          for (let i = 0; i < systemPrompts.length; i++) {
            const systemPrompt = systemPrompts[i];
            const userMessage = userMessages[i];
            if (systemPrompt && userMessage) {
              const stream = streamingService.streamLLMResponse(
                this.primaryClient,
                this.primaryConfig.model,
                systemPrompt,
                userMessage,
                timerContext,
                i,
                userMessage
              );
              streams.push(await stream);
            }
          }
          return streams;
        }

        if (isRacingEnabled) {
          // EXPENSIVE RACING MODE: Each question goes to both LLMs, fastest wins
          console.log(
            `🏁💰 EXPENSIVE RACING MODE: Each of ${systemPrompts.length} questions will be processed by BOTH LLMs (${this.primaryConfig.model} AND ${this.secondaryConfig.model}) - 2x cost!`
          );

          const raceStreams: ReadableStream<string>[] = [];
          for (let i = 0; i < systemPrompts.length; i++) {
            const systemPrompt = systemPrompts[i];
            const userMessage = userMessages[i];
            if (systemPrompt && userMessage) {
              // Use parallel streaming for each question (racing)
              const raceStream = streamingService.streamParallelLLMResponse(
                this.primaryClient,
                this.primaryConfig.model,
                this.secondaryClient!,
                this.secondaryConfig.model,
                systemPrompt,
                userMessage,
                timerContext,
                i,
                userMessage
              );
              raceStreams.push(await raceStream);
            }
          }
          return raceStreams;
        } else {
          // COST-EFFECTIVE DISTRIBUTION MODE: Split questions between two models
          const midpoint = Math.ceil(systemPrompts.length / 2);
          const firstHalfSystemPrompts = systemPrompts.slice(0, midpoint);
          const firstHalfUserMessages = userMessages.slice(0, midpoint);
          const secondHalfSystemPrompts = systemPrompts.slice(midpoint);
          const secondHalfUserMessages = userMessages.slice(midpoint);

          console.log(
            `🔀💡 COST-EFFECTIVE DISTRIBUTION MODE: ${firstHalfSystemPrompts.length} questions to primary (${this.primaryConfig.model}), ${secondHalfSystemPrompts.length} questions to secondary (${this.secondaryConfig.model}) - NO racing, optimal cost!`
          );

          // Create streaming promises for both halves in parallel
          const firstHalfPromises = firstHalfSystemPrompts.map(
            async (systemPrompt, index) => {
              const userMessage = firstHalfUserMessages[index];
              if (!systemPrompt || !userMessage) {
                throw new Error(`Missing prompt or message at index ${index}`);
              }
              return await streamingService.streamLLMResponse(
                this.primaryClient,
                this.primaryConfig.model,
                systemPrompt,
                userMessage,
                timerContext!,
                index,
                userMessage
              );
            }
          );

          const secondHalfPromises = secondHalfSystemPrompts.map(
            async (systemPrompt, index) => {
              const userMessage = secondHalfUserMessages[index];
              if (!systemPrompt || !userMessage) {
                throw new Error(
                  `Missing prompt or message at index ${midpoint + index}`
                );
              }
              return await streamingService.streamLLMResponse(
                this.secondaryClient!,
                this.secondaryConfig.model,
                systemPrompt,
                userMessage,
                timerContext!,
                midpoint + index,
                userMessage
              );
            }
          );

          // Wait for all streams to be created (not their completion)
          const [firstHalfStreams, secondHalfStreams] = await Promise.all([
            Promise.all(firstHalfPromises),
            Promise.all(secondHalfPromises),
          ]);

          // Combine streams in original order
          const allStreams: ReadableStream<string>[] = [];

          // Add first half streams
          allStreams.push(...firstHalfStreams);

          // Add second half streams
          allStreams.push(...secondHalfStreams);

          console.log(
            `✅ Created ${allStreams.length} cost-effective distributed streaming responses`
          );

          return allStreams;
        }
      },
      {
        provider: "load_balanced_llm_service",
        primary_model: this.primaryConfig.model,
        secondary_model: this.secondaryConfig?.model,
        component: "ai",
        batch_processing: true,
        streaming: true,
        racing_enabled: isRacingEnabled,
        load_balancing: this.isLoadBalancingActive(),
      }
    );
  }

  /**
   * Generate responses for multiple questions with load balancing
   * Note: Racing is only available for streaming responses, non-streaming uses cost-effective distribution
   */
  async generateBatchResponses(
    systemPrompts: string[],
    userMessages: string[]
  ): Promise<string[]> {
    if (systemPrompts.length !== userMessages.length) {
      const errorMsg =
        "System prompts and user messages arrays must have the same length";
      throw new Error(errorMsg);
    }

    if (systemPrompts.length === 0) {
      return [];
    }

    const qaConfig = Config.app.getQAConfig();
    const isRacingEnabled = qaConfig.enableLLMRacing;

    return await sentryMonitoringService.track(
      "load_balanced_batch_llm_generation",
      "llm",
      {
        batch_size: systemPrompts.length,
        load_balancing_enabled: true,
        llm_racing_enabled: isRacingEnabled,
        has_secondary_client: !!this.secondaryClient,
        mode: isRacingEnabled
          ? "expensive_racing"
          : "cost_effective_distribution",
        total_system_prompt_length: systemPrompts.reduce(
          (sum, prompt) => sum + prompt.length,
          0
        ),
        total_user_message_length: userMessages.reduce(
          (sum, msg) => sum + msg.length,
          0
        ),
        avg_system_prompt_length: Math.round(
          systemPrompts.reduce((sum, prompt) => sum + prompt.length, 0) /
            systemPrompts.length
        ),
        avg_user_message_length: Math.round(
          userMessages.reduce((sum, msg) => sum + msg.length, 0) /
            userMessages.length
        ),
      },
      async () => {
        const mode = isRacingEnabled
          ? "STREAMING RACING (expensive), NON-STREAMING DISTRIBUTION (cost-effective)"
          : "COST-EFFECTIVE DISTRIBUTION";
        console.log(
          `🤖 Processing ${
            systemPrompts.length
          } non-streaming LLM requests with ${mode} [Load Balancing: ${"ENABLED"}]...`
        );

        console.log(
          `ℹ️ Note: Racing mode only applies to streaming responses. Non-streaming responses always use cost-effective distribution.`
        );

        // If load balancing is disabled or no secondary client, use primary for all
        if (!!this.secondaryClient) {
          console.log(
            `🤖 Processing ${systemPrompts.length} LLM requests with primary model only`
          );
          return await this.processBatchWithSingleClient(
            systemPrompts,
            userMessages,
            this.primaryClient,
            this.primaryConfig,
            "primary"
          );
        }

        // Always use cost-effective distribution for non-streaming responses
        // Racing is only available for streaming responses
        // COST-EFFECTIVE DISTRIBUTION MODE: Split questions between two models
        const midpoint = Math.ceil(systemPrompts.length / 2);
        const firstHalfSystemPrompts = systemPrompts.slice(0, midpoint);
        const firstHalfUserMessages = userMessages.slice(0, midpoint);
        const secondHalfSystemPrompts = systemPrompts.slice(midpoint);
        const secondHalfUserMessages = userMessages.slice(midpoint);

        console.log(
          `🔀💡 COST-EFFECTIVE DISTRIBUTION MODE: ${firstHalfSystemPrompts.length} questions to primary (${this.primaryConfig.model}), ${secondHalfSystemPrompts.length} questions to secondary (${this.secondaryConfig.model}) - NO racing, optimal cost!`
        );

        // Process both halves in parallel
        const [firstHalfResults, secondHalfResults] = await Promise.all([
          firstHalfSystemPrompts.length > 0
            ? this.processBatchWithSingleClient(
                firstHalfSystemPrompts,
                firstHalfUserMessages,
                this.primaryClient,
                this.primaryConfig,
                "primary"
              )
            : Promise.resolve([]),
          secondHalfSystemPrompts.length > 0
            ? this.processBatchWithSingleClient(
                secondHalfSystemPrompts,
                secondHalfUserMessages,
                this.secondaryClient!,
                this.secondaryConfig,
                "secondary"
              )
            : Promise.resolve([]),
        ]);

        // Combine results in original order
        const combinedResults = [...firstHalfResults, ...secondHalfResults];

        console.log(
          `✅ Completed cost-effective batch LLM generation: ${combinedResults.length}/${systemPrompts.length} responses generated`
        );

        return combinedResults;
      },
      {
        provider: "load_balanced_llm_service",
        primary_model: this.primaryConfig.model,
        secondary_model: this.secondaryConfig?.model,
        component: "ai",
        batch_processing: true,
        racing_enabled: isRacingEnabled,
        load_balancing: this.isLoadBalancingActive(),
      }
    );
  }

  /**
   * Process a batch of LLM requests with a single client
   */
  private async processBatchWithSingleClient(
    systemPrompts: string[],
    userMessages: string[],
    client: OpenAI,
    config: any,
    clientType: "primary" | "secondary"
  ): Promise<string[]> {
    return await sentryMonitoringService.track(
      `load_balanced_batch_llm_${clientType}`,
      "llm",
      {
        batch_size: systemPrompts.length,
        client_type: clientType,
        model: config.model,
        total_system_prompt_length: systemPrompts.reduce(
          (sum, prompt) => sum + prompt.length,
          0
        ),
        total_user_message_length: userMessages.reduce(
          (sum, msg) => sum + msg.length,
          0
        ),
      },
      async () => {
        console.log(
          `🚀 Starting ${clientType} LLM generation for ${systemPrompts.length} requests - ALL IN PARALLEL...`
        );

        // Process ALL requests in parallel with no concurrency limits (like embeddings)
        const llmPromises = systemPrompts.map(async (systemPrompt, index) => {
          const userMessage = userMessages[index]!;
          const requestId = `${clientType}-${index}`;

          return await sentryMonitoringService.track(
            `individual_llm_${clientType}`,
            "llm",
            {
              system_prompt_length: systemPrompt.length,
              user_message_length: userMessage.length,
              system_prompt_preview: systemPrompt.substring(0, 200),
              user_message_preview: userMessage.substring(0, 200),
              index,
              client_type: clientType,
              request_id: requestId,
              model: config.model,
            },
            async () => {
              console.log(
                `🤖 [${clientType}] Processing LLM request ${index + 1}/${
                  systemPrompts.length
                }`
              );

              // Clean prompts for security before sending to LLM
              const cleanedSystemPrompt =
                PromptInjectionProtectionService.sanitizeText(systemPrompt, {
                  strictMode: true,
                  azureContentPolicy: true,
                  logSuspiciousContent: false, // Reduce logging in batch mode
                });

              const cleanedUserMessage =
                PromptInjectionProtectionService.sanitizeText(userMessage, {
                  strictMode: true,
                  azureContentPolicy: true,
                  logSuspiciousContent: false,
                });

              const textOutput = await runWithToolsIfRequested(
                client,
                config.model,
                cleanedSystemPrompt,
                cleanedUserMessage,
                {
                  toolChoice: getRecommendedToolChoice(),
                  maxToolLoops: 6,
                }
              );

              return textOutput;
            },
            {
              provider: `load_balanced_llm_${clientType}`,
              model: config.model,
              individual_request: true,
            }
          );
        });

        // Wait for ALL requests to complete in parallel
        const results = await Promise.all(llmPromises);

        console.log(
          `✅ Generated ${results.length} LLM responses with ${clientType} client (${config.model})`
        );

        // All items are plain text outputs
        return results as string[];
      },
      {
        provider: `load_balanced_llm_${clientType}`,
        model: config.model,
        batch_processing: true,
      }
    );
  }

  /**
   * Get current load balancing status
   */
  public isLoadBalancingActive(): boolean {
    return true && !!this.secondaryClient;
  }

  /**
   * Check if LLM racing is enabled (expensive mode where same questions go to both LLMs)
   */
  public isLLMRacingEnabled(): boolean {
    const qaConfig = Config.app.getQAConfig();
    return this.isLoadBalancingActive() && qaConfig.enableLLMRacing;
  }

  /**
   * Check if parallel streaming is available (requires both primary and secondary clients)
   * Returns true only if racing is enabled - for cost-effective mode, we use distribution instead
   */
  public isParallelStreamingAvailable(): boolean {
    const qaConfig = Config.app.getQAConfig();
    return (
      true &&
      !!this.secondaryClient &&
      !!this.secondaryConfig &&
      qaConfig.enableLLMRacing // Only available when racing is enabled
    );
  }
}
