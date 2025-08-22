import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import type { LogLevel, LogEntry } from "./types";

export class LoggingService {
    private static instance: LoggingService;
    private logsDir: string;
    private enabled: boolean;
    private hasLoggedWriteError: boolean = false;
    private originalConsole: {
        log: typeof console.log;
        warn: typeof console.warn;
        error: typeof console.error;
        debug: typeof console.debug;
    };

    private constructor() {
        // Use environment-specific log directory
        this.logsDir = this.getLogDirectory();
        this.enabled = process.env.NODE_ENV !== "test" && process.env.LOGGING_ENABLED !== "false";
        
        // Store original console methods
        this.originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
        };

        this.ensureLogsDirectory();
        this.interceptConsoleLogs();
        this.setupLogRotation();
    }

    public static getInstance(): LoggingService {
        if (!LoggingService.instance) {
            LoggingService.instance = new LoggingService();
        }
        return LoggingService.instance;
    }

    private getLogDirectory(): string {
        // Priority order for log directory:
        // 1. LOG_DIR environment variable
        // 2. Platform-specific temp directory for production
        // 3. ./logs for development
        // 4. src/logs as fallback
        
        if (process.env.LOG_DIR) {
            return process.env.LOG_DIR;
        }
        
        if (process.env.NODE_ENV === "production") {
            // Use platform-specific temp directory in production
            const os = require("os");
            const tempDir = os.tmpdir();
            const prodLogDir = join(tempDir, "fantastic-robo-logs");
            
            // Try to create and use temp directory
            if (this.canCreateDirectory(prodLogDir)) {
                return prodLogDir;
            }
            
            // Fallback to current directory if temp fails
            const fallbackDir = join(process.cwd(), "logs");
            if (this.canCreateDirectory(fallbackDir)) {
                return fallbackDir;
            }
        }
        
        // Development: try ./logs first, then src/logs
        const devLogDir = join(process.cwd(), "logs");
        if (existsSync(devLogDir) || this.canCreateDirectory(devLogDir)) {
            return devLogDir;
        }
        
        return join(process.cwd(), "src", "logs");
    }

    private canCreateDirectory(dir: string): boolean {
        try {
            mkdirSync(dir, { recursive: true });
            return true;
        } catch {
            return false;
        }
    }

    private ensureLogsDirectory(): void {
        try {
            if (!existsSync(this.logsDir)) {
                mkdirSync(this.logsDir, { recursive: true });
            }
        } catch (error) {
            // If we can't create the log directory, disable file logging
            this.originalConsole.warn(`⚠️ Cannot create log directory ${this.logsDir}, disabling file logging:`, error);
            this.enabled = false;
        }
    }

    private interceptConsoleLogs(): void {
        if (!this.enabled) return;

        // Override console.log
        console.log = (...args: any[]) => {
            this.originalConsole.log(...args);
            this.writeLog("info", this.formatConsoleMessage(args));
        };

        // Override console.warn
        console.warn = (...args: any[]) => {
            this.originalConsole.warn(...args);
            this.writeLog("warn", this.formatConsoleMessage(args));
        };

        // Override console.error
        console.error = (...args: any[]) => {
            this.originalConsole.error(...args);
            this.writeLog("error", this.formatConsoleMessage(args));
        };

        // Override console.debug
        console.debug = (...args: any[]) => {
            this.originalConsole.debug(...args);
            this.writeLog("debug", this.formatConsoleMessage(args));
        };
    }

    private formatConsoleMessage(args: any[]): string {
        return args
            .map(arg => {
                if (typeof arg === "object") {
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch {
                        return String(arg);
                    }
                }
                return String(arg);
            })
            .join(" ");
    }

    private writeLog(level: LogLevel, message: string, component?: string, metadata?: Record<string, any>): void {
        if (!this.enabled) return;

        const logEntry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            component,
            metadata,
        };

        const logLine = this.formatLogLine(logEntry);

        try {
            // Write to main log file
            const mainLogFile = join(this.logsDir, "application.log");
            appendFileSync(mainLogFile, logLine + "\n");

            // Write to level-specific log file
            const levelLogFile = join(this.logsDir, `${level}.log`);
            appendFileSync(levelLogFile, logLine + "\n");

            // Write to daily log file
            const dailyLogFile = join(this.logsDir, `${this.getCurrentDateString()}.log`);
            appendFileSync(dailyLogFile, logLine + "\n");

        } catch (error) {
            // Fallback to original console if file writing fails
            // Only log this error once to avoid spam
            if (!this.hasLoggedWriteError) {
                this.originalConsole.error("Failed to write to log file, disabling file logging:", error);
                this.hasLoggedWriteError = true;
                this.enabled = false; // Disable file logging if it fails
            }
        }
    }

    private formatLogLine(entry: LogEntry): string {
        const baseLog = `[${entry.timestamp}] [${entry.level.toUpperCase()}]${entry.component ? ` [${entry.component}]` : ""} ${entry.message}`;
        
        if (entry.metadata && Object.keys(entry.metadata).length > 0) {
            return `${baseLog} | Metadata: ${JSON.stringify(entry.metadata)}`;
        }
        
        return baseLog;
    }

    private getCurrentDateString(): string {
        return new Date().toISOString().split("T")[0]!; // YYYY-MM-DD format
    }

    private setupLogRotation(): void {
        // Run log rotation daily at midnight
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        const msUntilMidnight = tomorrow.getTime() - now.getTime();

        setTimeout(() => {
            this.rotateOldLogs();
            // Set up recurring rotation every 24 hours
            setInterval(() => this.rotateOldLogs(), 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
    }

    private rotateOldLogs(): void {
        if (!this.enabled) return;

        try {
            const fs = require("fs");
            const path = require("path");
            
            // Get all log files
            const files = fs.readdirSync(this.logsDir);
            const logFiles = files.filter((file: string) => file.endsWith(".log"));
            
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            for (const file of logFiles) {
                const filePath = path.join(this.logsDir, file);
                const stats = fs.statSync(filePath);
                
                // Archive logs older than 7 days
                if (stats.mtime < sevenDaysAgo) {
                    const archivePath = path.join(this.logsDir, "archived", file);
                    
                    // Ensure archived directory exists
                    const archiveDir = path.join(this.logsDir, "archived");
                    if (!fs.existsSync(archiveDir)) {
                        fs.mkdirSync(archiveDir, { recursive: true });
                    }
                    
                    // Move old log to archived folder
                    fs.renameSync(filePath, archivePath);
                    this.originalConsole.log(`📦 Archived old log file: ${file}`);
                }
            }
        } catch (error) {
            this.originalConsole.error("Failed to rotate logs:", error);
        }
    }

    // Manual logging methods for structured logging
    public info(message: string, component?: string, metadata?: Record<string, any>): void {
        this.writeLog("info", message, component, metadata);
        this.originalConsole.log(`ℹ️ ${component ? `[${component}] ` : ""}${message}`);
    }

    public warn(message: string, component?: string, metadata?: Record<string, any>): void {
        this.writeLog("warn", message, component, metadata);
        this.originalConsole.warn(`⚠️ ${component ? `[${component}] ` : ""}${message}`);
    }

    public error(message: string, component?: string, metadata?: Record<string, any>): void {
        this.writeLog("error", message, component, metadata);
        this.originalConsole.error(`❌ ${component ? `[${component}] ` : ""}${message}`);
    }

    public debug(message: string, component?: string, metadata?: Record<string, any>): void {
        this.writeLog("debug", message, component, metadata);
        this.originalConsole.debug(`🐛 ${component ? `[${component}] ` : ""}${message}`);
    }

    // Method to create component-specific loggers
    public createComponentLogger(componentName: string) {
        return {
            info: (message: string, metadata?: Record<string, any>) => 
                this.info(message, componentName, metadata),
            warn: (message: string, metadata?: Record<string, any>) => 
                this.warn(message, componentName, metadata),
            error: (message: string, metadata?: Record<string, any>) => 
                this.error(message, componentName, metadata),
            debug: (message: string, metadata?: Record<string, any>) => 
                this.debug(message, componentName, metadata),
        };
    }

    // Get logging statistics
    public getStats(): {
        enabled: boolean;
        logsDirectory: string;
        logFiles: string[];
        totalLogFiles: number;
        estimatedLogSize: string;
    } {
        try {
            const fs = require("fs");
            const files = fs.readdirSync(this.logsDir);
            const logFiles = files.filter((file: string) => file.endsWith(".log"));
            
            let totalSize = 0;
            logFiles.forEach((file: string) => {
                try {
                    const stats = fs.statSync(join(this.logsDir, file));
                    totalSize += stats.size;
                } catch (error) {
                    // Ignore individual file errors
                }
            });

            return {
                enabled: this.enabled,
                logsDirectory: this.logsDir,
                logFiles,
                totalLogFiles: logFiles.length,
                estimatedLogSize: this.formatBytes(totalSize),
            };
        } catch (error) {
            return {
                enabled: this.enabled,
                logsDirectory: this.logsDir,
                logFiles: [],
                totalLogFiles: 0,
                estimatedLogSize: "Unknown",
            };
        }
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    // Cleanup method
    public cleanup(): void {
        if (!this.enabled) return;

        // Restore original console methods
        console.log = this.originalConsole.log;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
        console.debug = this.originalConsole.debug;
    }

    // Method to read recent logs (for monitoring)
    public getRecentLogs(level?: LogLevel, lines: number = 100): string[] {
        try {
            const fs = require("fs");
            const logFile = level 
                ? join(this.logsDir, `${level}.log`)
                : join(this.logsDir, "application.log");
            
            if (!fs.existsSync(logFile)) {
                return [];
            }

            const content = fs.readFileSync(logFile, "utf8");
            const allLines = content.split("\n").filter((line: string) => line.trim());
            
            // Return last N lines
            return allLines.slice(-lines);
        } catch (error) {
            this.originalConsole.error("Failed to read log file:", error);
            return [];
        }
    }
}

// Export singleton instance
export const loggingService = LoggingService.getInstance();

// Setup graceful shutdown
process.on("SIGTERM", () => {
    loggingService.cleanup();
});

process.on("SIGINT", () => {
    loggingService.cleanup();
});
