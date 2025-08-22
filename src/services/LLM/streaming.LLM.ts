import { Config } from "../../config";
import { loggingService } from "../logging";
import { PromptInjectionProtectionService } from "../cleaning";
import type { TimerContext } from "../timer";
import { sentryMonitoringService } from "../monitoring";
import OpenAI from "openai";
import type { StreamingContext } from "./types";

export class StreamingService {
    private static instance: StreamingService;
    private activeStreams: Map<string, StreamingContext> = new Map();
    private logger: ReturnType<typeof loggingService.createComponentLogger>;

    private constructor() {
        this.logger = loggingService.createComponentLogger("StreamingService");
    }

    public static getInstance(): StreamingService {
        if (!StreamingService.instance) {
            StreamingService.instance = new StreamingService();
        }
        return StreamingService.instance;
    }

    /**
     * Create a streaming response from an LLM
     */
    public async streamLLMResponse(
        client: OpenAI,
        model: string,
        systemPrompt: string,
        userMessage: string,
        timerContext: TimerContext,
        questionIndex?: number,
        question?: string
    ): Promise<ReadableStream<string>> {
        return await sentryMonitoringService.track(
            "llm_streaming_response",
            "streaming",
            {
                model,
                systemPromptLength: systemPrompt.length,
                userMessageLength: userMessage.length,
                questionIndex,
            },
            async () => {
                const qaConfig = Config.app.getQAConfig();
                const streamId = `stream_${Date.now()}_${Math.random()
                    .toString(36)
                    .substr(2, 9)}`;

                return new ReadableStream({
                    start: (controller) => {
                        const streamContext: StreamingContext = {
                            id: streamId,
                            buffer: "",
                            controller,
                            timerContext,
                            isComplete: false,
                            metadata: {
                                startTime: Date.now(),
                                questionIndex,
                                question,
                            },
                        };

                        this.activeStreams.set(streamId, streamContext);

                        this.logger.info("Starting LLM streaming response", {
                            streamId,
                            model,
                            systemPromptLength: systemPrompt.length,
                            userMessageLength: userMessage.length,
                            questionIndex,
                            timerEnabled: qaConfig.globalTimer.enabled,
                        });

                        // Check if timer is already expired
                        if (timerContext.isExpired) {
                            this.completeStreamWithTimeout(
                                streamId,
                                controller
                            );
                            return;
                        }

                        // Listen for timer expiration
                        const originalAbort =
                            timerContext.abortController.abort.bind(
                                timerContext.abortController
                            );
                        timerContext.abortController.abort = () => {
                            this.logger.warn("Timer expired during streaming", {
                                streamId,
                            });
                            this.completeStreamWithTimeout(
                                streamId,
                                controller
                            );
                            originalAbort();
                        };

                        this.startLLMStreaming(
                            client,
                            model,
                            systemPrompt,
                            userMessage,
                            streamId,
                            controller
                        );
                    },

                    cancel: () => {
                        this.logger.info("Stream cancelled", { streamId });
                        this.cleanupStream(streamId);
                    },
                });
            },
            {
                timerEnabled: timerContext ? !timerContext.isExpired : false,
                question: question ? question.substring(0, 100) : undefined,
            }
        );
    }

