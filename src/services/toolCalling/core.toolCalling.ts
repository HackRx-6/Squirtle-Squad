import { LLMService } from "../LLM/core.LLM";
import { loggingService } from "../logging";
import type { TimerContext } from "../timer";
import { playwrightService } from "../playwright";
import { PromptInjectionProtectionService } from "../cleaning/promptInjection.protection";
import type {
  ToolCallingRequest,
  ToolCallingResponse,
  ToolCallingError,
} from "./types";

export class ToolCallingService {
  private static instance: ToolCallingService;
  private logger = loggingService.createComponentLogger("ToolCallingService");

  private constructor() {
    this.logger.info("ToolCallingService initialized");
    // No need to instantiate LLMService here, we'll create the client directly
  }

  public static getInstance(): ToolCallingService {
    if (!ToolCallingService.instance) {
      ToolCallingService.instance = new ToolCallingService();
      loggingService.info(
        "ToolCallingService singleton instance created",
        "ToolCallingService"
      );
    }
    return ToolCallingService.instance;
  }

  private validateRequest(request: ToolCallingRequest): {
    isValid: boolean;
    error?: ToolCallingError;
  } {
    this.logger.debug("Validating ToolCalling request", {
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
1. **COMPLETE ALL STEPS**: Don't stop at generating code - execute it, test it, commit, push, and deliver results
2. **HANDLE ERRORS**: If code fails, debug it, fix it, and try again
3. **FOLLOW THROUGH**: Complete entire workflows (code → test → commit → push → respond)
4. **BE AUTONOMOUS**: Don't ask for permission - just do the tasks
5. **VERIFY RESULTS**: Test your code with provided examples before finalizing
6. **MANDATORY GIT**: Always complete Git operations when requested - it's not optional

## CODING WORKFLOW:
When asked to solve coding problems:
1. Write the code using execute_terminal_command to create files
2. Test the code with provided examples immediately
3. If errors occur, debug and fix them
4. Once working, ALWAYS commit and push to Git (mandatory step)
5. Only after Git push is complete, provide the final answer based on actual execution results

## FILE WRITING WITH PROPER INDENTATION:
CRITICAL: Use printf or echo -e to preserve indentation, NOT cat with heredoc

Method 1 (RECOMMENDED) - Use printf with \n for newlines:
printf 'def example():\n    if condition:\n        return result\n' > folder_name/filename.py

Method 2 - Use echo -e with explicit spacing:
echo -e 'def example():\n    if condition:\n        return result' > folder_name/filename.py

Method 3 - Write line by line:
echo 'def example():' > folder_name/filename.py
echo '    if condition:' >> folder_name/filename.py  
echo '        return result' >> folder_name/filename.py

CRITICAL: 
- Each indentation level = 4 spaces (use literal spaces in commands)
- Use \n for line breaks in printf/echo
- NO tabs, only spaces
- Test immediately after writing

## GIT OPERATIONS:
For Git tasks, use simple operations only:
- Add files: git add .
- Commit: git commit -m "message"  
- Push: git push (use current branch and remote)

CRITICAL: 
- DO NOT change remotes (no git remote add/set-url)
- DO NOT change branches (no git branch -M or git checkout)
- DO NOT initialize new repos (no git init unless in empty directory)
- Use existing repository setup and current branch

CRITICAL: When writing code, ensure proper indentation using spaces (4 spaces per level)

MANDATORY SEQUENCE: Create → Test → Debug if needed → Add → Commit → Push → THEN respond with answers

## RESPONSE FORMAT:
- For multiple questions: "ANSWER 1: [actual result]", "ANSWER 2: [actual result]"
- Provide ONLY the final computed results
- Don't show code unless specifically asked
- Don't explain the process - just deliver results

CRITICAL: Execute every step completely. Test code immediately. Fix errors. Complete Git operations BEFORE responding. Git push is MANDATORY when requested. Provide actual results only after Git operations are complete.`;
  }

  private createUserMessage(documents: string, questions: string[]): string {
    const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

    return `Documents/Context: ${documents}

Questions/Tasks:
${questionsText}

IMPORTANT: 
1. Use printf with \n for writing code files to preserve indentation (NOT cat with heredoc)
2. If the task involves pushing code to Git/GitHub, you MUST complete the Git operations (add, commit, push) BEFORE providing your final answer. This is mandatory, not optional.
3. For Git: Only use simple operations - git add, git commit, git push. DO NOT change remotes, branches, or initialize repos.

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

  public async processToolCalling(
    request: ToolCallingRequest,
    timerContext: TimerContext
  ): Promise<{
    success: boolean;
    data?: ToolCallingResponse;
    error?: ToolCallingError;
  }> {
    const sessionId = `toolCalling_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const startTime = Date.now();

    this.logger.info("Starting toolCalling processing session", {
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

      // Clean documents for prompt injection attacks
      this.logger.debug("Cleaning documents for prompt injection", {
        sessionId,
      });
      const originalDocuments = request.documents;
      const cleanedDocuments = PromptInjectionProtectionService.sanitizeText(
        request.documents,
        {
          strictMode: true,
          preserveFormatting: true,
          logSuspiciousContent: true,
          azureContentPolicy: true,
          preserveUrls: true,
        }
      );

      // Check if any malicious content was detected and cleaned
      if (originalDocuments !== cleanedDocuments) {
        this.logger.warn(
          "Potential prompt injection detected and cleaned in documents",
          {
            sessionId,
            originalLength: originalDocuments.length,
            cleanedLength: cleanedDocuments.length,
            documentsPreview: originalDocuments.substring(0, 200) + "...",
          }
        );

        loggingService.warn(
          "Prompt injection patterns detected and cleaned from documents",
          "ToolCallingService",
          {
            sessionId,
            originalLength: originalDocuments.length,
            cleanedLength: cleanedDocuments.length,
          }
        );
      }

      // Update request with cleaned documents
      request.documents = cleanedDocuments;

      this.logger.info("Document cleaning completed", {
        sessionId,
        originalLength: originalDocuments.length,
        cleanedLength: cleanedDocuments.length,
        changed: originalDocuments !== cleanedDocuments,
      });

      // Clean questions for prompt injection attacks
      this.logger.debug("Cleaning questions for prompt injection", {
        sessionId,
      });
      const originalQuestions = [...request.questions];
      const cleanedQuestions: string[] = [];
      let questionsChanged = false;

      for (let i = 0; i < request.questions.length; i++) {
        const originalQuestion = request.questions[i];
        if (typeof originalQuestion !== "string") {
          this.logger.error(
            `Question ${i + 1} is not a string during cleaning`,
            {
              sessionId,
              questionIndex: i + 1,
              questionType: typeof originalQuestion,
            }
          );
          continue;
        }

        const cleanedQuestion = PromptInjectionProtectionService.sanitizeText(
          originalQuestion,
          {
            strictMode: true,
            preserveFormatting: true,
            logSuspiciousContent: true,
            azureContentPolicy: true,
            preserveUrls: true,
          }
        );

        cleanedQuestions.push(cleanedQuestion);

        if (originalQuestion !== cleanedQuestion) {
          questionsChanged = true;
          this.logger.warn(
            `Potential prompt injection detected and cleaned in question ${
              i + 1
            }`,
            {
              sessionId,
              questionIndex: i + 1,
              originalLength: originalQuestion.length,
              cleanedLength: cleanedQuestion.length,
              questionPreview: originalQuestion.substring(0, 100) + "...",
            }
          );
        }
      }

      if (questionsChanged) {
        this.logger.warn(
          "Prompt injection patterns detected and cleaned from questions",
          {
            sessionId,
            questionsCount: request.questions.length,
            originalQuestions: originalQuestions.map(
              (q) => q.substring(0, 50) + "..."
            ),
            cleanedQuestions: cleanedQuestions.map(
              (q) => q.substring(0, 50) + "..."
            ),
          }
        );

        loggingService.warn(
          "Prompt injection patterns detected and cleaned from questions",
          "ToolCallingService",
          {
            sessionId,
            questionsCount: request.questions.length,
          }
        );
      }

      // Update request with cleaned questions
      request.questions = cleanedQuestions;

      this.logger.info("Question cleaning completed", {
        sessionId,
        questionsCount: request.questions.length,
        changed: questionsChanged,
      });

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
        `Starting toolCalling processing for ${request.documents}`,
        "ToolCallingService",
        {
          sessionId,
          questionsCount: request.questions.length,
        }
      );

      // Create prompts
      this.logger.debug("Creating prompts for LLM", { sessionId });
      const rawSystemPrompt = this.createSystemPrompt();
      const rawUserMessage = this.createUserMessage(
        request.documents,
        request.questions
      );

      // Clean prompts using prompt injection protection
      this.logger.debug("Cleaning prompts for security", { sessionId });

      const systemPrompt = rawSystemPrompt;

      const userMessage = rawUserMessage;

      this.logger.info("Prompts created and cleaned", {
        sessionId,
        systemPromptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        cleaningApplied: true,
      });

      // Initialize LLM service that properly handles Azure/OpenAI configurations
      this.logger.debug("Initializing LLM service", { sessionId });
      const llmService = new LLMService();

      this.logger.info("LLM service initialized", {
        sessionId,
      });

      // Use tool-enabled LLM processing
      try {
        this.logger.info("Starting LLM processing with tools", {
          sessionId,
          maxToolLoops: 10,
        });

        const llmStartTime = Date.now();

        // Use LLMService's generateResponse which handles Azure/OpenAI properly
        // and internally uses runWithToolsIfRequested with proper client configuration
        const rawResponse = await llmService.generateResponse(
          systemPrompt,
          userMessage
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

        loggingService.info(
          "Tool Calling processing completed",
          "ToolCallingService"
        );

        // Parse the response to extract individual answers for each question
        this.logger.info("Parsing LLM response into individual answers", {
          sessionId,
        });
        const answers = this.parseMultipleAnswers(
          rawResponse.trim(),
          request.questions
        );

        const result: ToolCallingResponse = {
          answers,
          metadata: {
            documents: request.documents,
            processedAt: Date.now(),
            toolsUsed: true,
          },
        };

        const totalProcessingTime = Date.now() - startTime;
        loggingService.info(
          "Tool Calling processing completed successfully",
          "ToolCallingService",
          {
            sessionId,
            questionsCount: request.questions.length,
            answersCount: answers.length,
            totalProcessingTimeMs: totalProcessingTime,
            llmProcessingTimeMs: llmProcessingTime,
          }
        );

        this.logger.info("Tool Calling session completed successfully", {
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
        this.logger.error("LLM processing error is Tool Calling", {
          sessionId,
          error: llmError.message,
          stack: llmError.stack,
          processingTimeMs: processingTime,
        });

        loggingService.error(
          "LLM processing error in Tool Calling",
          "ToolCallingService",
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
      this.logger.error("Unexpected error in Tool Calling processing", {
        sessionId,
        error: error.message,
        stack: error.stack,
        processingTimeMs: processingTime,
      });

      loggingService.error(
        "Unexpected error in Tool Calling processing",
        "ToolCallingService",
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
    this.logger.info("Starting ToolCallingService cleanup");

    try {
      await playwrightService.cleanup();
      this.logger.info("PlaywrightService cleanup completed");
    } catch (error) {
      this.logger.error("Error during ToolCallingService cleanup", { error });
    }

    this.logger.info("ToolCallingService cleanup completed");
  }
}

export const toolCallingService = ToolCallingService.getInstance();
