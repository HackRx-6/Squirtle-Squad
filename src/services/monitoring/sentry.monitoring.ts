import * as Sentry from "@sentry/bun";
import { randomUUID } from "crypto";
import type { LLMUsageMetrics, MonitoringContext } from "./types";

export class SentryMonitoringService {
    private enabled: boolean;
    private activeSpans: Map<string, any> = new Map();

    constructor() {
        this.enabled = this.initializeSentry();

        console.log(
            `🔍 Sentry Performance Monitoring: ${
                this.enabled ? "ENABLED" : "DISABLED"
            }${
                this.enabled
                    ? ` (Environment: ${
                          process.env.SENTRY_ENVIRONMENT || "development"
                      })`
                    : ""
            }`
        );
    }

    private initializeSentry(): boolean {
        if (!process.env.SENTRY_DSN || process.env.NODE_ENV === "test") {
            return false;
        }

        try {
            Sentry.init({
                dsn: process.env.SENTRY_DSN,
                environment:
                    process.env.SENTRY_ENVIRONMENT ||
                    process.env.NODE_ENV ||
                    "development",
                tracesSampleRate: parseFloat(
                    process.env.SENTRY_TRACES_SAMPLE_RATE || "1.0"
                ),
                release:
                    process.env.SENTRY_RELEASE ||
                    `fantastic-robo@${
                        process.env.npm_package_version || "unknown"
                    }`,
                beforeSend(event) {
                    // Filter out sensitive data
                    if (event.request?.data) {
                        event.request.data = "[Filtered]";
                    }
                    return event;
                },
                beforeSendTransaction(event) {
                    // Add custom tags for LLM operations
                    if (
                        event.contexts?.trace?.op?.includes("llm") ||
                        event.contexts?.trace?.op?.includes("embedding")
                    ) {
                        event.tags = {
                            ...event.tags,
                            component: "ai",
                            category: "llm_operation",
                        };
                    }
                    return event;
                },
            });

            // Test Sentry connection
            Sentry.captureMessage(
                "Sentry monitoring initialized successfully",
                "info"
            );

            return true;
        } catch (error) {
            console.warn("⚠️ Failed to initialize Sentry:", error);
            return false;
        }
    }

    /**
     * Start a new span for operations using modern Sentry API
     */
    startSpan(
        name: string,
        op: string,
        data?: Record<string, any>
    ): MonitoringContext | null {
        if (!this.enabled) return null;

        const spanId = randomUUID();

        // Use Sentry.startSpan for modern API
        const span = Sentry.startSpan(
            {
                name,
                op,
                attributes: {
                    component: this.getComponentFromOp(op),
                    operation_type: op,
                    ...this.sanitizeData(data || {}),
                },
            },
            () => {
                // Return a placeholder that will be replaced by the actual span
                return null;
            }
        );

        if (span) {
            this.activeSpans.set(spanId, span);
        }

        return {
            traceId: spanId,
            spanId,
        };
    }

