#!/usr/bin/env bun

import { loggingService } from "../src/services/logging";
import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

// Get log directory from logging service or environment
function getLogDirectory(): string {
    // Priority order:
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

        // Check if we can use temp directory
        try {
            if (!existsSync(prodLogDir)) {
                require("fs").mkdirSync(prodLogDir, { recursive: true });
            }
            return prodLogDir;
        } catch {
            // Fallback to current directory if temp fails
            return join(process.cwd(), "logs");
        }
    }

    const devLogDir = join(process.cwd(), "logs");
    if (existsSync(devLogDir)) {
        return devLogDir;
    }

    return join(process.cwd(), "src", "logs");
}

const LOGS_DIR = getLogDirectory();

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case "stats":
            showStats();
            break;
        case "tail":
            await tailLogs(
                args[1] as string,
                parseInt(args[2] as string) || 50
            );
            break;
        case "view":
            await viewLog(args[1] as string, args[2] as string);
            break;
        case "list":
            listLogFiles();
            break;
        case "clean":
            await cleanOldLogs(parseInt(args[1] as string) || 7);
            break;
        case "search":
            await searchLogs(args[1] as string, args[2] as string);
            break;
        case "diagnose":
            await diagnoseLogging();
            break;
        default:
            showHelp();
    }
}

function showHelp() {
    console.log(`
📋 Fantastic Robo Log Management Tool

Usage: bun scripts/log-manager.ts <command> [options]

Commands:
  stats                    Show logging statistics
  tail [level] [lines]     Show recent logs (default: 50 lines from all logs)
  view <file> [level]      View specific log file
  list                     List all log files
  clean [days]            Clean logs older than N days (default: 7)
  search <term> [level]   Search for term in logs
  diagnose                Diagnose logging issues (production troubleshooting)

Examples:
  bun scripts/log-manager.ts stats
  bun scripts/log-manager.ts tail error 100
  bun scripts/log-manager.ts view 2024-01-15.log
  bun scripts/log-manager.ts search "PDF processing"
  bun scripts/log-manager.ts clean 30
`);
}

function showStats() {
    console.log("📊 Logging Service Statistics");
    console.log("=".repeat(40));

    const stats = loggingService.getStats();
    console.log(`Status: ${stats.enabled ? "✅ Enabled" : "❌ Disabled"}`);
    console.log(`Directory: ${stats.logsDirectory}`);
    console.log(
        `Directory Exists: ${
            existsSync(stats.logsDirectory) ? "✅ Yes" : "❌ No"
        }`
    );
    console.log(
        `Directory Writable: ${
            checkDirectoryWritable(stats.logsDirectory) ? "✅ Yes" : "❌ No"
        }`
    );
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`Total Log Files: ${stats.totalLogFiles}`);
    console.log(`Estimated Size: ${stats.estimatedLogSize}`);

    if (stats.logFiles.length > 0) {
        console.log("\n📁 Log Files:");
        stats.logFiles.forEach((file) => {
            const filePath = join(LOGS_DIR, file);
            if (existsSync(filePath)) {
                const stats = statSync(filePath);
                const size = formatBytes(stats.size);
                const modified = stats.mtime.toISOString().split("T")[0];
                console.log(
                    `  ${file.padEnd(20)} ${size.padEnd(8)} ${modified}`
                );
            }
        });
    }
}

async function tailLogs(level?: string, lines: number = 50) {
    console.log(
        `📖 Recent Logs${
            level ? ` (${level.toUpperCase()})` : ""
        } - Last ${lines} lines`
    );
    console.log("=".repeat(60));

    const recentLogs = loggingService.getRecentLogs(level as any, lines);

    if (recentLogs.length === 0) {
        console.log("No logs found.");
        return;
    }

    recentLogs.forEach((line) => {
        // Color code based on log level
        if (line.includes("[ERROR]")) {
            console.log(`\x1b[31m${line}\x1b[0m`); // Red
        } else if (line.includes("[WARN]")) {
            console.log(`\x1b[33m${line}\x1b[0m`); // Yellow
        } else if (line.includes("[DEBUG]")) {
            console.log(`\x1b[36m${line}\x1b[0m`); // Cyan
        } else {
            console.log(line);
        }
    });
}

