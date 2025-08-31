import { sentryMonitoringService } from "../monitoring";
import { LLMService } from "../LLM/core.LLM";
import { FANTASTIC_ROBO_SYSTEM_PROMPT } from "../../prompts/prompt_RAG";
import type { TimerContext } from "../timer";

export class ImageQAService {
  private llmService: LLMService;

  constructor() {
    this.llmService = new LLMService();
  }

  /**
   * Answer questions about an image using OCR text (no embeddings)
   * This is optimized for images where we send the OCR text directly to the LLM
   */
  async answerQuestionsWithOCRText(
    questions: string[],
    ocrText: string,
    fileName: string,
    timerContext?: TimerContext
  ): Promise<string[]> {
    if (questions.length === 0) {
      return [];
    }

    console.log(
      `🖼️ Processing ${questions.length} questions about image using OCR text (no embeddings)...`
    );

    return await sentryMonitoringService.track(
      "image_qa_processing",
      "qa_pipeline",
      {
        filename: fileName,
        total_questions: questions.length,
        ocr_text_length: ocrText.length,
        processing_method: "direct_llm_no_embeddings",
      },
      async () => {
        // Create system prompts and user messages for each question
        const systemPrompts = questions.map(() => FANTASTIC_ROBO_SYSTEM_PROMPT);
        const userMessages = questions.map((question) => {
          return `Image: ${fileName}

OCR Extracted Text from Image:
${ocrText}

Question: ${question}

Please answer the question based on the text content extracted from the image above. If the text doesn't contain relevant information to answer the question, please say so clearly.`;
        });

        // Use streaming responses for better performance
        console.log(
          `🌊 Starting streaming Q&A for ${questions.length} image questions with load-balanced LLM...`
        );

        try {
          // Get streaming responses for all questions
          const streamingResponses = await this.llmService
            .generateBatchStreamingResponses!(
            systemPrompts,
            userMessages,
            timerContext
          );

          // Convert streams to text
          const answers = await Promise.all(
            streamingResponses.map(async (stream, index) => {
              try {
                let fullResponse = "";
                const reader = stream.getReader();

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  fullResponse += value;
                }

                // Clean up the response
                const cleanedResponse = fullResponse
                  .replace(/\n+/g, " ")
                  .replace(/\s+/g, " ")
                  .trim();

                console.log(
                  `✅ Image Q&A completed for question ${
                    index + 1
                  }: ${cleanedResponse.substring(0, 100)}...`
                );

                return cleanedResponse;
              } catch (error) {
                console.error(
                  `❌ Error processing streaming response for question ${
                    index + 1
                  }:`,
                  error
                );
                return `Error processing question: ${
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred"
                }`;
              }
            })
          );

          console.log(
            `✅ Successfully processed ${answers.length} image questions using OCR text`
          );

          return answers;
        } catch (error) {
          console.error("❌ Error in image Q&A streaming:", error);

          // Fallback to non-streaming responses if streaming fails
          console.log("🔄 Falling back to non-streaming responses...");

          try {
            const fallbackAnswers = await this.llmService
              .generateBatchResponses!(systemPrompts, userMessages);

            console.log(
              `✅ Fallback successful: processed ${fallbackAnswers.length} image questions`
            );

            return fallbackAnswers;
          } catch (fallbackError) {
            console.error("❌ Fallback also failed:", fallbackError);

            // Return error messages for all questions
            return questions.map(
              (_, index) =>
                `I apologize, but I encountered an error while processing this question about the image. Please try again.`
            );
          }
        }
      },
      {
        component: "image_qa",
        operation: "ocr_based_question_answering",
      }
    );
  }

  /**
   * Get memory usage stats (dummy implementation for consistency with other QA services)
   */
  getMemoryStats() {
    return {
      estimatedMemoryMB: 0, // No vector storage for images
      chunkCount: 1, // OCR text is treated as one "chunk"
    };
  }
}
