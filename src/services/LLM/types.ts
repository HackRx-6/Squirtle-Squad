import type { TimerContext } from "../timer";

export interface LLMProvider {
    generateResponse(
        systemPrompt: string,
        userMessage: string
    ): Promise<string>;

    generateStreamingResponse(
        systemPrompt: string,
        userMessage: string,
        timerContext?: any
    ): Promise<ReadableStream<string>>;

    generateParallelStreamingResponse(
        systemPrompt: string,
        userMessage: string,
        timerContext?: any
    ): Promise<ReadableStream<string>>;

    generateBatchResponses(
        systemPrompts: string[],
        userMessages: string[]
    ): Promise<string[]>;

    generateBatchStreamingResponses(
        systemPrompts: string[],
        userMessages: string[],
        timerContext?: any
    ): Promise<ReadableStream<string>[]>;
}

export interface StreamingResponse {
    content: string;
    isComplete: boolean;
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    finishReason?: string;
    error?: string;
}

export interface StreamingContext {
    id: string;
    buffer: string;
    controller: ReadableStreamDefaultController<string>;
    timerContext: TimerContext;
    isComplete: boolean;
    error?: string;
    metadata: {
        startTime: number;
        questionIndex?: number;
        question?: string;
    };
}