    /**
     * Create parallel streaming responses from two LLMs and return the fastest one
     */
    public async streamParallelLLMResponse(
        primaryClient: OpenAI,
        primaryModel: string,
        secondaryClient: OpenAI,
        secondaryModel: string,
        systemPrompt: string,
        userMessage: string,
        timerContext: TimerContext,
        questionIndex?: number,
        question?: string
    ): Promise<ReadableStream<string>> {
        return await sentryMonitoringService.track(
            "parallel_llm_streaming_response",
            "streaming",
            {
                primaryModel,
                secondaryModel,
                systemPromptLength: systemPrompt.length,
                userMessageLength: userMessage.length,
                questionIndex,
            },
            async () => {
                const qaConfig = Config.app.getQAConfig();
                const streamId = `parallel_stream_${Date.now()}_${Math.random()
                    .toString(36)
                    .substr(2, 9)}`;

                // Track the initiation of parallel streaming race
                sentryMonitoringService.addBreadcrumb({
                    message: "🚀 Starting parallel LLM streaming race",
                    category: "parallel_streaming_start",
                    level: "info",
                    data: {
                        streamId,
                        primaryModel,
                        secondaryModel,
                        questionIndex,
                        globalTimeoutSeconds:
                            qaConfig.globalTimer.timeoutSeconds,
                        bufferSize: qaConfig.streaming.bufferSize,
                        question: question
                            ? question.substring(0, 100) + "..."
                            : undefined,
                        timestamp: new Date().toISOString(),
                    },
                });

                this.logger.info("Starting parallel LLM streaming", {
                    streamId,
                    primaryModel,
                    secondaryModel,
                    systemPromptLength: systemPrompt.length,
                    userMessageLength: userMessage.length,
                    questionIndex,
                    timerEnabled: qaConfig.globalTimer.enabled,
                });

                return new ReadableStream({
                    start: (controller) => {
                        const streamContext: StreamingContext = {
                            id: streamId,
                            buffer: "",
                            controller,
                            timerContext,
                            isComplete: false,
                            metadata: {
                                startTime: Date.now(),
                                questionIndex,
                                question,
                            },
                        };

                        this.activeStreams.set(streamId, streamContext);

                        // Check if timer is already expired
                        if (timerContext.isExpired) {
                            this.completeStreamWithTimeout(
                                streamId,
                                controller
                            );
                            return;
                        }

                        // Listen for timer expiration
                        const originalAbort =
                            timerContext.abortController.abort.bind(
                                timerContext.abortController
                            );
                        timerContext.abortController.abort = () => {
                            this.logger.warn(
                                "Timer expired during parallel streaming",
                                {
                                    streamId,
                                }
                            );
                            this.completeStreamWithTimeout(
                                streamId,
                                controller
                            );
                            originalAbort();
                        };

                        this.startParallelLLMStreaming(
                            primaryClient,
                            primaryModel,
                            secondaryClient,
                            secondaryModel,
                            systemPrompt,
                            userMessage,
                            streamId,
                            controller
                        );
                    },

                    cancel: () => {
                        this.logger.info("Parallel stream cancelled", {
                            streamId,
                        });
                        this.cleanupStream(streamId);
                    },
                });
            },
            {
                timerEnabled: timerContext ? !timerContext.isExpired : false,
                question: question ? question.substring(0, 100) : undefined,
                parallel: true,
            }
        );
    }