async function viewLog(filename: string, level?: string) {
    const logFile = join(LOGS_DIR, filename);

    if (!existsSync(logFile)) {
        console.error(`❌ Log file not found: ${filename}`);
        return;
    }

    console.log(`📖 Viewing: ${filename}`);
    console.log("=".repeat(60));

    try {
        const content = readFileSync(logFile, "utf8");
        const lines = content.split("\n").filter((line) => line.trim());

        const filteredLines = level
            ? lines.filter((line) => line.includes(`[${level.toUpperCase()}]`))
            : lines;

        if (filteredLines.length === 0) {
            console.log("No matching logs found.");
            return;
        }

        filteredLines.forEach((line) => {
            // Color code based on log level
            if (line.includes("[ERROR]")) {
                console.log(`\x1b[31m${line}\x1b[0m`); // Red
            } else if (line.includes("[WARN]")) {
                console.log(`\x1b[33m${line}\x1b[0m`); // Yellow
            } else if (line.includes("[DEBUG]")) {
                console.log(`\x1b[36m${line}\x1b[0m`); // Cyan
            } else {
                console.log(line);
            }
        });

        console.log(`\n📊 Total lines: ${filteredLines.length}`);
    } catch (error) {
        console.error(`❌ Error reading log file: ${error}`);
    }
}

function listLogFiles() {
    console.log("📁 Available Log Files");
    console.log("=".repeat(40));

    if (!existsSync(LOGS_DIR)) {
        console.log("No logs directory found.");
        return;
    }

    try {
        const files = readdirSync(LOGS_DIR);
        const logFiles = files.filter((file) => file.endsWith(".log"));

        if (logFiles.length === 0) {
            console.log("No log files found.");
            return;
        }

        console.log("File".padEnd(25) + "Size".padEnd(10) + "Modified");
        console.log("-".repeat(45));

        logFiles.forEach((file) => {
            const filePath = join(LOGS_DIR, file);
            const stats = statSync(filePath);
            const size = formatBytes(stats.size);
            const modified = stats.mtime.toISOString().split("T")[0];
            console.log(`${file.padEnd(25)}${size.padEnd(10)}${modified}`);
        });
    } catch (error) {
        console.error(`❌ Error listing log files: ${error}`);
    }
}

async function cleanOldLogs(days: number) {
    console.log(`🧹 Cleaning logs older than ${days} days...`);

    if (!existsSync(LOGS_DIR)) {
        console.log("No logs directory found.");
        return;
    }

    try {
        const files = readdirSync(LOGS_DIR);
        const logFiles = files.filter((file) => file.endsWith(".log"));

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        let cleanedCount = 0;
        let savedSpace = 0;

        for (const file of logFiles) {
            const filePath = join(LOGS_DIR, file);
            const stats = statSync(filePath);

            if (stats.mtime < cutoffDate) {
                savedSpace += stats.size;
                cleanedCount++;
                console.log(
                    `🗑️  Removing: ${file} (${formatBytes(stats.size)})`
                );
                // In a real scenario, you'd actually delete the file
                // For safety, we're just logging what would be deleted
                // fs.unlinkSync(filePath);
            }
        }

        console.log(
            `\n✅ Would clean ${cleanedCount} files, saving ${formatBytes(
                savedSpace
            )}`
        );
        console.log(
            "💡 This is a dry run. Uncomment the deletion code to actually clean files."
        );
    } catch (error) {
        console.error(`❌ Error cleaning logs: ${error}`);
    }
}

async function searchLogs(searchTerm: string, level?: string) {
    if (!searchTerm) {
        console.error("❌ Please provide a search term");
        return;
    }

    console.log(
        `🔍 Searching for: "${searchTerm}"${
            level ? ` in ${level.toUpperCase()} logs` : ""
        }`
    );
    console.log("=".repeat(60));

    if (!existsSync(LOGS_DIR)) {
        console.log("No logs directory found.");
        return;
    }

    try {
        const files = readdirSync(LOGS_DIR);
        const logFiles = files.filter((file) => file.endsWith(".log"));

        let totalMatches = 0;

        for (const file of logFiles) {
            const filePath = join(LOGS_DIR, file);
            const content = readFileSync(filePath, "utf8");
            const lines = content.split("\n");

            const matchingLines = lines.filter((line) => {
                const hasSearchTerm = line
                    .toLowerCase()
                    .includes(searchTerm.toLowerCase());
                const hasLevel = level
                    ? line.includes(`[${level.toUpperCase()}]`)
                    : true;
                return hasSearchTerm && hasLevel && line.trim();
            });

            if (matchingLines.length > 0) {
                console.log(`\n📄 ${file} (${matchingLines.length} matches):`);
                console.log("-".repeat(40));

                matchingLines.slice(0, 10).forEach((line) => {
                    // Show max 10 matches per file
                    // Highlight search term
                    const highlighted = line.replace(
                        new RegExp(searchTerm, "gi"),
                        `\x1b[43m\x1b[30m$&\x1b[0m`
                    );

                    // Color code based on log level
                    if (line.includes("[ERROR]")) {
                        console.log(`\x1b[31m${highlighted}\x1b[0m`);
                    } else if (line.includes("[WARN]")) {
                        console.log(`\x1b[33m${highlighted}\x1b[0m`);
                    } else if (line.includes("[DEBUG]")) {
                        console.log(`\x1b[36m${highlighted}\x1b[0m`);
                    } else {
                        console.log(highlighted);
                    }
                });

                if (matchingLines.length > 10) {
                    console.log(
                        `... and ${matchingLines.length - 10} more matches`
                    );
                }

                totalMatches += matchingLines.length;
            }
        }

        console.log(`\n📊 Total matches found: ${totalMatches}`);
    } catch (error) {
        console.error(`❌ Error searching logs: ${error}`);
    }
}

