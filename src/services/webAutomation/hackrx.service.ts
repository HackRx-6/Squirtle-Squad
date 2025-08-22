import { runWithToolsIfRequested } from "../LLM/tools.LLM";
import { Config } from "../../config";
import { loggingService } from "../logging";
import type { TimerContext } from "../timer";
import { playwrightService } from "./playwright.service";
import OpenAI from "openai";

export interface HackRXRequest {
  documents: string;
  questions: string[];
}

export interface HackRXResponse {
  answers: string[];
  metadata?: {
    documents?: string;
    processedAt: number;
    toolsUsed: boolean;
  };
}

export interface HackRXError {
  error: string;
  errorType: "validation" | "timeout" | "llm" | "automation" | "unknown";
  details?: any;
}

export class HackRXService {
  private static instance: HackRXService;
  private logger = loggingService.createComponentLogger("HackRXService");

  private constructor() {
    this.logger.info("HackRXService initialized");
    // No need to instantiate LLMService here, we'll create the client directly
  }

  public static getInstance(): HackRXService {
    if (!HackRXService.instance) {
      HackRXService.instance = new HackRXService();
      loggingService.info(
        "HackRXService singleton instance created",
        "HackRXService"
      );
    }
    return HackRXService.instance;
  }

  private validateRequest(request: HackRXRequest): {
    isValid: boolean;
    error?: HackRXError;
  } {
    this.logger.debug("Validating HackRX request", {
      documents: request.documents,
      questionsCount: request.questions?.length || 0,
    });

    if (!request.documents || typeof request.documents !== "string") {
      this.logger.warn("Validation failed: Invalid documents provided", {
        documents: request.documents,
        documentsType: typeof request.documents,
      });
      return {
        isValid: false,
        error: {
          error: "Invalid documents provided",
          errorType: "validation",
        },
      };
    }

    if (
      !request.questions ||
      !Array.isArray(request.questions) ||
      request.questions.length === 0
    ) {
      this.logger.warn("Validation failed: Invalid questions array", {
        questions: request.questions,
        isArray: Array.isArray(request.questions),
        length: request.questions?.length || 0,
      });
      return {
        isValid: false,
        error: {
          error: "Questions array is required and cannot be empty",
          errorType: "validation",
        },
      };
    }

    for (let i = 0; i < request.questions.length; i++) {
      if (typeof request.questions[i] !== "string") {
        this.logger.warn(
          `Validation failed: Question ${i + 1} is not a string`,
          {
            questionIndex: i,
            questionType: typeof request.questions[i],
            question: request.questions[i],
          }
        );
        return {
          isValid: false,
          error: {
            error: `Question ${i + 1} must be a string`,
            errorType: "validation",
          },
        };
      }
    }

    this.logger.debug("Request validation successful", {
      documents: request.documents,
      questionsCount: request.questions.length,
    });

    return { isValid: true };
  }

  private createSystemPrompt(): string {
    return `You are an autonomous AI assistant with powerful tools. Execute tasks completely and handle errors proactively.

## AVAILABLE TOOLS:
- **web_automation**: Website interactions, scraping, forms
- **execute_terminal_command**: System commands, code execution, file operations, Git operations  
- **http_get_json_batch**: API calls and data fetching

## EXECUTION PRINCIPLES:
1. **COMPLETE ALL STEPS**: Don't stop at generating code - execute it, test it, and deliver results
2. **HANDLE ERRORS**: If code fails, debug it, fix it, and try again
3. **FOLLOW THROUGH**: Complete entire workflows (code → test → commit → push)
4. **BE AUTONOMOUS**: Don't ask for permission - just do the tasks
5. **VERIFY RESULTS**: Test your code with provided examples before finalizing

## CODING WORKFLOW:
When asked to solve coding problems:
1. Write the code using execute_terminal_command to create files
2. Test the code with provided examples immediately
3. If errors occur, debug and fix them
4. Once working, commit and push to Git as requested
5. Provide the final answer based on actual execution results

## GIT OPERATIONS:
For Git tasks, use execute_terminal_command to:
- Create directories: mkdir ROUND_6
- Write files: cat > filename.py << 'EOF' [code] EOF
- Add files: git add .
- Commit: git commit -m "message"
- Push: git push origin main

## RESPONSE FORMAT:
- For multiple questions: "ANSWER 1: [actual result]", "ANSWER 2: [actual result]"
- Provide ONLY the final computed results
- Don't show code unless specifically asked
- Don't explain the process - just deliver results

CRITICAL: Execute every step completely. Test code immediately. Fix errors. Complete Git operations. Provide actual results, not theoretical ones.`;
  }

  private createUserMessage(documents: string, questions: string[]): string {
    const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

    return `Documents/Context: ${documents}

Questions/Tasks:
${questionsText}

Please help me with these questions/tasks. Use the appropriate tools intelligently based on what each question requires.`;
  }