    /**
     * Track a function execution with automatic timing and error handling
     */
    async track<T>(
        name: string,
        op:
            | "llm"
            | "embedding"
            | "pdf_processing"
            | "vector_search"
            | "chunking"
            | "extraction"
            | "qa_pipeline"
            | "streaming",
        inputs: Record<string, any>,
        fn: () => Promise<T>,
        metadata: Record<string, any> = {},
        parentContext?: MonitoringContext
    ): Promise<T> {
        if (!this.enabled) {
            return await fn();
        }

        const startTime = Date.now();

        return await Sentry.startSpan(
            {
                name,
                op,
                attributes: {
                    ...this.sanitizeData(inputs),
                    ...this.sanitizeData(metadata),
                    component: this.getComponentFromOp(op),
                },
            },
            async (span) => {
                try {
                    const result = await fn();
                    const duration = Date.now() - startTime;

                    // Add performance metrics
                    span.setAttribute("duration_ms", duration);

                    // Track LLM-specific metrics if available
                    if (
                        typeof result === "object" &&
                        result &&
                        "usage" in result
                    ) {
                        this.trackLLMUsageWithSpan(
                            span,
                            result.usage as any,
                            op
                        );
                    }

                    // Set successful status
                    span.setStatus({ code: 1 }); // OK status

                    return result;
                } catch (error) {
                    const duration = Date.now() - startTime;

                    // Capture error
                    Sentry.captureException(error, {
                        contexts: {
                            operation: {
                                name,
                                op,
                                duration_ms: duration,
                                inputs: this.sanitizeData(inputs),
                            },
                        },
                    });

                    span.setStatus({
                        code: 2, // ERROR status
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                    span.setAttribute("duration_ms", duration);
                    span.setAttribute("error", true);

                    throw error;
                }
            }
        );
    }

    /**
     * Track LLM usage metrics and costs with span
     */
    private trackLLMUsageWithSpan(
        span: any,
        usage: LLMUsageMetrics,
        operation: string
    ): void {
        if (!this.enabled || !span) return;

        // Add usage metrics as attributes
        if (usage.promptTokens) {
            span.setAttribute("llm.tokens.prompt", usage.promptTokens);
        }
        if (usage.completionTokens) {
            span.setAttribute("llm.tokens.completion", usage.completionTokens);
        }
        if (usage.totalTokens) {
            span.setAttribute("llm.tokens.total", usage.totalTokens);
        }
        if (usage.cost) {
            span.setAttribute("llm.cost", usage.cost);
        }

        // Add tags for better filtering
        span.setAttribute("llm.model", usage.model || "unknown");
        span.setAttribute("llm.provider", usage.provider || "unknown");
        span.setAttribute("llm.operation", operation);

        // Send custom events to Sentry
        Sentry.addBreadcrumb({
            category: "llm",
            message: `LLM request completed`,
            level: "info",
            data: {
                model: usage.model,
                provider: usage.provider,
                operation,
                totalTokens: usage.totalTokens,
                cost: usage.cost,
            },
        });
    }

    /**
     * Track LLM usage metrics and costs (public method)
     */
    trackLLMUsage(
        context: MonitoringContext | null,
        usage: LLMUsageMetrics,
        operation: string
    ): void {
        if (!this.enabled || !context) return;

        // Use Sentry breadcrumbs for LLM metrics tracking
        Sentry.addBreadcrumb({
            category: "llm",
            message: `LLM usage tracked`,
            level: "info",
            data: {
                model: usage.model,
                provider: usage.provider,
                operation,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
                cost: usage.cost,
            },
        });

        // Also set user context for LLM operations
        Sentry.setContext("llm_operation", {
            model: usage.model,
            provider: usage.provider,
            operation,
            tokens: usage.totalTokens,
            cost: usage.cost,
        });
    }

    /**
     * Capture an error with context
     */
    captureError(error: Error, context?: Record<string, any>): void {
        if (!this.enabled) return;

        Sentry.captureException(error, {
            contexts: {
                custom: this.sanitizeData(context || {}),
            },
        });
    }

    /**
     * Capture an exception with detailed context
     */
    captureException(
        error: unknown,
        options: {
            tags?: Record<string, string>;
            contexts?: Record<string, Record<string, any>>;
        } = {}
    ): void {
        if (!this.enabled) return;

        Sentry.captureException(error, {
            tags: options.tags,
            contexts: options.contexts
                ? {
                      ...options.contexts,
                      // Sanitize all context data
                      ...Object.fromEntries(
                          Object.entries(options.contexts).map(
                              ([key, value]) => [key, this.sanitizeData(value)]
                          )
                      ),
                  }
                : undefined,
        });
    }

    /**
     * Capture a custom message
     */
    captureMessage(
        message: string,
        level: "info" | "warning" | "error" = "info"
    ): void {
        if (!this.enabled) return;

        Sentry.captureMessage(message, level);
    }

    /**
     * Capture a message with detailed context
     */
    captureMessageWithContext(
        message: string,
        options: {
            level?: "debug" | "info" | "warning" | "error" | "fatal";
            tags?: Record<string, string>;
            contexts?: Record<string, Record<string, any>>;
        } = {}
    ): void {
        if (!this.enabled) return;

        Sentry.captureMessage(message, {
            level: options.level || "info",
            tags: options.tags,
            contexts: options.contexts
                ? {
                      ...options.contexts,
                      // Sanitize all context data
                      ...Object.fromEntries(
                          Object.entries(options.contexts).map(
                              ([key, value]) => [key, this.sanitizeData(value)]
                          )
                      ),
                  }
                : undefined,
        });
    }

    /**
     * Add a breadcrumb for tracking operations
     */
    addBreadcrumb(data: {
        message: string;
        category?: string;
        level?: "debug" | "info" | "warning" | "error" | "fatal";
        data?: Record<string, any>;
    }): void {
        if (!this.enabled) return;

        Sentry.addBreadcrumb({
            message: data.message,
            category: data.category || "custom",
            level: data.level || "info",
            data: this.sanitizeData(data.data || {}),
        });
    }

    /**
     * Get monitoring statistics
     */
    getStats(): {
        activeSpans: number;
        enabled: boolean;
        sentryDsn: boolean;
        environment: string;
    } {
        return {
            activeSpans: this.activeSpans.size,
            enabled: this.enabled,
            sentryDsn: !!process.env.SENTRY_DSN,
            environment:
                process.env.SENTRY_ENVIRONMENT ||
                process.env.NODE_ENV ||
                "development",
        };
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        if (!this.enabled) return;

        // Clear active spans
        this.activeSpans.clear();

        // Flush Sentry
        await Sentry.flush(2000);
    }

    // Private helper methods
    private getComponentFromOp(op: string): string {
        if (op.includes("llm") || op.includes("embedding")) return "ai";
        if (op.includes("pdf") || op.includes("extraction"))
            return "processing";
        if (op.includes("vector") || op.includes("search")) return "search";
        if (op.includes("streaming")) return "streaming";
        return "general";
    }

    private sanitizeData(data: Record<string, any>): Record<string, any> {
        const sanitized: Record<string, any> = {};

        for (const [key, value] of Object.entries(data)) {
            if (typeof value === "string" && value.length > 10000) {
                sanitized[key] = value;
            } else if (
                key.toLowerCase().includes("key") ||
                key.toLowerCase().includes("token")
            ) {
                sanitized[key] = "[REDACTED]";
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }
}

// Export singleton instance
export const sentryMonitoringService = new SentryMonitoringService();

// Cleanup on process exit
process.on("SIGINT", async () => {
    await sentryMonitoringService.cleanup();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    await sentryMonitoringService.cleanup();
    process.exit(0);
});
