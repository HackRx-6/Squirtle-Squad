import { runWithToolsIfRequested } from "../LLM/tools.LLM";
import { Config } from "../../config";
import { loggingService } from "../logging";
import type { TimerContext } from "../timer";
import { playwrightService } from "./playwright.service";
import OpenAI from "openai";

export interface HackRXRequest {
  url: string;
  questions: string[];
}

export interface HackRXResponse {
  answers: string[];
  metadata?: {
    url?: string;
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
      url: request.url,
      questionsCount: request.questions?.length || 0,
    });

    if (!request.url || typeof request.url !== "string") {
      this.logger.warn("Validation failed: Invalid URL provided", {
        url: request.url,
        urlType: typeof request.url,
      });
      return {
        isValid: false,
        error: {
          error: "Invalid URL provided",
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
      url: request.url,
      questionsCount: request.questions.length,
    });

    return { isValid: true };
  }

  private createSystemPrompt(): string {
    return `You are an intelligent web automation assistant. Your job is to help users interact with websites and answer questions about them.

When a user asks you to perform actions on a website (like clicking buttons, filling forms, navigating, etc.), you should use the web_automation tool efficiently:

IMPORTANT GUIDELINES:
1. Focus exclusively on page content - no visual analysis
2. When URLs change after actions, the new page content is automatically captured
3. Analyze structured page content including text, buttons, links, and forms
4. Be concise in your responses - focus on what changed and what was accomplished
5. Extract key information like tokens, form data, or navigation results
6. **HANDLE MULTIPLE QUESTIONS**: When given multiple questions, address each one specifically and provide distinct answers

Available actions for web_automation tool:
- navigate: Go to a specific URL
- click: Click on an element (requires CSS selector)
- type: Type text into an input field (requires CSS selector and text)
- wait: Wait for an element to appear or for a specified time
- scroll: Scroll the page or scroll to a specific element
- hover: Hover over an element
- select: Select an option from a dropdown
- fill_form: Fill multiple form fields at once (requires formData object with selector:value pairs)
- submit_form: Submit a form by clicking submit button (optional submitSelector)
- find_and_fill: Intelligently find and fill input fields (tries multiple selector strategies)

Form Interaction Examples:
- To fill a single input: use "type" action with selector and text
- To fill multiple inputs: use "fill_form" with formData: {"#email": "user@example.com", "#password": "secret"}
- To submit: use "submit_form" (automatically finds submit buttons) or "click" with specific button selector
- To find inputs by name/placeholder: use "find_and_fill" with partial names (e.g., "email" will find input[name*="email"])

When using selectors:
- Use specific and reliable CSS selectors
- Prefer IDs and classes over complex selectors
- Common selectors: #id, .class, button, input[type="text"], a[href*="example"]
- Try simple selectors first: "button" for any button, "input" for inputs

RESPONSE FORMATTING REQUIREMENTS:
- Format your final response to provide a separate, clear answer for each question
- Use this exact format: "ANSWER 1: [Direct answer]", "ANSWER 2: [Direct answer]", etc.
- Each answer should be concise, factual, and directly address the specific question
- Focus on key findings and results rather than technical automation steps
- Never mention tool calls or automation processes in your answers
- Be precise and to the point with specific details like numbers, names, and locations

Always provide clear, helpful answers based on the actual page content you receive from the automation tool.
If an action fails, explain what went wrong and suggest alternatives.`;
  }

  private createUserMessage(url: string, questions: string[]): string {
    const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

    return `Website URL: ${url}

Please help me with these questions/tasks:
${questionsText}

For each question that involves interacting with the website, use the web_automation tool to perform the necessary actions and then provide answers based on the results.`;
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
      url: request.url,
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
        `Starting HackRX processing for ${request.url}`,
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
        request.url,
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

        // Console log what we're sending to the LLM
        console.log("\n🤖 [HackRX] SENDING TO LLM:");
        console.log("=".repeat(80));
        console.log("📋 SYSTEM PROMPT:");
        console.log("-".repeat(40));
        console.log(systemPrompt.substring(0, 500));
        console.log("\n💬 USER MESSAGE:");
        console.log("-".repeat(40));
        console.log(userMessage);
        console.log("\n🔧 CONFIG:");
        console.log("-".repeat(40));
        console.log(`Model: ${llmConfig.primary.model}`);
        console.log(`Max Tool Loops: 7`);
        console.log(`Tool Choice: auto`);
        console.log("=".repeat(80));

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

        // Console log the response from LLM
        console.log("\n🤖 [HackRX] RECEIVED FROM LLM:");
        console.log("=".repeat(80));
        console.log("📝 RAW RESPONSE:");
        console.log("-".repeat(40));
        console.log(rawResponse.substring(0, 1000));
        console.log("\n📊 RESPONSE STATS:");
        console.log("-".repeat(40));
        console.log(`Processing Time: ${llmProcessingTime}ms`);
        console.log(`Response Length: ${rawResponse.length} characters`);
        console.log("=".repeat(80));

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
            url: request.url,
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
          finalUrl: request.url,
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