  private parseMultipleAnswers(
    formattedResponse: string,
    questions: string[]
  ): string[] {
    this.logger.debug("Parsing multiple answers from LLM response", {
      responseLength: formattedResponse.length,
      questionsCount: questions.length,
      responsePreview: formattedResponse.substring(0, 200) + "...",
    });

    const answers: string[] = [];

    // Try to parse answers in the format "ANSWER 1:", "ANSWER 2:", etc.
    const answerRegex = /ANSWER\s+(\d+):\s*(.+?)(?=ANSWER\s+\d+:|$)/gs;
    const matches = [...formattedResponse.matchAll(answerRegex)];

    if (matches.length > 0) {
      this.logger.info("Found structured answers in response", {
        matchCount: matches.length,
        expectedAnswers: questions.length,
      });

      // Sort matches by answer number to ensure correct order
      matches.sort((a, b) => {
        const aNum = a[1] ? parseInt(a[1]) : 0;
        const bNum = b[1] ? parseInt(b[1]) : 0;
        return aNum - bNum;
      });

      for (const match of matches) {
        const answerText = match[2]?.trim() || "";
        if (answerText) {
          answers.push(answerText);
          this.logger.debug(`Parsed answer ${answers.length}`, {
            answerLength: answerText.length,
            answerPreview: answerText.substring(0, 100) + "...",
          });
        }
      }

      // If we don't have enough answers, fill with the formatted response
      while (answers.length < questions.length) {
        this.logger.warn("Filling missing answer with full response", {
          currentAnswers: answers.length,
          expectedAnswers: questions.length,
        });
        answers.push(formattedResponse.trim());
      }
    } else {
      this.logger.warn("No structured answers found, using fallback parsing", {
        responseLength: formattedResponse.length,
      });

      // Fallback: try to split by line breaks and map to questions
      const lines = formattedResponse.split("\n").filter((line) => line.trim());

      if (lines.length >= questions.length) {
        this.logger.info("Using line-based answer parsing", {
          lineCount: lines.length,
          questionsCount: questions.length,
        });

        // Use the first N lines as answers
        for (let i = 0; i < questions.length; i++) {
          const line = lines[i];
          if (line) {
            answers.push(line.trim());
          } else {
            answers.push(formattedResponse.trim());
          }
        }
      } else {
        this.logger.warn(
          "Using full response for each question as final fallback",
          {
            lineCount: lines.length,
            questionsCount: questions.length,
          }
        );

        // Fallback: use the full response for each question
        for (let i = 0; i < questions.length; i++) {
          answers.push(formattedResponse.trim());
        }
      }
    }

    const finalAnswers = answers.slice(0, questions.length);
    this.logger.info("Answer parsing completed", {
      parsedAnswers: finalAnswers.length,
      expectedAnswers: questions.length,
      answerLengths: finalAnswers.map((a) => a.length),
    });

    return finalAnswers; // Ensure we don't have more answers than questions
  }

