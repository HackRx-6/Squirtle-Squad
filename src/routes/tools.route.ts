import { Elysia } from "elysia";
import { toolsController } from "../controllers/tools.controller";

export const toolsRoute = (app: Elysia) => {
  // Tools HackRX endpoint
  app.post(
    "/api/v1/tools/hackrx/run",
    ({ request }) => toolsController.runHackRX(request),
    {
      detail: {
        summary: "Run HackRX Tools Processing",
        description:
          "Process image from URL and answer mathematical questions. This endpoint provides tools for image analysis and Q&A capabilities.",
        tags: ["Tools", "HackRX", "Image Processing", "Q&A"],
        body: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL to the image or document to process",
              example:
                "https://hackrx.blob.core.windows.net/assets/Test%20/image.jpeg?sv=2023-01-03&spr=https&st=2025-08-04T19%3A29%3A01Z&se=2026-08-05T19%3A29%3A00Z&sr=b&sp=r&sig=YnJJThygjCT6%2FpNtY1aHJEZ%2F%2BqHoEB59TRGPSxJJBwo%3D",
            },
            questions: {
              type: "array",
              items: {
                type: "string",
              },
              description: "Array of questions to ask about the content",
              example: [
                "What is 100+22?",
                "What is 9+5?",
                "What is 65007+2?",
                "What is 1+1?",
                "What is 5+500?",
              ],
            },
          },
          required: ["url", "questions"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              answers: {
                type: "array",
                items: {
                  type: "string",
                },
                description:
                  "Array of answer strings corresponding to the questions asked",
                example: [
                  "100+22=122.",
                  "9+5=14.",
                  "65007+2=65009.",
                  "1+1=2.",
                  "5+500=505.",
                ],
              },
            },
            required: ["answers"],
          },
          400: {
            type: "object",
            properties: {
              answers: {
                type: "array",
                items: {
                  type: "string",
                },
                description: "Error message in answers array format",
              },
              error_type: {
                type: "string",
                description: "Type of error that occurred",
              },
            },
          },
          401: {
            type: "object",
            properties: {
              answers: {
                type: "array",
                items: {
                  type: "string",
                },
                description: "Authentication error message",
              },
            },
          },
          500: {
            type: "object",
            properties: {
              answers: {
                type: "array",
                items: {
                  type: "string",
                },
                description: "Internal server error message",
              },
              error_type: {
                type: "string",
                example: "internal_error",
              },
            },
          },
        },
      },
    }
  );

  return app;
};