function checkDirectoryWritable(dir: string): boolean {
    try {
        if (!existsSync(dir)) {
            return false;
        }

        // Try to write a test file
        const testFile = join(dir, ".write-test");
        require("fs").writeFileSync(testFile, "test");
        require("fs").unlinkSync(testFile);
        return true;
    } catch {
        return false;
    }
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

async function diagnoseLogging() {
    console.log("🔍 Logging Diagnostics");
    console.log("=".repeat(50));

    // Environment info
    console.log("📋 Environment Information:");
    console.log(`  NODE_ENV: ${process.env.NODE_ENV || "undefined"}`);
    console.log(`  LOG_DIR: ${process.env.LOG_DIR || "undefined"}`);
    console.log(
        `  LOGGING_ENABLED: ${process.env.LOGGING_ENABLED || "undefined"}`
    );
    console.log(`  Current Working Directory: ${process.cwd()}`);

    // Log directory checks
    console.log("\n📁 Log Directory Analysis:");
    const logDir = getLogDirectory();
    console.log(`  Determined Log Directory: ${logDir}`);
    console.log(
        `  Directory Exists: ${existsSync(logDir) ? "✅ Yes" : "❌ No"}`
    );

    if (existsSync(logDir)) {
        console.log(
            `  Directory Writable: ${
                checkDirectoryWritable(logDir) ? "✅ Yes" : "❌ No"
            }`
        );

        try {
            const stats = require("fs").statSync(logDir);
            console.log(`  Directory Permissions: ${stats.mode.toString(8)}`);
            console.log(
                `  Directory Owner: UID ${stats.uid}, GID ${stats.gid}`
            );
        } catch (error) {
            console.log(`  ❌ Cannot read directory stats: ${error}`);
        }
    } else {
        console.log("  ❌ Directory does not exist");

        // Try to create it
        console.log("  🔧 Attempting to create directory...");
        try {
            require("fs").mkdirSync(logDir, { recursive: true });
            console.log("  ✅ Successfully created directory");
        } catch (error) {
            console.log(`  ❌ Failed to create directory: ${error}`);
        }
    }

    // Logging service status
    console.log("\n🔧 Logging Service Status:");
    try {
        const stats = loggingService.getStats();
        console.log(`  Service Enabled: ${stats.enabled ? "✅ Yes" : "❌ No"}`);
        console.log(`  Service Log Directory: ${stats.logsDirectory}`);
        console.log(`  Log Files Found: ${stats.totalLogFiles}`);
        console.log(`  Total Log Size: ${stats.estimatedLogSize}`);

        if (stats.logFiles.length > 0) {
            console.log("  📄 Recent Log Files:");
            stats.logFiles.slice(-5).forEach((file) => {
                console.log(`    - ${file}`);
            });
        }
    } catch (error) {
        console.log(`  ❌ Error getting logging service stats: ${error}`);
    }

    // Test logging
    console.log("\n🧪 Test Logging:");
    try {
        const testMessage = `Test log entry at ${new Date().toISOString()}`;
        loggingService.info(testMessage, "LogDiagnostics");
        console.log("  ✅ Successfully wrote test log entry");

        // Try to read it back
        const recentLogs = loggingService.getRecentLogs("info", 5);
        const foundTestLog = recentLogs.some((log) =>
            log.includes(testMessage)
        );
        console.log(
            `  ✅ Test log entry ${
                foundTestLog ? "found" : "not found"
            } in recent logs`
        );
    } catch (error) {
        console.log(`  ❌ Failed to write test log: ${error}`);
    }

    // Recommendations
    console.log("\n💡 Recommendations:");
    if (process.env.NODE_ENV === "production" && !process.env.LOG_DIR) {
        console.log("  - Set LOG_DIR environment variable for production");
    }
    if (!existsSync(logDir)) {
        console.log("  - Ensure log directory exists and is writable");
    }
    if (!checkDirectoryWritable(logDir)) {
        console.log("  - Check directory permissions");
        console.log("  - Consider using /tmp/logs for production");
    }
}

// Run the CLI
main().catch(console.error);
