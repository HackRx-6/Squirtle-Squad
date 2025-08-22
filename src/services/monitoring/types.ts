export interface LLMUsageMetrics {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cost?: number;
    model?: string;
    provider?: string;
}

export interface MonitoringContext {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
}