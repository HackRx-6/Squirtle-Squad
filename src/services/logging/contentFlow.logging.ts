import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { loggingService } from "./core.logging";

export interface ContentFlowLogEntry {
  timestamp: string;
  sessionId: string;
  stage:
    | "playwright_extract"
    | "tool_response"
    | "llm_prompt"
    | "llm_response"
    | "hackrx_final";
  url?: string;
  contentType:
    | "page_content"
    | "tool_result"
    | "system_prompt"
    | "user_message"
    | "llm_response"
    | "final_answers";
  contentLength: number;
  content: string;
  metadata?: {
    actionCount?: number;
    questionsCount?: number;
    model?: string;
    executionTimeMs?: number;
    [key: string]: any;
  };
}

export class ContentFlowLoggingService {
  private static instance: ContentFlowLoggingService;
  private logger = loggingService.createComponentLogger("ContentFlowLogger");
  private logDir: string;
  private sessionLogFiles: Map<string, string> = new Map();

  private constructor() {
    // Create logs directory structure
    this.logDir = join(process.cwd(), "logs", "content-flow");
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    this.logger.info("ContentFlowLoggingService initialized", {
      logDir: this.logDir,
    });
  }

  public static getInstance(): ContentFlowLoggingService {
    if (!ContentFlowLoggingService.instance) {
      ContentFlowLoggingService.instance = new ContentFlowLoggingService();
    }
    return ContentFlowLoggingService.instance;
  }

  private getSessionLogFile(sessionId: string): string {
    if (!this.sessionLogFiles.has(sessionId)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `session_${sessionId}_${timestamp}.log`;
      const filepath = join(this.logDir, filename);
      this.sessionLogFiles.set(sessionId, filepath);

      // Write session header
      const header = `=== CONTENT FLOW LOG SESSION ===
Session ID: ${sessionId}
Started: ${new Date().toISOString()}
Log File: ${filename}
=====================================

`;
      writeFileSync(filepath, header, "utf8");
      this.logger.info("Created new session log file", { sessionId, filepath });
    }

    return this.sessionLogFiles.get(sessionId)!;
  }

  private formatLogEntry(entry: ContentFlowLogEntry): string {
    const separator = "=".repeat(80);
    const stageSeparator = "-".repeat(40);

    return `
${separator}
STAGE: ${entry.stage.toUpperCase()}
${stageSeparator}
Timestamp: ${entry.timestamp}
Session ID: ${entry.sessionId}
Content Type: ${entry.contentType}
Content Length: ${entry.contentLength.toLocaleString()} characters
${entry.url ? `URL: ${entry.url}` : ""}
${entry.metadata ? `Metadata: ${JSON.stringify(entry.metadata, null, 2)}` : ""}
${stageSeparator}

CONTENT:
${entry.content}

${separator}

`;
  }

  public logContentFlow(entry: Omit<ContentFlowLogEntry, "timestamp">): void {
    const logEntry: ContentFlowLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    try {
      // Log to session file
      const logFile = this.getSessionLogFile(entry.sessionId);
      const formattedEntry = this.formatLogEntry(logEntry);
      appendFileSync(logFile, formattedEntry, "utf8");

      // Log summary to main logger
      this.logger.info(`Content flow logged: ${entry.stage}`, {
        sessionId: entry.sessionId,
        contentType: entry.contentType,
        contentLength: entry.contentLength,
        url: entry.url,
        logFile: logFile,
        metadata: entry.metadata,
      });

      // Console output for immediate visibility
      console.log(
        `📝 [ContentFlow] ${entry.stage} | ${
          entry.contentType
        } | ${entry.contentLength.toLocaleString()} chars | Session: ${
          entry.sessionId
        }`
      );
    } catch (error) {
      this.logger.error("Failed to log content flow", {
        sessionId: entry.sessionId,
        stage: entry.stage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Convenience methods for different stages
  public logPlaywrightExtraction(
    sessionId: string,
    url: string,
    pageContent: string,
    metadata?: any
  ): void {
    this.logContentFlow({
      sessionId,
      stage: "playwright_extract",
      url,
      contentType: "page_content",
      contentLength: pageContent.length,
      content: pageContent,
      metadata,
    });
  }

  public logToolResponse(
    sessionId: string,
    url: string,
    toolResult: string,
    metadata?: any
  ): void {
    this.logContentFlow({
      sessionId,
      stage: "tool_response",
      url,
      contentType: "tool_result",
      contentLength: toolResult.length,
      content: toolResult,
      metadata,
    });
  }

  public logLLMPrompt(
    sessionId: string,
    promptType: "system_prompt" | "user_message",
    content: string,
    metadata?: any
  ): void {
    this.logContentFlow({
      sessionId,
      stage: "llm_prompt",
      contentType: promptType,
      contentLength: content.length,
      content: content,
      metadata,
    });
  }

  public logLLMResponse(
    sessionId: string,
    response: string,
    metadata?: any
  ): void {
    this.logContentFlow({
      sessionId,
      stage: "llm_response",
      contentType: "llm_response",
      contentLength: response.length,
      content: response,
      metadata,
    });
  }

  public logHackRXFinalAnswers(
    sessionId: string,
    answers: string[],
    metadata?: any
  ): void {
    const formattedAnswers = answers
      .map((answer, index) => `ANSWER ${index + 1}:\n${answer}`)
      .join("\n\n");

    this.logContentFlow({
      sessionId,
      stage: "hackrx_final",
      contentType: "final_answers",
      contentLength: formattedAnswers.length,
      content: formattedAnswers,
      metadata: {
        ...metadata,
        answersCount: answers.length,
      },
    });
  }

  public finishSession(sessionId: string): void {
    const logFile = this.sessionLogFiles.get(sessionId);
    if (logFile) {
      const footer = `
=== SESSION COMPLETED ===
Session ID: ${sessionId}
Completed: ${new Date().toISOString()}
========================

`;
      appendFileSync(logFile, footer, "utf8");
      this.sessionLogFiles.delete(sessionId);

      this.logger.info("Session logging completed", { sessionId, logFile });
      console.log(
        `✅ [ContentFlow] Session completed: ${sessionId} | Log: ${logFile}`
      );
    }
  }

  // Utility method to get current log directory for external reference
  public getLogDirectory(): string {
    return this.logDir;
  }

  // Method to list all session log files
  public getSessionLogFiles(): string[] {
    return Array.from(this.sessionLogFiles.values());
  }
}

// Export singleton instance
export const contentFlowLogger = ContentFlowLoggingService.getInstance();
