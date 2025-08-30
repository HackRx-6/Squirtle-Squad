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
          "Perform web browser automation tasks like clicking buttons, filling forms, and navigating pages. Uses persistent browser sessions - the browser and page state will be maintained across multiple tool calls within the same conversation (5-minute timeout). Returns full page content without character limits. Use this when you need to interact with web pages programmatically.\n\nIMPORTANT FOR CHALLENGE WEBSITES: Many challenge sites only show input fields AFTER clicking 'Start Challenge' or similar buttons. Always start the challenge first before looking for input fields.\n\nText-based clicking examples: Use 'click' with selectors like '>> text=Start Challenge', 'button:has-text(\"Start\")', or '[role=\"button\"]'.\n\nSmart input filling: Use 'type' action which includes intelligent element finding. It will try multiple strategies to find inputs by placeholder, label, name, etc. Example: {type: 'type', selector: 'username', text: 'myuser'} will find username input field intelligently.",
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
                      "find_element",
                      "get_text",
                      "get_attribute",
                      "set_checkbox",
                      "select_option",
                      "scroll_to_element",
                      "wait_for_element",
                    ],
                    description:
                      "The type of action to perform. Use 'type' for filling inputs (it includes intelligent element finding). For text-based clicking, use 'click' with selectors like '>> text=Start Challenge' or 'button:has-text(\"Start\")'.",
                  },
                  selector: {
                    type: "string",
                    description:
                      "CSS selector for the element (required for most actions except wait). Use intelligent selectors like '>> text=Start Challenge', 'button:has-text(\"Start\")', '[data-testid=\"submit\"]', or '#input-field'. The 'type' action includes smart element finding if exact selector fails.",
                  },
                  text: {
                    type: "string",
                    description:
                      "Text to type, option to select, or search criteria (required for type, select actions)",
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
                  optionValue: {
                    type: "string",
                    description:
                      "Option value or text to select (for select_option action)",
                  },
                  checked: {
                    type: "boolean",
                    description:
                      "Checkbox state - true to check, false to uncheck (for set_checkbox action)",
                  },
                  attributeName: {
                    type: "string",
                    description:
                      "Name of the attribute to retrieve (for get_attribute action)",
                  },
                  waitState: {
                    type: "string",
                    enum: ["attached", "detached", "visible", "hidden"],
                    description:
                      "State to wait for (for wait_for_element action, default: visible)",
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
