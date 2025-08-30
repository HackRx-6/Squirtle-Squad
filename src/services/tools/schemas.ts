import { AppConfigService } from "../../config";
import type { OpenAITool } from "./types";

export const getOpenAIToolsSchemas = (): OpenAITool[] => {
  const qa = AppConfigService.getInstance().getQAConfig();

  // Simple boolean check - if tools are disabled, return empty array
  if (!qa.toolCalls?.enabled) {
    return [];
  }

  const tools: OpenAITool[] = [
    {
      type: "function",
      function: {
        name: "http_get_json_batch",
        description:
          "Perform HTTP GET to endpoints, fetch answers from them, and get whatever info you need from an API and return parsed JSON whenever fetch request is needed",
        parameters: {
          type: "object",
          properties: {
            urls: {
              type: "array",
              items: { type: "string" },
              description: "List of URLs to fetch (http/https).",
            },
            headers: {
              type: "object",
              description: "Optional HTTP headers to include",
              additionalProperties: { type: "string" },
            },
          },
          required: ["urls"],
        },
      },
    },

    {
      type: "function",
      function: {
        name: "web_automation",
        description:
          "Perform web browser automation tasks like clicking buttons, filling forms, and navigating pages. Uses persistent browser sessions - the browser and page state will be maintained across multiple tool calls within the same conversation (5-minute timeout). Returns full page content without character limits. Use this when you need to interact with web pages programmatically.\n\nIMPORTANT FOR CHALLENGE WEBSITES: Many challenge sites only show input fields AFTER clicking 'Start Challenge' or similar buttons. Always start the challenge first before looking for input fields.\n\nText-based clicking examples: Use >> text=Start Challenge or button containing 'Start' text.\n\nSpecial action 'find_and_fill': Intelligently finds input fields and fills them. Requires 'text' parameter, 'selector' is optional. Example: {type: 'find_and_fill', text: 'secret_code'} will find the first available input and fill it. NOTE: Input fields must exist on the page - if you get 'no input found' errors, you may need to click 'Start Challenge' or wait for dynamic content to load first.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to navigate to initially",
            },
            actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: [
                      "click",
                      "type",
                      "wait",
                      "scroll",
                      "navigate",
                      "select",
                      "hover",
                      "fill_form",
                      "submit_form",
                      "find_and_fill",
                    ],
                    description:
                      "The type of action to perform. 'find_and_fill' automatically finds inputs and fills them - only requires 'text' parameter, 'selector' is optional. IMPORTANT: Input fields must exist on the page before using find_and_fill. For challenge websites, click 'Start Challenge' first.",
                  },
                  selector: {
                    type: "string",
                    description:
                      "CSS selector for the element (required for click, type, hover, select actions; optional for find_and_fill which can auto-detect inputs). For text-based clicking, use >> text=content or [role='button'] or button selectors.",
                  },
                  text: {
                    type: "string",
                    description:
                      "Text to type or option to select (required for type, select, and find_and_fill actions)",
                  },
                  url: {
                    type: "string",
                    description:
                      "URL to navigate to (required for navigate action)",
                  },
                  timeout: {
                    type: "number",
                    description: "Timeout in milliseconds for this action",
                  },
                  formData: {
                    type: "object",
                    description:
                      "Key-value pairs of CSS selector to input value for fill_form action",
                  },
                  submitSelector: {
                    type: "string",
                    description:
                      "CSS selector for submit button (optional for submit_form action)",
                  },
                },
                required: ["type"],
              },
              description: "List of actions to perform in sequence",
            },
            options: {
              type: "object",
              properties: {
                headless: {
                  type: "boolean",
                  description:
                    "Whether to run browser in headless mode (default: true)",
                },
                timeout: {
                  type: "number",
                  description: "Overall timeout in milliseconds",
                },
                waitForNetworkIdle: {
                  type: "boolean",
                  description: "Wait for network to be idle before proceeding",
                },
                includeContent: {
                  type: "boolean",
                  description:
                    "Include page content in response (default: true)",
                },
                useEnhancedExtraction: {
                  type: "boolean",
                  description:
                    "Use enhanced HTML extraction with structure preservation and smart JavaScript filtering (default: false)",
                },
                enhancedExtractionOptions: {
                  type: "object",
                  description: "Options for enhanced content extraction",
                  properties: {
                    includeHTML: {
                      type: "boolean",
                      description:
                        "Include cleaned HTML structure (default: true)",
                    },
                    includeInteractiveElements: {
                      type: "boolean",
                      description:
                        "Include detailed form, button, and link information (default: true)",
                    },
                    maxContentSize: {
                      type: "number",
                      description:
                        "Maximum size of content in characters (default: 50000)",
                    },
                    htmlCleaningOptions: {
                      type: "object",
                      description: "Fine-grained control over HTML cleaning",
                      properties: {
                        includeImportantJS: {
                          type: "boolean",
                          description:
                            "Include JavaScript with important operations like API calls (default: true)",
                        },
                        preserveCSS: {
                          type: "boolean",
                          description:
                            "Preserve CSS styling information (default: false)",
                        },
                        includeDataAttributes: {
                          type: "boolean",
                          description:
                            "Include data-* attributes (default: true)",
                        },
                        includeAriaAttributes: {
                          type: "boolean",
                          description:
                            "Include ARIA accessibility attributes (default: true)",
                        },
                        maxScriptSize: {
                          type: "number",
                          description:
                            "Maximum size of individual JavaScript blocks to include (default: 1500)",
                        },
                        includeEventHandlers: {
                          type: "boolean",
                          description:
                            "Include inline event handlers like onclick (default: false)",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          required: ["url", "actions"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "execute_terminal_command",
        description:
          "Execute a terminal command or download and run code files from URLs. Use this when you need to: 1) Run system commands, check file contents, install packages, run scripts, or perform terminal operations, 2) Download and execute code files from URLs (supports .js, .py, .ts, .sh files with automatic runtime detection). The execution is secure with timeout controls and output limits.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The terminal command to execute (e.g., 'ls -la', 'npm install', 'cat file.txt'). Not required when using fileUrl.",
            },
            options: {
              type: "object",
              description: "Optional execution parameters",
              properties: {
                timeout: {
                  type: "number",
                  description: "Timeout in milliseconds (default: 30000)",
                },
                workingDirectory: {
                  type: "string",
                  description: "Working directory for command execution",
                },
                environment: {
                  type: "object",
                  description: "Environment variables to set",
                  additionalProperties: { type: "string" },
                },
                shell: {
                  type: "string",
                  description:
                    "Shell to use for execution (default: system default)",
                },
                maxOutputSize: {
                  type: "number",
                  description: "Maximum output size in bytes (default: 1MB)",
                },
                fileUrl: {
                  type: "string",
                  description:
                    "URL to download and execute a code file (supports .js, .py, .ts, .sh files)",
                },
                runtime: {
                  type: "string",
                  enum: ["auto", "node", "python", "bash", "deno", "bun"],
                  description:
                    "Runtime to use for file execution (default: auto-detect from file extension)",
                },
              },
            },
          },
          required: [],
        },
      },
    },
  ];
  return tools;
};