    /**
     * Start parallel LLM streaming with race condition logic and primary fallback on timeout
     */
    private async startParallelLLMStreaming(
        primaryClient: OpenAI,
        primaryModel: string,
        secondaryClient: OpenAI,
        secondaryModel: string,
        systemPrompt: string,
        userMessage: string,
        streamId: string,
        controller: ReadableStreamDefaultController<string>
    ): Promise<void> {
        await sentryMonitoringService.track(
            "parallel_llm_stream_execution",
            "streaming",
            {
                streamId,
                primaryModel,
                secondaryModel,
                systemPromptLength: systemPrompt.length,
                userMessageLength: userMessage.length,
            },
            async () => {
                const streamContext = this.activeStreams.get(streamId);
                if (!streamContext) return;

                let winnerSelected = false;
                let primaryFinished = false;
                let secondaryFinished = false;
                let winningClient: "primary" | "secondary" | null = null;
                let primaryBuffer = "";
                let secondaryBuffer = "";
                let raceStartTime = Date.now();
                let winnerResponseTime: number | null = null;

                const createStreamProcessor = async (
                    client: OpenAI,
                    model: string,
                    clientType: "primary" | "secondary"
                ) => {
                    try {
                        this.logger.info(`Starting ${clientType} stream`, {
                            streamId,
                            model,
                        });

                        // Track individual stream start
                        sentryMonitoringService.addBreadcrumb({
                            message: `Starting ${clientType} LLM stream`,
                            category: "parallel_streaming",
                            data: {
                                streamId,
                                model,
                                clientType,
                                timestamp: new Date().toISOString(),
                            },
                        });

                        // 🛡️ FINAL SANITIZATION: Protect against prompt injection right before sending to Azure
                        console.log(
                            `🔍 [Azure Content Filter Debug] Checking content before API call...`
                        );

                        // Check the user message for prompt injection
                        const userRisk =
                            PromptInjectionProtectionService.calculateRiskScore(
                                userMessage
                            );
                        const systemRisk =
                            PromptInjectionProtectionService.calculateRiskScore(
                                systemPrompt
                            );

                        console.log(
                            `🔍 [Azure Debug] User message risk: ${userRisk.score}/100 (${userRisk.risk})`
                        );
                        console.log(
                            `🔍 [Azure Debug] System prompt risk: ${systemRisk.score}/100 (${systemRisk.risk})`
                        );

                        if (userRisk.detectedPatterns.length > 0) {
                            console.warn(
                                `🚨 [Azure Debug] User message injection patterns:`,
                                userRisk.detectedPatterns
                            );
                        }
                        if (systemRisk.detectedPatterns.length > 0) {
                            console.warn(
                                `🚨 [Azure Debug] System prompt injection patterns:`,
                                systemRisk.detectedPatterns
                            );
                        }

                        // Apply final sanitization with Azure-specific settings
                        let finalUserMessage = userMessage;
                        let finalSystemPrompt = systemPrompt;

                        if (
                            userRisk.score > 30 ||
                            userRisk.risk === "high" ||
                            userRisk.risk === "critical"
                        ) {
                            console.warn(
                                `🛡️ [Azure Protection] Sanitizing user message due to risk score: ${userRisk.score}`
                            );
                            finalUserMessage =
                                PromptInjectionProtectionService.sanitizeText(
                                    userMessage,
                                    {
                                        strictMode: true,
                                        preserveFormatting: false,
                                        logSuspiciousContent: true,
                                        preserveUrls: true,
                                    }
                                );
                        }

                        if (systemRisk.score > 40) {
                            console.warn(
                                `🛡️ [Azure Protection] Sanitizing system prompt due to risk score: ${systemRisk.score}`
                            );
                            finalSystemPrompt =
                                PromptInjectionProtectionService.sanitizeText(
                                    systemPrompt,
                                    {
                                        strictMode: true,
                                        preserveFormatting: false,
                                        logSuspiciousContent: true,
                                        preserveUrls: true,
                                    }
                                );
                        }

                        console.log(
                            `📤 [Azure Debug] Final message lengths - System: ${finalSystemPrompt.length}, User: ${finalUserMessage.length}`
                        );

                        const stream = await client.chat.completions.create({
                            model,
                            messages: [
                                { role: "system", content: finalSystemPrompt },
                                { role: "user", content: finalUserMessage },
                            ],
                            stream: true,
                            max_tokens: 300,
                            temperature: 0.1,
                        });

                        for await (const chunk of stream) {
                            // Check if stream should stop
                            if (streamContext.isComplete) {
                                this.logger.info(
                                    `${clientType} stream stopping due to completion`,
                                    {
                                        streamId,
                                    }
                                );
                                break;
                            }

                            // Check for timeout - but continue collecting content for primary fallback
                            if (streamContext.timerContext.isExpired) {
                                this.logger.info(
                                    `${clientType} stream detected timeout but continuing for fallback`,
                                    {
                                        streamId,
                                    }
                                );
                                // Don't break here - continue collecting content for potential fallback
                            }

                            const content =
                                chunk.choices[0]?.delta?.content || "";

                            // Always collect content for potential fallback
                            if (content) {
                                if (clientType === "primary") {
                                    primaryBuffer += content;
                                } else {
                                    secondaryBuffer += content;
                                }
                            }

                            // Only select winner if timer hasn't expired yet
                            if (
                                content &&
                                !winnerSelected &&
                                !streamContext.timerContext.isExpired
                            ) {
                                // First stream to produce content wins (only if not timed out)
                                winnerSelected = true;
                                winningClient = clientType;
                                winnerResponseTime = Date.now() - raceStartTime;

                                this.logger.info(
                                    `${clientType} stream won the race`,
                                    {
                                        streamId,
                                        model,
                                        firstContentLength: content.length,
                                        responseTimeMs: winnerResponseTime,
                                    }
                                );

                                // Track the race winner in Sentry
                                sentryMonitoringService.addBreadcrumb({
                                    message: `🏆 ${clientType.toUpperCase()} LLM won the parallel race`,
                                    category: "parallel_streaming_race",
                                    level: "info",
                                    data: {
                                        streamId,
                                        winningModel: model,
                                        winningClient: clientType,
                                        responseTimeMs: winnerResponseTime,
                                        firstContentLength: content.length,
                                        primaryModel,
                                        secondaryModel,
                                        timestamp: new Date().toISOString(),
                                    },
                                });

                                console.log(
                                    `🏆 ${clientType.toUpperCase()} LLM (${model}) won the race in ${winnerResponseTime}ms - using its response`
                                );
                            }

                            // Process content from winning stream (only if not timed out)
                            if (
                                content &&
                                winningClient === clientType &&
                                !streamContext.timerContext.isExpired
                            ) {
                                streamContext.buffer += content;

                                // Check if we should flush the buffer
                                const qaConfig = Config.app.getQAConfig();
                                if (
                                    streamContext.buffer.length >=
                                    qaConfig.streaming.bufferSize
                                ) {
                                    this.flushBuffer(streamId, controller);
                                }
                            }

                            // Check for completion (only if not timed out)
                            if (
                                chunk.choices[0]?.finish_reason &&
                                winningClient === clientType &&
                                !streamContext.timerContext.isExpired
                            ) {
                                this.logger.info(
                                    `${clientType} stream completed normally`,
                                    {
                                        streamId,
                                        finishReason:
                                            chunk.choices[0].finish_reason,
                                        totalLength:
                                            streamContext.buffer.length,
                                    }
                                );

                                // Track successful completion
                                sentryMonitoringService.addBreadcrumb({
                                    message: `${clientType} stream completed successfully`,
                                    category: "parallel_streaming_completion",
                                    data: {
                                        streamId,
                                        model,
                                        clientType,
                                        finishReason:
                                            chunk.choices[0].finish_reason,
                                        totalLength:
                                            streamContext.buffer.length,
                                        totalTimeMs: Date.now() - raceStartTime,
                                    },
                                });

                                this.completeStreamNormally(
                                    streamId,
                                    controller
                                );
                                break;
                            }

                            // If we hit finish_reason but timed out, just mark as finished
                            if (chunk.choices[0]?.finish_reason) {
                                break;
                            }
                        }

                        // Mark this stream as finished
                        if (clientType === "primary") {
                            primaryFinished = true;
                        } else {
                            secondaryFinished = true;
                        }
                    } catch (error) {
                        this.logger.error(`Error in ${clientType} stream`, {
                            streamId,
                            model,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });

                        // Track stream error
                        sentryMonitoringService.addBreadcrumb({
                            message: `Error in ${clientType} stream`,
                            category: "parallel_streaming_error",
                            level: "error",
                            data: {
                                streamId,
                                model,
                                clientType,
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                                elapsedMs: Date.now() - raceStartTime,
                            },
                        });

                        // Mark this stream as finished
                        if (clientType === "primary") {
                            primaryFinished = true;
                        } else {
                            secondaryFinished = true;
                        }

                        // If this was the only stream or both failed, handle error
                        if (
                            (primaryFinished && secondaryFinished) ||
                            (clientType === "primary" &&
                                !this.activeStreams.get(streamId))
                        ) {
                            throw error;
                        }
                    }
                };

                try {
                    // Start both streams in parallel
                    const promises = [
                        createStreamProcessor(
                            primaryClient,
                            primaryModel,
                            "primary"
                        ),
                        createStreamProcessor(
                            secondaryClient,
                            secondaryModel,
                            "secondary"
                        ),
                    ];

                    // Wait for any to complete or both to finish
                    await Promise.allSettled(promises);

                    // Handle post-processing logic
                    if (!streamContext.isComplete) {
                        if (streamContext.timerContext.isExpired) {
                            // TIMEOUT SCENARIO: Use primary LLM response as fallback
                            const timeoutDuration = Date.now() - raceStartTime;

                            this.logger.warn(
                                "Timer expired during parallel streaming - using primary fallback",
                                {
                                    streamId,
                                    primaryBufferLength: primaryBuffer.length,
                                    secondaryBufferLength:
                                        secondaryBuffer.length,
                                    winnerSelected,
                                    winningClient,
                                    timeoutDurationMs: timeoutDuration,
                                }
                            );

                            // Track timeout fallback decision in Sentry
                            sentryMonitoringService.addBreadcrumb({
                                message:
                                    "⏰ Global timeout reached - falling back to primary LLM",
                                category: "parallel_streaming_timeout_fallback",
                                level: "warning",
                                data: {
                                    streamId,
                                    primaryModel,
                                    secondaryModel,
                                    primaryBufferLength: primaryBuffer.length,
                                    secondaryBufferLength:
                                        secondaryBuffer.length,
                                    winnerSelected,
                                    winningClient,
                                    timeoutDurationMs: timeoutDuration,
                                    fallbackStrategy: "primary_buffer",
                                    timestamp: new Date().toISOString(),
                                },
                            });

                            console.log(
                                `⏰ Timeout reached after ${timeoutDuration}ms! Using PRIMARY LLM (${primaryModel}) response as fallback`
                            );

                            if (primaryBuffer.length > 0) {
                                // Use primary buffer content
                                streamContext.buffer = primaryBuffer;
                                this.flushBuffer(streamId, controller);
                                this.completeStreamNormally(
                                    streamId,
                                    controller
                                );

                                // Track successful primary buffer fallback
                                sentryMonitoringService.addBreadcrumb({
                                    message:
                                        "✅ Successfully used primary buffer as timeout fallback",
                                    category:
                                        "parallel_streaming_fallback_success",
                                    data: {
                                        streamId,
                                        primaryModel,
                                        fallbackContentLength:
                                            primaryBuffer.length,
                                        fallbackStrategy: "primary_buffer",
                                    },
                                });
                            } else {
                                // No content from primary either - try non-streaming fallback
                                this.logger.warn(
                                    "No content from primary during timeout - attempting non-streaming fallback",
                                    {
                                        streamId,
                                    }
                                );

                                // Track non-streaming fallback attempt
                                sentryMonitoringService.addBreadcrumb({
                                    message:
                                        "🔄 Attempting non-streaming primary fallback",
                                    category:
                                        "parallel_streaming_nonstreaming_fallback",
                                    level: "warning",
                                    data: {
                                        streamId,
                                        primaryModel,
                                        reason: "no_primary_buffer_content",
                                        fallbackStrategy:
                                            "non_streaming_primary",
                                    },
                                });

                                try {
                                    // 🛡️ Apply same sanitization for fallback call
                                    const userRisk =
                                        PromptInjectionProtectionService.calculateRiskScore(
                                            userMessage
                                        );
                                    const systemRisk =
                                        PromptInjectionProtectionService.calculateRiskScore(
                                            systemPrompt
                                        );

                                    let finalUserMessage = userMessage;
                                    let finalSystemPrompt = systemPrompt;

                                    if (
                                        userRisk.score > 30 ||
                                        userRisk.risk === "high" ||
                                        userRisk.risk === "critical"
                                    ) {
                                        finalUserMessage =
                                            PromptInjectionProtectionService.sanitizeText(
                                                userMessage,
                                                {
                                                    strictMode: true,
                                                    preserveFormatting: false,
                                                    logSuspiciousContent: true,
                                                    preserveUrls: true,
                                                }
                                            );
                                    }

                                    if (systemRisk.score > 40) {
                                        finalSystemPrompt =
                                            PromptInjectionProtectionService.sanitizeText(
                                                systemPrompt,
                                                {
                                                    strictMode: true,
                                                    preserveFormatting: false,
                                                    logSuspiciousContent: true,
                                                    preserveUrls: true,
                                                }
                                            );
                                    }

                                    const fallbackResponse =
                                        await primaryClient.chat.completions.create(
                                            {
                                                model: primaryModel,
                                                messages: [
                                                    {
                                                        role: "system",
                                                        content:
                                                            finalSystemPrompt,
                                                    },
                                                    {
                                                        role: "user",
                                                        content:
                                                            finalUserMessage,
                                                    },
                                                ],
                                                max_tokens: 300,
                                                temperature: 0.1,
                                            }
                                        );

                                    const fallbackContent =
                                        fallbackResponse.choices[0]?.message
                                            ?.content ||
                                        "I apologize, but I wasn't able to complete the response within the time limit.";

                                    streamContext.buffer = fallbackContent;
                                    this.flushBuffer(streamId, controller);
                                    this.completeStreamNormally(
                                        streamId,
                                        controller
                                    );

                                    // Track successful non-streaming fallback
                                    sentryMonitoringService.addBreadcrumb({
                                        message:
                                            "✅ Non-streaming primary fallback successful",
                                        category:
                                            "parallel_streaming_fallback_success",
                                        data: {
                                            streamId,
                                            primaryModel,
                                            fallbackContentLength:
                                                fallbackContent.length,
                                            fallbackStrategy:
                                                "non_streaming_primary",
                                            usage: fallbackResponse.usage,
                                        },
                                    });

                                    console.log(
                                        `🔄 Used non-streaming PRIMARY LLM fallback due to timeout`
                                    );
                                } catch (fallbackError) {
                                    this.logger.error(
                                        "Non-streaming fallback also failed",
                                        {
                                            streamId,
                                            error:
                                                fallbackError instanceof Error
                                                    ? fallbackError.message
                                                    : String(fallbackError),
                                        }
                                    );

                                    // Track fallback failure
                                    sentryMonitoringService.addBreadcrumb({
                                        message:
                                            "❌ Non-streaming primary fallback failed",
                                        category:
                                            "parallel_streaming_fallback_failure",
                                        level: "error",
                                        data: {
                                            streamId,
                                            primaryModel,
                                            error:
                                                fallbackError instanceof Error
                                                    ? fallbackError.message
                                                    : String(fallbackError),
                                            fallbackStrategy:
                                                "non_streaming_primary",
                                        },
                                    });

                                    this.completeStreamWithTimeout(
                                        streamId,
                                        controller
                                    );
                                }
                            }
                        } else if (!winnerSelected) {
                            // Normal case but no winner - both failed
                            this.logger.warn(
                                "No winner selected in parallel streaming",
                                {
                                    streamId,
                                    primaryFinished,
                                    secondaryFinished,
                                }
                            );

                            // Track race failure
                            sentryMonitoringService.addBreadcrumb({
                                message:
                                    "❌ No winner in parallel streaming race",
                                category: "parallel_streaming_race_failure",
                                level: "error",
                                data: {
                                    streamId,
                                    primaryModel,
                                    secondaryModel,
                                    primaryFinished,
                                    secondaryFinished,
                                    primaryBufferLength: primaryBuffer.length,
                                    secondaryBufferLength:
                                        secondaryBuffer.length,
                                    raceDurationMs: Date.now() - raceStartTime,
                                },
                            });

                            this.completeStreamWithError(
                                streamId,
                                controller,
                                new Error(
                                    "Both parallel streams failed to produce content"
                                )
                            );
                        }
                        // If winnerSelected and no timeout, the stream should have completed normally already
                    }

                    // Track final race results
                    const finalRaceResults = {
                        streamId,
                        primaryModel,
                        secondaryModel,
                        winnerSelected,
                        winningClient,
                        winnerResponseTime,
                        primaryBufferLength: primaryBuffer.length,
                        secondaryBufferLength: secondaryBuffer.length,
                        totalRaceDurationMs: Date.now() - raceStartTime,
                        timedOut: streamContext.timerContext.isExpired,
                        completed: streamContext.isComplete,
                    };

                    sentryMonitoringService.addBreadcrumb({
                        message: "🏁 Parallel streaming race completed",
                        category: "parallel_streaming_race_summary",
                        data: finalRaceResults,
                    });

                    this.logger.info(
                        "Parallel streaming race completed",
                        finalRaceResults
                    );
                } catch (error) {
                    this.logger.error(
                        "Error in parallel streaming coordination",
                        {
                            streamId,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        }
                    );

                    // Track coordination error
                    sentryMonitoringService.addBreadcrumb({
                        message: "❌ Error in parallel streaming coordination",
                        category: "parallel_streaming_coordination_error",
                        level: "error",
                        data: {
                            streamId,
                            primaryModel,
                            secondaryModel,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            raceDurationMs: Date.now() - raceStartTime,
                        },
                    });

                    this.completeStreamWithError(streamId, controller, error);
                }
            }
        );
    }

