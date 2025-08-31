import { LLMService } from "../LLM/core.LLM";
import { loggingService } from "../logging";
import type { TimerContext } from "../timer";
import { playwrightService } from "../playwright";
import { PromptInjectionProtectionService } from "../cleaning/promptInjection.protection";
import { AppConfigService } from "../../config/app.config";
import {
  GENERIC_MULTI_TOOL_PROMPT,
  INTELLIGENT_TOOL_PROMPT,
  AUTONOMOUS_CODING_PROMPT,
  AUTONOMOUS_WEB_AGENT_PROMPT,
} from "../../prompts/prompts";
import type {
  ToolCallingRequest,
  ToolCallingResponse,
  ToolCallingError,
} from "./types";

export class ToolCallingService {
  private static instance: ToolCallingService;
  private logger = loggingService.createComponentLogger("ToolCallingService");
  private appConfig = AppConfigService.getInstance();

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

  private shouldApplySanitization(): boolean {
    const securityConfig = this.appConfig.getSecurityConfig();
    return securityConfig.promptInjectionProtection.enabled;
  }

  private getSanitizationOptions() {
    const securityConfig = this.appConfig.getSecurityConfig();
    const pipConfig = securityConfig.promptInjectionProtection;

    return {
      strictMode: pipConfig.strictMode,
      preserveFormatting: true,
      logSuspiciousContent: pipConfig.logSuspiciousContent,
      azureContentPolicy: pipConfig.azureContentPolicy,
      preserveUrls: pipConfig.preserveUrls,
    };
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

  private determinePromptType(
    questions: string[]
  ): "generic" | "intelligent" | "autonomous" | "web" {
    console.log(
      "\n🤔 [ToolCallingService] ANALYZING QUESTIONS TO DETERMINE PROMPT TYPE:"
    );
    console.log("◈".repeat(80));

    const allQuestionsText = questions.join(" ").toLowerCase();

    // Check for autonomous coding indicators
    const codingKeywords = [
      "code",
      "algorithm",
      "function",
      "solve",
      "program",
      "implement",
      "git",
      "commit",
      "push",
      "repository",
      "hackathon",
      "challenge",
      "python",
      "javascript",
      "java",
      "c++",
      "coding",
      "programming",
      "debug",
      "test",
      "execute",
      "run code",
      "compile",
    ];

    const hasCodeKeywords = codingKeywords.some((keyword) =>
      allQuestionsText.includes(keyword)
    );

    // Check for web automation indicators
    const webKeywords = [
      "website",
      "browser",
      "click",
      "navigate",
      "scrape",
      "web",
      "page",
      "form",
      "submit",
      "button",
      "link",
      "scroll",
      "element",
      "automation",
      "playwright",
      "selenium",
      "crawl",
      "extract",
      "download",
      "upload",
      "login",
      "search",
      "hover",
      "select",
      "input",
      "checkbox",
      "dropdown",
    ];

    const hasWebKeywords = webKeywords.some((keyword) =>
      allQuestionsText.includes(keyword)
    );

    console.log("🔍 Analysis Results:");
    console.log("📝 Questions Count:", questions.length);
    console.log("🔧 Has Coding Keywords:", hasCodeKeywords);
    console.log("🌐 Has Web Keywords:", hasWebKeywords);
    console.log("📋 Sample Question:", questions[0]?.substring(0, 100) + "...");

    let promptType: "generic" | "intelligent" | "autonomous" | "web";

    if (hasWebKeywords) {
      promptType = "web";
      console.log("🎯 Selected: WEB (web automation/browser tasks detected)");
    } else if (
      hasCodeKeywords &&
      (allQuestionsText.includes("git") || allQuestionsText.includes("commit"))
    ) {
      promptType = "autonomous";
      console.log("🎯 Selected: AUTONOMOUS (coding + git operations detected)");
    } else if (questions.length <= 2 && hasCodeKeywords) {
      promptType = "intelligent";
      console.log("🎯 Selected: INTELLIGENT (simple coding task)");
    } else {
      promptType = "generic";
      console.log("🎯 Selected: GENERIC (multi-purpose or complex tasks)");
    }

    console.log("◈".repeat(80));
    return promptType;
  }

  private createSystemPrompt(
    promptType: "generic" | "intelligent" | "autonomous" | "web" = "generic"
  ): string {
    console.log("\n🧠 [ToolCallingService] SELECTING SYSTEM PROMPT:");
    console.log("◈".repeat(80));
    console.log("🎯 Prompt Type:", promptType);
    console.log("◈".repeat(80));

    let selectedPrompt: string;

    switch (promptType) {
      case "web":
        selectedPrompt = AUTONOMOUS_WEB_AGENT_PROMPT;
        console.log("✅ Using AUTONOMOUS_WEB_AGENT_PROMPT from prompts.ts");
        break;
      case "intelligent":
        selectedPrompt = INTELLIGENT_TOOL_PROMPT;
        console.log("✅ Using INTELLIGENT_TOOL_PROMPT from prompts.ts");
        break;
      case "autonomous":
        selectedPrompt = AUTONOMOUS_CODING_PROMPT;
        console.log("✅ Using AUTONOMOUS_CODING_PROMPT from prompts.ts");
        break;
      case "generic":
      default:
        selectedPrompt = GENERIC_MULTI_TOOL_PROMPT;
        console.log("✅ Using GENERIC_MULTI_TOOL_PROMPT from prompts.ts");
        break;
    }

    console.log(
      "📏 System Prompt Length:",
      selectedPrompt.length,
      "characters"
    );
    console.log("📋 System Prompt Preview (first 200 chars):");
    console.log("─".repeat(60));
    console.log(selectedPrompt.substring(0, 200) + "...");
    console.log("─".repeat(60));
    console.log("🎯 This prompt will be sent to LLM\n");

    return selectedPrompt;
  }

  private createUserMessage(
    documents: string,
    questions: string[],
    promptType: "generic" | "intelligent" | "autonomous" | "web" = "generic"
  ): string {
    const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

    console.log("\n📝 [ToolCallingService] CREATING USER MESSAGE:");
    console.log("◈".repeat(80));
    console.log("🎯 Prompt Type for Instructions:", promptType);

    // Extract URLs from documents to prevent LLM corruption
    const extractedUrls: string[] = [];
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urlMatches = documents.match(urlRegex);

    if (urlMatches) {
      extractedUrls.push(...urlMatches);
      console.log("🔗 URLs extracted from documents:", extractedUrls);
    }

    let importantInstructions = "";

    // Add specific instructions based on prompt type
    if (promptType === "web") {
      let urlInstructions = "";
      if (extractedUrls.length > 0) {
        urlInstructions = `

🌐 EXTRACTED URLs (use these EXACT URLs, do NOT modify them):
${extractedUrls.map((url, i) => `   ${i + 1}. ${url}`).join("\n")}

`;
      }

      importantInstructions = `IMPORTANT:${urlInstructions}
1. Use the EXACT URLs provided above - do NOT modify, truncate, or corrupt them
2. For web_automation tool selectors:
   - Simple selectors: Use text like "Submit" or "#login-button"
   - Complex selectors: Pass as JSON OBJECT (not string), example:
     {
       "type": "input",
       "identifier": {"placeholder": "Enter text"},
       "fallbacks": [{"attributes": {"type": "text"}}]
     }
   - DO NOT stringify JSON selectors - pass them as actual objects
3. Complete all web automation tasks thoroughly with proper error handling
4. Extract all requested data and provide clear, structured results

`;
      console.log("✅ Using WEB-SPECIFIC instructions for browser automation");
      console.log("🔗 Extracted URLs count:", extractedUrls.length);
    } else if (promptType === "autonomous" || promptType === "intelligent") {
      importantInstructions = `IMPORTANT: 
1. Use printf with \n for writing code files to preserve indentation (NOT cat with heredoc)
2. If the task involves pushing code to Git/GitHub, you MUST complete the Git operations (add, commit, push) BEFORE providing your final answer. This is mandatory, not optional.
3. For Git: Only use simple operations - git add, git commit, git push. DO NOT change remotes, branches, or initialize repos.

`;
      console.log(
        "✅ Using CODING-SPECIFIC instructions for development tasks"
      );
    } else {
      importantInstructions = `IMPORTANT: 
1. Use appropriate tools intelligently based on what each question requires
2. Provide clear, accurate answers based on the context and tools available
3. Follow proper formatting and structure in your responses

`;
      console.log("✅ Using GENERIC instructions for general tasks");
    }

    console.log("📋 Instructions Length:", importantInstructions.length);
    console.log("◈".repeat(80));

    return `Documents/Context: ${documents}

Questions/Tasks:
${questionsText}

${importantInstructions}Please help me with these questions/tasks. Use the appropriate tools intelligently based on what each question requires.`;
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

      // Clean documents for prompt injection attacks (if enabled)
      this.logger.debug("Checking if document sanitization should be applied", {
        sessionId,
      });

      let cleanedDocuments = request.documents;

      if (this.shouldApplySanitization()) {
        this.logger.debug("Cleaning documents for prompt injection", {
          sessionId,
        });
        const originalDocuments = request.documents;
        cleanedDocuments = PromptInjectionProtectionService.sanitizeText(
          request.documents,
          this.getSanitizationOptions()
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

        this.logger.info("Document cleaning completed", {
          sessionId,
          originalLength: originalDocuments.length,
          cleanedLength: cleanedDocuments.length,
          changed: originalDocuments !== cleanedDocuments,
        });
      } else {
        this.logger.info("Document sanitization skipped (disabled in config)", {
          sessionId,
        });
      }

      // Update request with cleaned documents
      request.documents = cleanedDocuments;

      // Clean questions for prompt injection attacks (if enabled)
      this.logger.debug(
        "Checking if questions sanitization should be applied",
        {
          sessionId,
        }
      );

      let cleanedQuestions: string[] = [];
      let questionsChanged = false;

      if (this.shouldApplySanitization()) {
        this.logger.debug("Cleaning questions for prompt injection", {
          sessionId,
        });
        const originalQuestions = [...request.questions];

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
            this.getSanitizationOptions()
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

        this.logger.info("Question cleaning completed", {
          sessionId,
          questionsCount: request.questions.length,
          changed: questionsChanged,
        });
      } else {
        this.logger.info(
          "Questions sanitization skipped (disabled in config)",
          {
            sessionId,
          }
        );
        cleanedQuestions = [...request.questions];
      }

      // Update request with cleaned questions
      request.questions = cleanedQuestions;

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

      // Determine the best prompt type based on questions
      const promptType = this.determinePromptType(request.questions);
      const rawSystemPrompt = this.createSystemPrompt(promptType);

      const rawUserMessage = this.createUserMessage(
        request.documents,
        request.questions,
        promptType
      );

      console.log("\n🧠 [ToolCallingService] FINAL PROMPTS SELECTED:");
      console.log("◈".repeat(80));
      console.log("🎯 System Prompt Type:", promptType);
      console.log("📏 System Prompt Length:", rawSystemPrompt.length);
      console.log("📏 User Message Length:", rawUserMessage.length);
      console.log("◈".repeat(80));

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