  public async processHackRX(
    request: HackRXRequest,
    timerContext: TimerContext
  ): Promise<{ success: boolean; data?: HackRXResponse; error?: HackRXError }> {
    const sessionId = `hackrx_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const startTime = Date.now();

    this.logger.info("Starting HackRX processing session", {
      sessionId,
      documents: request.documents,
      questionsCount: request.questions.length,
      questions: request.questions.map(
        (q, i) =>
          `${i + 1}. ${q.substring(0, 100)}${q.length > 100 ? "..." : ""}`
      ),
      timeRemaining: Math.max(
        0,
        timerContext.timeoutMs - (Date.now() - timerContext.startTime)
      ),
    });

    try {
      // Validate request
      this.logger.debug("Validating request", { sessionId });
      const validation = this.validateRequest(request);
      if (!validation.isValid) {
        this.logger.error("Request validation failed", {
          sessionId,
          error: validation.error,
          processingTimeMs: Date.now() - startTime,
        });
        return {
          success: false,
          error: validation.error,
        };
      }

      // Check timeout before processing
      if (timerContext.isExpired) {
        this.logger.error("Request timed out before processing could begin", {
          sessionId,
          timeRemaining: Math.max(
            0,
            timerContext.timeoutMs - (Date.now() - timerContext.startTime)
          ),
          processingTimeMs: Date.now() - startTime,
        });
        return {
          success: false,
          error: {
            error: "Request timed out before processing could begin",
            errorType: "timeout",
          },
        };
      }

      loggingService.info(
        `Starting HackRX processing for ${request.documents}`,
        "HackRXService",
        {
          sessionId,
          questionsCount: request.questions.length,
        }
      );

      // Create prompts
      this.logger.debug("Creating prompts for LLM", { sessionId });
      const systemPrompt = this.createSystemPrompt();
      const userMessage = this.createUserMessage(
        request.documents,
        request.questions
      );

      this.logger.info("Prompts created", {
        sessionId,
        systemPromptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
      });

      // Get LLM config and create client directly
      this.logger.debug("Initializing LLM client", { sessionId });
      const aiConfig = Config.ai;
      const llmConfig = aiConfig.getLLMConfig();

      // Create OpenAI client directly to avoid circular dependency
      const client = new OpenAI({
        apiKey: llmConfig.primary.apiKey,
        baseURL: llmConfig.primary.baseURL,
      });

      this.logger.info("LLM client initialized", {
        sessionId,
        model: llmConfig.primary.model,
        baseURL: llmConfig.primary.baseURL,
      });

      // Use tool-enabled LLM processing
      try {
        this.logger.info("Starting LLM processing with tools", {
          sessionId,
          model: llmConfig.primary.model,
          maxToolLoops: 7,
        });

        const llmStartTime = Date.now();
        const rawResponse = await runWithToolsIfRequested(
          client,
          llmConfig.primary.model,
          systemPrompt,
          userMessage,
          {
            abortSignal: undefined, // We'll use timerContext for timeout handling
            maxToolLoops: 7,
            toolChoice: "auto", // Let the model decide when to use tools
          }
        );

        const llmProcessingTime = Date.now() - llmStartTime;
        this.logger.info("LLM processing completed", {
          sessionId,
          processingTimeMs: llmProcessingTime,
          responseLength: rawResponse.length,
          responsePreview: rawResponse.substring(0, 200) + "...",
        });

        // Check timeout after LLM processing
        if (timerContext.isExpired) {
          this.logger.error("Request timed out during LLM processing", {
            sessionId,
            llmProcessingTimeMs: llmProcessingTime,
            timeRemaining: Math.max(
              0,
              timerContext.timeoutMs - (Date.now() - timerContext.startTime)
            ),
          });
          return {
            success: false,
            error: {
              error: "Request timed out during processing",
              errorType: "timeout",
            },
          };
        }

        loggingService.info("HackRX processing completed", "HackRXService");

        // Parse the response to extract individual answers for each question
        this.logger.info("Parsing LLM response into individual answers", {
          sessionId,
        });
        const answers = this.parseMultipleAnswers(
          rawResponse.trim(),
          request.questions
        );

        const result: HackRXResponse = {
          answers,
          metadata: {
            documents: request.documents,
            processedAt: Date.now(),
            toolsUsed: true,
          },
        };

        const totalProcessingTime = Date.now() - startTime;
        loggingService.info(
          "HackRX processing completed successfully",
          "HackRXService",
          {
            sessionId,
            questionsCount: request.questions.length,
            answersCount: answers.length,
            totalProcessingTimeMs: totalProcessingTime,
            llmProcessingTimeMs: llmProcessingTime,
          }
        );

        this.logger.info("HackRX session completed successfully", {
          sessionId,
          questionsCount: request.questions.length,
          answersCount: answers.length,
          totalProcessingTimeMs: totalProcessingTime,
          llmProcessingTimeMs: llmProcessingTime,
          finalDocuments: request.documents,
        });

        return {
          success: true,
          data: result,
        };
      } catch (llmError: any) {
        const processingTime = Date.now() - startTime;
        this.logger.error("LLM processing error in HackRX", {
          sessionId,
          error: llmError.message,
          stack: llmError.stack,
          processingTimeMs: processingTime,
        });

        loggingService.error(
          "LLM processing error in HackRX",
          "HackRXService",
          {
            sessionId,
            error: llmError.message,
          }
        );

        return {
          success: false,
          error: {
            error: `LLM processing failed: ${llmError.message}`,
            errorType: "llm",
            details: llmError,
          },
        };
      }
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error("Unexpected error in HackRX processing", {
        sessionId,
        error: error.message,
        stack: error.stack,
        processingTimeMs: processingTime,
      });

      loggingService.error(
        "Unexpected error in HackRX processing",
        "HackRXService",
        {
          sessionId,
          error: error.message,
        }
      );

      return {
        success: false,
        error: {
          error: `Unexpected error: ${error.message}`,
          errorType: "unknown",
          details: error,
        },
      };
    }
  }

  // Cleanup method for graceful shutdown
  public async cleanup(): Promise<void> {
    this.logger.info("Starting HackRXService cleanup");

    try {
      await playwrightService.cleanup();
      this.logger.info("PlaywrightService cleanup completed");
    } catch (error) {
      this.logger.error("Error during HackRXService cleanup", { error });
    }

    this.logger.info("HackRXService cleanup completed");
  }
}

export const hackrxService = HackRXService.getInstance();