    /**
     * Start the actual LLM streaming
     */
    private async startLLMStreaming(
        client: OpenAI,
        model: string,
        systemPrompt: string,
        userMessage: string,
        streamId: string,
        controller: ReadableStreamDefaultController<string>
    ): Promise<void> {
        await sentryMonitoringService.track(
            "llm_stream_execution",
            "streaming",
            {
                streamId,
                model,
                systemPromptLength: systemPrompt.length,
                userMessageLength: userMessage.length,
            },
            async () => {
                try {
                    // 🛡️ Apply sanitization for this streaming call too
                    const userRisk =
                        PromptInjectionProtectionService.calculateRiskScore(
                            userMessage
                        );
                    const systemRisk =
                        PromptInjectionProtectionService.calculateRiskScore(
                            systemPrompt
                        );

                    let finalUserMessage = userMessage;
                    let finalSystemPrompt = systemPrompt;

                    if (
                        userRisk.score > 30 ||
                        userRisk.risk === "high" ||
                        userRisk.risk === "critical"
                    ) {
                        finalUserMessage =
                            PromptInjectionProtectionService.sanitizeText(
                                userMessage,
                                {
                                    strictMode: true,
                                    preserveFormatting: false,
                                    logSuspiciousContent: true,
                                    preserveUrls: true,
                                }
                            );
                    }

                    if (systemRisk.score > 40) {
                        finalSystemPrompt =
                            PromptInjectionProtectionService.sanitizeText(
                                systemPrompt,
                                {
                                    strictMode: true,
                                    preserveFormatting: false,
                                    logSuspiciousContent: true,
                                    preserveUrls: true,
                                }
                            );
                    }

                    const stream = await client.chat.completions.create({
                        model,
                        messages: [
                            { role: "system", content: finalSystemPrompt },
                            { role: "user", content: finalUserMessage },
                        ],
                        stream: true,
                        max_tokens: 300,
                        temperature: 0.1,
                    });

                    for await (const chunk of stream) {
                        const streamContext = this.activeStreams.get(streamId);
                        if (
                            !streamContext ||
                            streamContext.timerContext.isExpired
                        ) {
                            this.logger.warn(
                                "Stream stopped due to timer expiration",
                                {
                                    streamId,
                                }
                            );
                            break;
                        }

                        const content = chunk.choices[0]?.delta?.content || "";
                        if (content) {
                            streamContext.buffer += content;

                            // Check if we should flush the buffer
                            const qaConfig = Config.app.getQAConfig();
                            if (
                                streamContext.buffer.length >=
                                qaConfig.streaming.bufferSize
                            ) {
                                this.flushBuffer(streamId, controller);
                            }
                        }

                        // Check for completion
                        if (chunk.choices[0]?.finish_reason) {
                            this.logger.info(
                                "LLM streaming completed normally",
                                {
                                    streamId,
                                    finishReason:
                                        chunk.choices[0].finish_reason,
                                    totalLength: streamContext.buffer.length,
                                }
                            );
                            this.completeStreamNormally(streamId, controller);
                            break;
                        }
                    }
                } catch (error) {
                    this.logger.error("Error during LLM streaming", {
                        streamId,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });

                    this.completeStreamWithError(streamId, controller, error);
                    throw error; // Re-throw to be captured by Sentry
                }
            }
        );
    }

