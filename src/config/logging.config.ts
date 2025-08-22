import type { LoggingConfig } from "./types";

export class LoggingConfigService {
    private static instance: LoggingConfigService;

    private constructor() {}

    public static getInstance(): LoggingConfigService {
        if (!LoggingConfigService.instance) {
            LoggingConfigService.instance = new LoggingConfigService();
        }
        return LoggingConfigService.instance;
    }

    public getLoggingConfig(): LoggingConfig {
        return {
            enabled: process.env.NODE_ENV !== "test",
            logLevel: (process.env.LOG_LEVEL as any) || "info",
            fileLogging: process.env.FILE_LOGGING !== "false",
            consoleLogging: process.env.CONSOLE_LOGGING !== "false",
            maxFileSize: parseInt(process.env.MAX_LOG_FILE_SIZE_MB || "100"),
            maxFiles: parseInt(process.env.MAX_LOG_FILES || "10"),
            archiveAfterDays: parseInt(process.env.LOG_ARCHIVE_DAYS || "7"),
            logRotation: process.env.LOG_ROTATION !== "false",
            logFormat: (process.env.LOG_FORMAT as any) || "detailed",
        };
    }

    public shouldLog(level: "debug" | "info" | "warn" | "error"): boolean {
        const config = this.getLoggingConfig();
        if (!config.enabled) return false;

        const levels = ["debug", "info", "warn", "error"];
        const currentLevelIndex = levels.indexOf(config.logLevel);
        const requestedLevelIndex = levels.indexOf(level);

        return requestedLevelIndex >= currentLevelIndex;
    }
}
