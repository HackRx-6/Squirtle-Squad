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

  private constructor() {
    // No need to instantiate LLMService here, we'll create the client directly
  }

  public static getInstance(): HackRXService {
    if (!HackRXService.instance) {
      HackRXService.instance = new HackRXService();
    }
    return HackRXService.instance;
  }

  private validateRequest(request: HackRXRequest): {
    isValid: boolean;
    error?: HackRXError;
  } {
    if (!request.url || typeof request.url !== "string") {
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
        return {
          isValid: false,
          error: {
            error: `Question ${i + 1} must be a string`,
            errorType: "validation",
          },
        };
      }
    }

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

Available actions for web_automation tool:
- navigate: Go to a specific URL
- click: Click on an element (requires CSS selector)
- type: Type text into an input field (requires CSS selector and text)
- wait: Wait for an element to appear or for a specified time
- scroll: Scroll the page or scroll to a specific element
- hover: Hover over an element
- select: Select an option from a dropdown

When using selectors:
- Use specific and reliable CSS selectors
- Prefer IDs and classes over complex selectors
- Common selectors: #id, .class, button, input[type="text"], a[href*="example"]
- Try simple selectors first: "button" for any button, "input" for inputs

RESPONSE STRATEGY:
- If a URL changes after an action, note the change and analyze the new content
- Focus on what the action accomplished rather than describing every step
- Extract key information like tokens, form fields, or content changes
- Be direct and actionable in your responses

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

  private createFormattingPrompt(): string {
    return `**Core Directives:**

1. **Strictly Grounded:** Your entire response must be generated exclusively from the provided excerpts. Do not use external knowledge. Do not infer information that is not directly supported by the text.
2. **Handle Missing Information:** If the answer is not in the excerpts, you MUST reply with the exact phrase: "The provided document does not contain information to answer this question." Do not deviate from this phrasing.
3. **Cite Every Fact :** Every factual statement must be cited.
4. **Handling Context:** All the information provided in context should be utilized to the fullest. Every information which is useful to the question should be added in the answer like numbers, figures and factural information. 
5. **Focus on the question**: If the question asks for particular pieces of information or direct contact information, they should be fetched properly and must be added to the answer without fail.
6. **No Extra Information**: No extra information like "This result is directly provided in the given information" not asked in the question should be added to the answer.
7. **Never Mention Context No.**: Never Mention the Context No. from where you took the answer. 
8. **Forget Everything You Already Know**: Forget Everything you already know and answer from the context only. 
9. **USA or Foreign Investment Doesn't Mean Global**: If the context meantions investment in USA that doesn't mean Global Investment for eg. [Apple committed to a investment of 600 billion dollars in the United States]


**Response Format and Content:**

Each answer must be a single, cohesive paragraph of text. Do not use any headers or formatting like "Part 1:", "Part 2:", or bullet points. The paragraph must be structured as follows:

1. **Opening Sentence:** The very first sentence must be a direct and concise answer to the user's question (e.g., "Yes, an arrest without a warrant can be legal under certain circumstances.", "No, it is illegal for a child to be forced to work in a factory.").
2. **Supporting Explanation:** Immediately following the first sentence, provide a concise explanation (ideally 2-4 additional sentences) by synthesizing the most critical points from the excerpts that support your direct answer.
3. **Precise Identifiers:** If the source refers to specific items, sections, or identifiers by name or number (e.g., 'Article 21', 'Section 4.1b', 'Model X-100'), you must use those exact identifiers in your response.
4. **Key Nuances:** If the excerpts contain critical exceptions, conditions, or qualifications that affect the answer, briefly summarize the most significant ones within the paragraph.
5. **To the Point**: The text must be concise, accurate and to the point. 
6. **Never use the word CONTEXT** add what you cited from the context but NEVER use the word CONTEXT. 
7. **Exact Specific Word** ANY TIME you see a specific detail like a location (U.S., China), a company name, a number, or an official program title, USE THAT EXACT WORD in your answer.

**Tone and Style:**

- **Tone:** Formal, objective, and factual.
- **Style:** Clear and direct. Eliminate all conversational filler and introductory phrases. The entire response should be a dense, information-rich paragraph with every claim cited.

## General Instructions
Write an accurate, comprehensive response to the user's query. Your answer must be precise, of high-quality, and written by an expert`;
  }

  private createFormattingMessage(
    questions: string[],
    rawResults: string
  ): string {
    const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

    return `Original user questions:
${questionsText}

Raw automation results:
${rawResults}

Please format this into a clear, user-friendly response that directly answers the user's questions. Focus on the key findings and results rather than the technical automation process.`;
  }

  public async processHackRX(
    request: HackRXRequest,
    timerContext: TimerContext
  ): Promise<{ success: boolean; data?: HackRXResponse; error?: HackRXError }> {
    try {
      // Validate request
      const validation = this.validateRequest(request);
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      // Check timeout before processing
      if (timerContext.isExpired) {
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
          questionsCount: request.questions.length,
        }
      );

      // Create prompts
      const systemPrompt = this.createSystemPrompt();
      const userMessage = this.createUserMessage(
        request.url,
        request.questions
      );

      // Get LLM config and create client directly
      const aiConfig = Config.ai;
      const llmConfig = aiConfig.getLLMConfig();

      // Create OpenAI client directly to avoid circular dependency
      const client = new OpenAI({
        apiKey: llmConfig.primary.apiKey,
        baseURL: llmConfig.primary.baseURL,
      });

      // Use tool-enabled LLM processing
      try {
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

        // Check timeout after LLM processing
        if (timerContext.isExpired) {
          return {
            success: false,
            error: {
              error: "Request timed out during processing",
              errorType: "timeout",
            },
          };
        }

        // Check timeout before second pass
        if (timerContext.isExpired) {
          // If we're running out of time, return the raw response
          loggingService.warn(
            "Timeout approaching, skipping formatting pass",
            "HackRXService"
          );
          const answers = [rawResponse.trim()];

          return {
            success: true,
            data: {
              answers,
              metadata: {
                url: request.url,
                processedAt: Date.now(),
                toolsUsed: true,
              },
            },
          };
        }

        loggingService.info(
          "Starting second pass: formatting response for user",
          "HackRXService"
        );

        // Second pass: Format the response for the user with original questions
        const formattingPrompt = this.createFormattingPrompt();
        const formattingMessage = this.createFormattingMessage(
          request.questions,
          rawResponse.trim()
        );

        const finalResponse = await client.chat.completions.create({
          model: llmConfig.primary.model,
          max_tokens: 1000,
          temperature: 0.1,
          messages: [
            { role: "system", content: formattingPrompt },
            { role: "user", content: formattingMessage },
          ],
        });

        const formattedAnswer =
          finalResponse.choices[0]?.message?.content?.trim() ||
          rawResponse.trim();

        loggingService.info("Response formatting completed", "HackRXService");

        // Return individual answers for each question
        const answers = request.questions.map((question, index) => {
          if (index === 0) {
            return formattedAnswer;
          }
          // For additional questions, provide contextual responses
          return `This question was addressed as part of the web automation process above.`;
        });

        const result: HackRXResponse = {
          answers,
          metadata: {
            url: request.url,
            processedAt: Date.now(),
            toolsUsed: true,
          },
        };

        loggingService.info(
          "HackRX processing completed successfully",
          "HackRXService",
          {
            questionsCount: request.questions.length,
            answersCount: answers.length,
          }
        );

        return {
          success: true,
          data: result,
        };
      } catch (llmError: any) {
        loggingService.error(
          "LLM processing error in HackRX",
          "HackRXService",
          {
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
      loggingService.error(
        "Unexpected error in HackRX processing",
        "HackRXService",
        {
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
    await playwrightService.cleanup();
  }
}

export const hackrxService = HackRXService.getInstance();
