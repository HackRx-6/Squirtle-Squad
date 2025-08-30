import { spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import type {
  TerminalExecutionOptions,
  TerminalExecutionResult,
  TerminalServiceConfig,
} from "./types";
import { AppConfigService } from "../../config/app.config";
import { PromptInjectionProtectionService } from "../cleaning/promptInjection.protection";

export class TerminalService {
  private static instance: TerminalService;
  private config: TerminalServiceConfig;
  private activeExecutions = 0;

  private constructor() {
    this.config = {
      defaultTimeout: 30000, // 30 seconds
      defaultMaxOutputSize: 1024 * 1024, // 1MB
      blockedCommands: [
        "rm",
        "rmdir",
        "del",
        "format",
        "fdisk",
        "mkfs",
        "dd",
        "shred",
        "wipe",
        "sudo",
        "su",
        "passwd",
        "useradd",
        "userdel",
        "usermod",
        "chmod",
        "chown",
        "systemctl",
        "service",
        "reboot",
        "shutdown",
        "halt",
        "init",
        "kill",
        "killall",
        "pkill",
        "crontab",
      ],
      allowShellExpansion: false,
      maxConcurrentExecutions: 3,
    };
  }

  public static getInstance(): TerminalService {
    if (!TerminalService.instance) {
      TerminalService.instance = new TerminalService();
    }
    return TerminalService.instance;
  }

  /**
   * Execute a terminal command safely or download and execute a code file
   */
  public async executeCommand(
    command: string,
    options: TerminalExecutionOptions = {}
  ): Promise<TerminalExecutionResult> {
    const startTime = Date.now();

    // Check concurrent execution limit
    if (this.activeExecutions >= this.config.maxConcurrentExecutions) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        command,
        workingDirectory: options.workingDirectory || process.cwd(),
        executionTime: Date.now() - startTime,
        timedOut: false,
        error: "Maximum concurrent executions reached. Please try again later.",
      };
    }

    this.activeExecutions++;

    try {
      // Handle file URL execution
      if (options.fileUrl) {
        return await this.executeFileFromUrl(
          options.fileUrl,
          options,
          startTime
        );
      }

      // Clean command for prompt injection attacks
      console.log("🛡️ [Terminal] Cleaning command for prompt injection");
      const originalCommand = command;
      const cleanedCommand = PromptInjectionProtectionService.sanitizeText(
        command,
        {
          strictMode: true,
          preserveFormatting: true,
          logSuspiciousContent: true,
          azureContentPolicy: true,
          preserveUrls: true,
          skipDocumentWrapping: true,
        }
      );

      // Check if any malicious content was detected and cleaned
      if (originalCommand !== cleanedCommand) {
        console.warn(
          "🚨 [Terminal] Potential prompt injection detected and cleaned in command",
          {
            originalCommand: originalCommand.substring(0, 100) + "...",
            cleanedCommand: cleanedCommand.substring(0, 100) + "...",
            originalLength: originalCommand.length,
            cleanedLength: cleanedCommand.length,
          }
        );
      }

      // Use cleaned command for execution
      command = cleanedCommand;

      console.log("🛡️ [Terminal] Command cleaning completed", {
        originalLength: originalCommand.length,
        cleanedLength: cleanedCommand.length,
        changed: originalCommand !== cleanedCommand,
      });

      // Simple Git push enhancement with dynamic branch support
      if (command.includes("git push") && !command.includes("--set-upstream")) {
        console.log(
          "🔍 [Terminal] Detected git push command, using dynamic branch strategy"
        );

        // Simple approach: if it's just "git push", make it set upstream automatically
        if (command.trim() === "git push") {
          // Try to get current branch (should be the dynamic branch from startup)
          try {
            const branchResult = await this.executeCommandInternal(
              "git branch --show-current",
              { ...options, timeout: 5000 },
              Date.now()
            );

            if (branchResult.success && branchResult.stdout.trim()) {
              const currentBranch = branchResult.stdout.trim();
              command = `git push --set-upstream origin ${currentBranch}`;
              console.log(`🌿 [Terminal] Pushing to dynamic branch: ${currentBranch}`);
              console.log(`🔧 [Terminal] Modified command: ${command}`);
              console.log(`🎉 [Terminal] This avoids merge conflicts with main!`);
            }
          } catch (error) {
            console.warn(
              "⚠️ [Terminal] Could not determine branch for upstream:",
              error
            );
          }
        }
      }

      // Handle direct command execution
      const validationError = this.validateCommand(command);
      if (validationError) {
        return {
          success: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          command,
          workingDirectory: options.workingDirectory || process.cwd(),
          executionTime: Date.now() - startTime,
          timedOut: false,
          error: validationError,
        };
      }

      return await this.executeCommandInternal(command, options, startTime);
    } finally {
      this.activeExecutions--;
    }
  }

  private async executeCommandInternal(
    command: string,
    options: TerminalExecutionOptions,
    startTime: number
  ): Promise<TerminalExecutionResult> {
    const timeout = options.timeout || this.config.defaultTimeout;
    const maxOutputSize =
      options.maxOutputSize || this.config.defaultMaxOutputSize;
    const workingDirectory = options.workingDirectory || process.cwd();
    const shell =
      options.shell || (os.platform() === "win32" ? "cmd.exe" : "/bin/sh");

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let exitCode: number | null = null;

    return new Promise((resolve) => {
      const env = { ...process.env, ...options.environment };

      // Check if command contains shell operators that require shell execution
      const requiresShell = /[>|&;`$(){}[\]\\]/.test(command);

      console.log(`🖥️ [Terminal] Executing: ${command}`);
      console.log(`🖥️ [Terminal] Working directory: ${workingDirectory}`);
      console.log(`🖥️ [Terminal] Timeout: ${timeout}ms`);
      console.log(`🖥️ [Terminal] Requires shell: ${requiresShell}`);

      let childProcess: ChildProcess;

      if (requiresShell) {
        // Execute as shell command for commands with redirection, pipes, etc.
        childProcess = spawn(shell || "/bin/sh", ["-c", command], {
          cwd: workingDirectory,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else {
        // Parse command and arguments for simple commands
        const args = this.parseCommand(command);
        const cmd = args[0];
        const cmdArgs = args.slice(1);

        if (!cmd) {
          throw new Error("No command specified");
        }

        childProcess = spawn(cmd, cmdArgs, {
          cwd: workingDirectory,
          env,
          shell: os.platform() === "win32" ? true : false,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        childProcess.kill("SIGTERM");

        // Force kill after 5 seconds if SIGTERM doesn't work
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill("SIGKILL");
          }
        }, 5000);
      }, timeout);

      // Collect stdout
      childProcess.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= maxOutputSize) {
          stdout += chunk;
        } else {
          stdout += chunk.substring(0, maxOutputSize - stdout.length);
          stdout += "\n[OUTPUT TRUNCATED - Maximum output size exceeded]";
        }
      });

      // Collect stderr
      childProcess.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        if (stderr.length + chunk.length <= maxOutputSize) {
          stderr += chunk;
        } else {
          stderr += chunk.substring(0, maxOutputSize - stderr.length);
          stderr += "\n[ERROR OUTPUT TRUNCATED - Maximum output size exceeded]";
        }
      });

      // Handle process completion
      childProcess.on("close", (code: number | null) => {
        clearTimeout(timeoutHandle);
        exitCode = code;

        const executionTime = Date.now() - startTime;

        console.log(
          `🖥️ [Terminal] Command completed in ${executionTime}ms with exit code: ${code}`
        );
        console.log(`🖥️ [Terminal] Stdout length: ${stdout.length} characters`);
        console.log(`🖥️ [Terminal] Stderr length: ${stderr.length} characters`);

        resolve({
          success: code === 0 && !timedOut,
          stdout,
          stderr,
          exitCode,
          command,
          workingDirectory,
          executionTime,
          timedOut,
          error: timedOut ? "Command execution timed out" : undefined,
        });
      });

      // Handle process errors
      childProcess.on("error", (error: Error) => {
        clearTimeout(timeoutHandle);
        const executionTime = Date.now() - startTime;

        console.error(`🖥️ [Terminal] Command error:`, error);

        resolve({
          success: false,
          stdout,
          stderr,
          exitCode: null,
          command,
          workingDirectory,
          executionTime,
          timedOut: false,
          error: `Process error: ${error.message}`,
        });
      });
    });
  }

  /**
   * Validate command for security
   */
  private validateCommand(command: string): string | null {
    if (!command || command.trim().length === 0) {
      return "Command cannot be empty";
    }

    // Remove leading/trailing whitespace
    command = command.trim();

    // Check for blocked commands
    const args = this.parseCommand(command);
    const baseCommand = path.basename(args[0] || "").toLowerCase();

    if (!args[0]) {
      return "Command cannot be empty";
    }

    for (const blocked of this.config.blockedCommands) {
      if (baseCommand === blocked || baseCommand.startsWith(blocked + ".")) {
        return `Command '${blocked}' is not allowed for security reasons`;
      }
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /;\s*(rm|del|format)/i,
      /\|\s*(rm|del|format)/i,
      /&&\s*(rm|del|format)/i,
      />\s*\/dev\/(null|zero|random)/i,
      /\$\(.*\)/, // Command substitution
      /`.*`/, // Backtick command substitution
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return "Command contains potentially dangerous patterns";
      }
    }

    // Check command length
    if (command.length > 1000) {
      return "Command is too long (maximum 1000 characters)";
    }

    return null;
  }

  /**
   * Parse command into arguments (basic shell parsing)
   */
  private parseCommand(command: string): string[] {
    const args: string[] = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = "";
      } else if (!inQuotes && char === " ") {
        if (current.length > 0) {
          args.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }

    if (current.length > 0) {
      args.push(current);
    }

    return args;
  }

  /**
   * Get service statistics
   */
  public getStats() {
    return {
      activeExecutions: this.activeExecutions,
      maxConcurrentExecutions: this.config.maxConcurrentExecutions,
      defaultTimeout: this.config.defaultTimeout,
      blockedCommandsCount: this.config.blockedCommands.length,
    };
  }

  /**
   * Download and execute a code file from URL
   */
  private async executeFileFromUrl(
    fileUrl: string,
    options: TerminalExecutionOptions,
    startTime: number
  ): Promise<TerminalExecutionResult> {
    try {
      console.log(`🌐 [Terminal] Downloading file from: ${fileUrl}`);

      // Download file
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to download file: ${response.status} ${response.statusText}`
        );
      }

      const fileContent = await response.text();
      const fileExtension = this.getFileExtension(fileUrl);
      const tempFileName = `temp_${Date.now()}${fileExtension}`;
      const workingDirectory = options.workingDirectory || process.cwd();
      const tempFilePath = path.join(workingDirectory, tempFileName);

      // Write file to temp location
      fs.writeFileSync(tempFilePath, fileContent);

      console.log(`📝 [Terminal] File saved to: ${tempFilePath}`);

      try {
        // Determine runtime and command
        const runtime = options.runtime || this.detectRuntime(fileExtension);
        const command = this.buildExecutionCommand(tempFileName, runtime);

        console.log(`🚀 [Terminal] Executing with ${runtime}: ${command}`);

        // Execute the file
        const result = await this.executeCommandInternal(
          command,
          options,
          startTime
        );

        // Update command in result to show what was actually executed
        result.command = `Downloaded and executed: ${fileUrl} using ${runtime}`;

        return result;
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempFilePath);
          console.log(`🗑️ [Terminal] Cleaned up temp file: ${tempFilePath}`);
        } catch (cleanupError) {
          console.warn(
            `⚠️ [Terminal] Failed to cleanup temp file: ${cleanupError}`
          );
        }
      }
    } catch (error: any) {
      return {
        success: false,
        stdout: "",
        stderr: error.message || "Failed to download and execute file",
        exitCode: null,
        command: `Download and execute: ${fileUrl}`,
        workingDirectory: options.workingDirectory || process.cwd(),
        executionTime: Date.now() - startTime,
        timedOut: false,
        error: error.message || "File execution failed",
      };
    }
  }

  /**
   * Get file extension from URL
   */
  private getFileExtension(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const extension = path.extname(pathname);
      return extension || ".txt";
    } catch {
      return ".txt";
    }
  }

  /**
   * Detect runtime based on file extension
   */
  private detectRuntime(fileExtension: string): string {
    const ext = fileExtension.toLowerCase();
    switch (ext) {
      case ".js":
      case ".mjs":
        return "node";
      case ".ts":
        return "deno"; // or 'node' with ts-node
      case ".py":
        return "python";
      case ".sh":
      case ".bash":
        return "bash";
      default:
        return "node"; // default to node
    }
  }

  /**
   * Build execution command based on runtime
   */
  private buildExecutionCommand(fileName: string, runtime: string): string {
    switch (runtime) {
      case "node":
        return `node ${fileName}`;
      case "python":
        return `python3 ${fileName}`;
      case "bash":
        return `bash ${fileName}`;
      case "deno":
        return `deno run ${fileName}`;
      case "bun":
        return `bun run ${fileName}`;
      default:
        return `node ${fileName}`;
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<TerminalServiceConfig>) {
    this.config = { ...this.config, ...newConfig };
  }
}

// Export singleton instance
export const terminalService = TerminalService.getInstance();
