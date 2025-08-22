import { AppConfigService } from "../../config/app.config";
import { LLMService } from "../LLM/core.LLM";
import { coreWebScrapingService } from "./coreWebScraping.webScraping";
import { PromptInjectionProtectionService } from "../cleaning";
import { loggingService } from "../logging";
import type { TimerContext } from "../timer";

export interface WebQARequest {
  url: string;
  questions: string[];
}

export interface WebQAResponse {
  answers: string[];
  metadata: {
    url: string;
    title?: string;
    scrapedAt: string;
    textLength: number;
    status: number;
  };
}

export interface WebQAError {
  error: string;
  errorType: "validation" | "scraping" | "llm" | "timeout" | "unknown";
  details?: any;
}

export class WebQAService {
  private static instance: WebQAService;
  private configService: AppConfigService;
  private llmService: LLMService;
  private logger: ReturnType<typeof loggingService.createComponentLogger>;

  private constructor() {
    this.configService = AppConfigService.getInstance();
    this.llmService = new LLMService();
    this.logger = loggingService.createComponentLogger("WebQAService");
  }

  public static getInstance(): WebQAService {
    if (!WebQAService.instance) {
      WebQAService.instance = new WebQAService();
    }
    return WebQAService.instance;
  }

  /**
   * Validate the incoming request for web Q&A
   */
  public validateRequest(request: any): {
    isValid: boolean;
    error?: WebQAError;
  } {
    try {
      // Basic structure validation
      if (!request || typeof request !== "object") {
        return {
          isValid: false,
          error: {
            error: "Invalid request body. Expected JSON object.",
            errorType: "validation",
          },
        };
      }

      const { url, questions } = request;

      // URL validation
      if (!url) {
        return {
          isValid: false,
          error: {
            error: "Missing required field: url",
            errorType: "validation",
          },
        };
      }

      if (typeof url !== "string") {
        return {
          isValid: false,
          error: {
            error: "URL must be a string",
            errorType: "validation",
          },
        };
      }

      // Questions validation
      if (!questions || !Array.isArray(questions)) {
        return {
          isValid: false,
          error: {
            error: "Missing required field: questions (must be an array)",
            errorType: "validation",
          },
        };
      }

      if (questions.length === 0) {
        return {
          isValid: false,
          error: {
            error: "Questions array cannot be empty",
            errorType: "validation",
          },
        };
      }

      // Validate each question
      for (let i = 0; i < questions.length; i++) {
        if (typeof questions[i] !== "string") {
          return {
            isValid: false,
            error: {
              error: `Question ${i + 1} must be a string`,
              errorType: "validation",
            },
          };
        }
      }

      // Check for prompt injection
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const riskAssessment =
          PromptInjectionProtectionService.calculateRiskScore(question);
        if (
          riskAssessment.risk === "high" ||
          riskAssessment.risk === "critical"
        ) {
          return {
            isValid: false,
            error: {
              error: `Potential prompt injection detected in question ${i + 1}`,
              errorType: "validation",
              details: { riskScore: riskAssessment.score, question },
            },
          };
        }
      }

      return { isValid: true };
    } catch (error: any) {
      this.logger.error("Validation error", { error: error.message });
      return {
        isValid: false,
        error: {
          error: "Validation failed due to unexpected error",
          errorType: "validation",
          details: error.message,
        },
      };
    }
  }

  /**
   * Scrape website content and extract clean text
   */
  public async scrapeWebsite(
    url: string,
    timerContext: TimerContext
  ): Promise<{ success: boolean; data?: any; error?: WebQAError }> {
    try {
      this.logger.info(`Starting web scraping for URL: ${url}`);

      const scrapedContent = await coreWebScrapingService.fetchText(
        url,
        timerContext.abortController.signal
      );

      this.logger.info(`Scraped content`, {
        status: scrapedContent.status,
        textLength: scrapedContent.text.length,
        title: scrapedContent.title,
      });

      // Check if scraping was successful
      if (scrapedContent.status !== 200 || !scrapedContent.text.trim()) {
        return {
          success: false,
          error: {
            error: `Failed to scrape website. Status: ${
              scrapedContent.status
            }. ${
              scrapedContent.text.trim()
                ? "Content was empty after processing."
                : "No content found."
            }`,
            errorType: "scraping",
            details: {
              status: scrapedContent.status,
              contentType: scrapedContent.contentType,
              textLength: scrapedContent.text.length,
            },
          },
        };
      }

      return {
        success: true,
        data: scrapedContent,
      };
    } catch (error: any) {
      this.logger.error("Web scraping error", { error: error.message, url });
      return {
        success: false,
        error: {
          error: `Web scraping failed: ${error.message}`,
          errorType: "scraping",
          details: error,
        },
      };
    }
  }

  /**
   * Process questions using LLM with scraped content
   */
  public async processQuestions(
    questions: string[],
    scrapedContent: any,
    timerContext: TimerContext
  ): Promise<{ success: boolean; answers?: string[]; error?: WebQAError }> {
    try {
      this.logger.info(`Processing ${questions.length} questions with LLM`);

      const answers: string[] = [];

      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];

        // Check timer before each question
        if (timerContext.isExpired) {
          this.logger.warn(
            `Request timed out while processing question ${i + 1}`
          );
          answers.push("Request timed out while processing this question.");
          continue;
        }

        try {
          this.logger.debug(`Processing question ${i + 1}: ${question}`);

          const prompt = this.createPrompt(question || "", scrapedContent);
          const response = await this.llmService.generateResponse(
            "You are a helpful assistant that answers questions based on provided website content. Always base your answers on the given content and be clear when information is not available.",
            prompt
          );

          const answer = (response || "").trim() || "No answer generated.";
          answers.push(answer);

          this.logger.debug(`Question ${i + 1} answered successfully`);
        } catch (error: any) {
          this.logger.error(`Error processing question ${i + 1}`, {
            error: error.message,
            question,
          });
          answers.push(
            `Error processing this question: ${
              error.message || "Unknown error"
            }`
          );
        }
      }

      return {
        success: true,
        answers,
      };
    } catch (error: any) {
      this.logger.error("LLM processing error", { error: error.message });
      return {
        success: false,
        error: {
          error: `LLM processing failed: ${error.message}`,
          errorType: "llm",
          details: error,
        },
      };
    }
  }

  /**
   * Create a focused prompt for the LLM
   */
  private createPrompt(question: string, scrapedContent: any): string {
    return `Based on the following website content, please answer the question concisely and accurately.

Website URL: ${scrapedContent.url}
Website Title: ${scrapedContent.title || "No title found"}

Content:
${scrapedContent.text}

Question: ${question}

Please provide a clear and direct answer based only on the information available in the website content. If the answer cannot be found in the content, please state that clearly.`;
  }

  /**
   * Main method to process web Q&A request
   */
  public async processWebQA(
    request: WebQARequest,
    timerContext: TimerContext
  ): Promise<{ success: boolean; data?: WebQAResponse; error?: WebQAError }> {
    try {
      // Validate request
      const validation = this.validateRequest(request);
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      // Check timeout before scraping
      if (timerContext.isExpired) {
        return {
          success: false,
          error: {
            error: "Request timed out before processing could begin",
            errorType: "timeout",
          },
        };
      }

      // Scrape website
      const scrapingResult = await this.scrapeWebsite(
        request.url,
        timerContext
      );
      if (!scrapingResult.success) {
        return {
          success: false,
          error: scrapingResult.error,
        };
      }

      // Check timeout before LLM processing
      if (timerContext.isExpired) {
        return {
          success: false,
          error: {
            error: "Request timed out after scraping",
            errorType: "timeout",
          },
        };
      }

      // Process questions
      const questionsResult = await this.processQuestions(
        request.questions,
        scrapingResult.data,
        timerContext
      );

      if (!questionsResult.success) {
        return {
          success: false,
          error: questionsResult.error,
        };
      }

      // Build response
      const response: WebQAResponse = {
        answers: questionsResult.answers!,
        metadata: {
          url: scrapingResult.data.url,
          title: scrapingResult.data.title,
          scrapedAt: scrapingResult.data.fetchedAt,
          textLength: scrapingResult.data.text.length,
          status: scrapingResult.data.status,
        },
      };

      this.logger.info("Web Q&A processing completed successfully", {
        questionsCount: request.questions.length,
        answersCount: response.answers.length,
        textLength: response.metadata.textLength,
      });

      return {
        success: true,
        data: response,
      };
    } catch (error: any) {
      this.logger.error("Unexpected error in web Q&A processing", {
        error: error.message,
      });
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
}

export const webQAService = WebQAService.getInstance();
