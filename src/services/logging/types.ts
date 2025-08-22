export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    component?: string;
    metadata?: Record<string, any>;
    traceId?: string;
}