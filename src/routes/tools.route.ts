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

  // Web Scraping Q&A endpoint
  app.post(
    "/api/v1/tools/web-qa",
    ({ request }) => toolsController.runWebQA(request),
    {
      detail: {
        summary: "Web Scraping Q&A",
        description:
          "Scrape a website, extract clean text content, and answer questions about it using LLM. This endpoint fetches HTML from a URL, removes unnecessary tags, and processes the content with AI.",
        tags: ["Tools", "Web Scraping", "Q&A", "LLM"],
        body: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL of the website to scrape and analyze",
              example: "https://example.com/article",
            },
            questions: {
              type: "array",
              items: {
                type: "string",
              },
              description:
                "Array of questions to ask about the website content",
              example: [
                "What is the main topic of this article?",
                "Who is the author?",
                "What are the key points discussed?",
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
                  "Array of answers corresponding to the questions asked",
              },
              metadata: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                  scrapedAt: { type: "string" },
                  textLength: { type: "number" },
                  status: { type: "number" },
                },
                description: "Metadata about the scraped content",
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
