import { Elysia } from "elysia";
import { toolsController } from "../controllers/tools.controller";

export const toolsRoute = (app: Elysia) => {
  // COMPREHENSIVE DEBUG ENDPOINT
  app.get("/api/v1/debug/environment", () => {
    console.log("🔍 DEBUG ENDPOINT CALLED - Checking environment variables...");
    
    try {
      const envVars = {
        // All LLM variables
        LLM_API_KEY: process.env.LLM_API_KEY,
        LLM_BASE_URL: process.env.LLM_BASE_URL,
        LLM_MODEL: process.env.LLM_MODEL,
        LLM_SERVICE: process.env.LLM_SERVICE,
        LLM_DEPLOYMENT_NAME: process.env.LLM_DEPLOYMENT_NAME,
        LLM_API_VERSION: process.env.LLM_API_VERSION,
        
        // Secondary LLM
        LLM_API_KEY_2: process.env.LLM_API_KEY_2,
        LLM_BASE_URL_2: process.env.LLM_BASE_URL_2,
        LLM_MODEL_2: process.env.LLM_MODEL_2,
        
        // Embeddings
        EMBEDDINGS_MODEL_API_KEY: process.env.EMBEDDINGS_MODEL_API_KEY,
        EMBEDDINGS_MODEL_ENDPOINT: process.env.EMBEDDINGS_MODEL_ENDPOINT,
        EMBEDDINGS_MODEL_DEPLOYMENT_NAME: process.env.EMBEDDINGS_MODEL_DEPLOYMENT_NAME,
        
        // Other
        HACKRX_AUTH_TOKEN: process.env.HACKRX_AUTH_TOKEN,
        MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
        NODE_ENV: process.env.NODE_ENV,
      };

      console.log("🔍 FULL ENV DUMP:");
      Object.entries(envVars).forEach(([key, value]) => {
        if (key.includes("KEY") || key.includes("TOKEN")) {
          console.log(`   ${key}: ${value ? `[SET - ${value.length} chars - starts: ${value.substring(0, 10)}...]` : "[NOT SET]"}`);
        } else {
          console.log(`   ${key}: "${value || "NOT SET"}"`);
        }
      });

      return {
        success: true,
        message: "Environment variables checked - see logs for details",
        summary: {
          LLM_API_KEY: envVars.LLM_API_KEY ? `SET (${envVars.LLM_API_KEY.length} chars)` : "NOT SET",
          LLM_BASE_URL: envVars.LLM_BASE_URL || "NOT SET",
          LLM_MODEL: envVars.LLM_MODEL || "NOT SET",
          EMBEDDINGS_API_KEY: envVars.EMBEDDINGS_MODEL_API_KEY ? `SET (${envVars.EMBEDDINGS_MODEL_API_KEY.length} chars)` : "NOT SET",
          EMBEDDINGS_ENDPOINT: envVars.EMBEDDINGS_MODEL_ENDPOINT || "NOT SET",
          total_env_vars: Object.keys(process.env).length,
          checked_at: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error("🔍 DEBUG ENDPOINT ERROR:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  });

  // TEST HACKRX API ENDPOINT
  app.get("/api/v1/debug/test-hackrx-api", async () => {
    console.log("🧪 TESTING HACKRX API DIRECTLY...");
    
    try {
      const apiKey = process.env.LLM_API_KEY;
      const baseURL = process.env.LLM_BASE_URL;
      
      console.log(`🧪 Using API Key: ${apiKey ? `[SET - ${apiKey.length} chars]` : "[NOT SET]"}`);
      console.log(`🧪 Using Base URL: "${baseURL || "NOT SET"}"`);
      
      if (!apiKey || !baseURL) {
        return {
          success: false,
          error: "Missing API key or base URL",
          details: { hasApiKey: !!apiKey, hasBaseURL: !!baseURL }
        };
      }

      // Test the HackRX API directly
      const fullURL = `${baseURL}/v1/chat/completions`;
      console.log(`🧪 Making request to: ${fullURL}`);
      
      const response = await fetch(fullURL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || "gpt-5-mini",
          messages: [{ role: "user", content: "Hello test" }]
        })
      });

      console.log(`🧪 Response Status: ${response.status}`);
      console.log(`🧪 Response Headers:`, Object.fromEntries(response.headers.entries()));

      let responseData;
      try {
        responseData = await response.text();
        console.log(`🧪 Response Body: ${responseData}`);
      } catch (e) {
        console.log(`🧪 Could not read response body: ${e}`);
      }

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        response: responseData,
        url: fullURL,
        headers: Object.fromEntries(response.headers.entries())
      };

    } catch (error) {
      console.error("🧪 TEST API ERROR:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined
      };
    }
  });

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

  // Enhanced Web Scraping Q&A endpoint with advanced HTML cleaning
  app.post(
    "/api/v1/tools/enhanced-web-qa",
    ({ request }) => toolsController.runEnhancedWebQA(request),
    {
      detail: {
        summary: "Enhanced Web Scraping Q&A with Advanced HTML Cleaning",
        description:
          "Scrape a website with advanced HTML cleaning strategies to minimize tokens, extract optimized text content, and answer questions using LLM. This endpoint provides multiple cleaning strategies (aggressive, balanced, conservative) and detailed token reduction metrics.",
        tags: ["Tools", "Web Scraping", "Q&A", "LLM", "Token Optimization"],
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
            cleaningOptions: {
              type: "object",
              description: "Advanced HTML cleaning options",
              properties: {
                cleaningStrategy: {
                  type: "string",
                  enum: ["aggressive", "balanced", "conservative"],
                  description:
                    "Cleaning strategy: aggressive (max token reduction), balanced (good balance), conservative (preserve structure)",
                  example: "balanced",
                },
                preserveStructure: {
                  type: "boolean",
                  description:
                    "Whether to preserve text structure and formatting",
                  example: true,
                },
                includeTables: {
                  type: "boolean",
                  description:
                    "Whether to include table content in extracted text",
                  example: false,
                },
                includeLinks: {
                  type: "boolean",
                  description:
                    "Whether to preserve important links in the text",
                  example: false,
                },
                maxContentLength: {
                  type: "number",
                  description: "Maximum length of cleaned content (characters)",
                  example: 10000,
                },
              },
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
              tokenOptimization: {
                type: "object",
                properties: {
                  originalLength: { type: "number" },
                  cleanedLength: { type: "number" },
                  reductionPercent: { type: "string" },
                  estimatedTokensSaved: { type: "number" },
                  cleaningStrategy: { type: "string" },
                },
                description: "Token optimization and cleaning statistics",
              },
            },
            required: ["answers", "metadata", "tokenOptimization"],
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