    /**
     * Flush the buffer to the stream
     */
    private flushBuffer(
        streamId: string,
        controller: ReadableStreamDefaultController<string>
    ): void {
        const streamContext = this.activeStreams.get(streamId);
        if (!streamContext || streamContext.buffer.length === 0) return;

        try {
            controller.enqueue(streamContext.buffer);
            streamContext.buffer = "";
        } catch (error) {
            this.logger.error("Error flushing buffer", {
                streamId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Complete stream normally (LLM finished)
     */
    private completeStreamNormally(
        streamId: string,
        controller: ReadableStreamDefaultController<string>
    ): void {
        const streamContext = this.activeStreams.get(streamId);
        if (!streamContext) return;

        // Flush any remaining buffer
        if (streamContext.buffer.length > 0) {
            this.flushBuffer(streamId, controller);
        }

        const duration = Date.now() - streamContext.metadata.startTime;

        streamContext.isComplete = true;
        controller.close();
        this.cleanupStream(streamId);

        this.logger.info("Stream completed normally", {
            streamId,
            duration,
        });
    }

    /**
     * Complete stream due to timeout
     */
    private completeStreamWithTimeout(
        streamId: string,
        controller: ReadableStreamDefaultController<string>
    ): void {
        const streamContext = this.activeStreams.get(streamId);
        if (!streamContext) return;

        // Capture timeout event in Sentry
        sentryMonitoringService.captureMessageWithContext(
            "Stream completed due to timeout",
            {
                level: "warning",
                tags: {
                    component: "streaming",
                    operation: "stream_timeout",
                    streamId,
                },
                contexts: {
                    streaming: {
                        streamId,
                        duration: Date.now() - streamContext.metadata.startTime,
                        bufferLength: streamContext.buffer.length,
                        questionIndex: streamContext.metadata.questionIndex,
                        isComplete: streamContext.isComplete,
                    },
                },
            }
        );

        // Flush any remaining buffer
        if (streamContext.buffer.length > 0) {
            this.flushBuffer(streamId, controller);
        }

        // Add timeout message if we have some content, otherwise provide fallback
        const fallbackMessage =
            streamContext.buffer.length > 0
                ? "" // Don't add fallback if we have partial content
                : "";

        if (fallbackMessage) {
            try {
                controller.enqueue(fallbackMessage);
            } catch (error) {
                this.logger.error("Error enqueueing fallback message", {
                    streamId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }
        }

        streamContext.isComplete = true;
        streamContext.error = "timeout";
        controller.close();
        this.cleanupStream(streamId);

        this.logger.warn("Stream completed due to timeout", {
            streamId,
            duration: Date.now() - streamContext.metadata.startTime,
            partialContentLength: streamContext.buffer.length,
        });
    }

    /**
     * Complete stream due to error
     */
    private completeStreamWithError(
        streamId: string,
        controller: ReadableStreamDefaultController<string>,
        error: unknown
    ): void {
        const streamContext = this.activeStreams.get(streamId);
        if (!streamContext) return;

        // Capture error in Sentry
        sentryMonitoringService.captureException(error, {
            tags: {
                component: "streaming",
                operation: "stream_error",
                streamId,
            },
            contexts: {
                streaming: {
                    streamId,
                    duration: Date.now() - streamContext.metadata.startTime,
                    bufferLength: streamContext.buffer.length,
                    questionIndex: streamContext.metadata.questionIndex,
                    isComplete: streamContext.isComplete,
                },
            },
        });

        // Flush any remaining buffer
        if (streamContext.buffer.length > 0) {
            this.flushBuffer(streamId, controller);
        }

        // Add error message if we don't have content
        if (streamContext.buffer.length === 0) {
            const errorMessage =
                "I apologize, but I encountered an error while generating the response. Please try again or contact support if this issue persists.";
            try {
                controller.enqueue(errorMessage);
            } catch (enqueueError) {
                this.logger.error("Error enqueueing error message", {
                    streamId,
                    error:
                        enqueueError instanceof Error
                            ? enqueueError.message
                            : String(enqueueError),
                });
            }
        }

        streamContext.isComplete = true;
        streamContext.error =
            error instanceof Error ? error.message : String(error);
        controller.close();
        this.cleanupStream(streamId);
    }

    /**
     * Cleanup stream context
     */
    private cleanupStream(streamId: string): void {
        this.activeStreams.delete(streamId);
    }

    /**
     * Convert a stream to text (for collecting responses)
     */
    public async streamToText(stream: ReadableStream<string>): Promise<string> {
        return await sentryMonitoringService.track(
            "stream_to_text_conversion",
            "streaming",
            {
                hasStream: !!stream,
            },
            async () => {
                const reader = stream.getReader();
                let result = "";

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        result += value;
                    }
                } finally {
                    reader.releaseLock();
                }

                return result;
            },
            {
                resultLength: undefined, // Will be set after completion
            }
        );
    }

    /**
     * Get statistics about active streams
     */
    public getStats(): {
        activeStreams: number;
        streams: Array<{
            id: string;
            elapsedMs: number;
            isComplete: boolean;
            bufferLength: number;
            questionIndex?: number;
        }>;
    } {
        const now = Date.now();
        const streams = Array.from(this.activeStreams.values()).map(
            (context) => ({
                id: context.id,
                elapsedMs: now - context.metadata.startTime,
                isComplete: context.isComplete,
                bufferLength: context.buffer.length,
                questionIndex: context.metadata.questionIndex,
            })
        );

        return {
            activeStreams: this.activeStreams.size,
            streams,
        };
    }

    /**
     * Cleanup all streams (for shutdown)
     */
    public cleanup(): void {
        this.logger.info("Cleaning up all active streams", {
            activeCount: this.activeStreams.size,
        });

        for (const [streamId, context] of this.activeStreams) {
            try {
                context.controller.close();
            } catch (error) {
                // Stream might already be closed
            }
        }

        this.activeStreams.clear();
    }
}

export const streamingService = StreamingService.getInstance();
