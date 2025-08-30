import type OpenAI from "openai";
import { AppConfigService } from "../../config/app.config";
import { playwrightService } from "../playwright";
import { terminalService } from "../terminal";

type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;
type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

/**
 * Simple session tracker for web automation sessions
 */
class WebAutomationSessionTracker {
  private static instance: WebAutomationSessionTracker;
  private currentSessionId: string | null = null;
  private sessionStartTime: number = 0;
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  public static getInstance(): WebAutomationSessionTracker {
    if (!WebAutomationSessionTracker.instance) {
      WebAutomationSessionTracker.instance = new WebAutomationSessionTracker();
    }
    return WebAutomationSessionTracker.instance;
  }

  public getOrCreateSessionId(): string {
    const now = Date.now();

    // Check if current session is still valid
    if (
      this.currentSessionId &&
      now - this.sessionStartTime < this.SESSION_TIMEOUT_MS
    ) {
      console.log(
        `🎭 [SessionTracker] Reusing session: ${this.currentSessionId}`
      );
      return this.currentSessionId;
    }

    // Create new session
    this.currentSessionId = `llm_persistent_${now}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    this.sessionStartTime = now;

    console.log(
      `🎭 [SessionTracker] Created new session: ${this.currentSessionId}`
    );
    return this.currentSessionId;
  }

  public invalidateSession(): void {
    if (this.currentSessionId) {
      console.log(
        `🎭 [SessionTracker] Invalidating session: ${this.currentSessionId}`
      );
      this.currentSessionId = null;
      this.sessionStartTime = 0;
    }
  }
}

/**
 * Determines the appropriate tool choice strategy based on configuration and context
 */
export const getRecommendedToolChoice = (
  forceToolUse?: boolean,
  specificTool?: string
): ToolChoice => {
  const qa = AppConfigService.getInstance().getQAConfig();

  if (!qa.toolCalls?.enabled) return "none";
  if (specificTool)
    return { type: "function", function: { name: specificTool } };
  if (forceToolUse) return "required";

  return "auto"; // Default: let the model decide
};

const previewString = (value: unknown, maxLen = 400): string => {
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
  } catch {
    return "<unserializable>";
  }
};

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

export const executeToolCall = async (
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  options?: { abortSignal?: AbortSignal }
): Promise<string> => {
  // Type guard to ensure we have a function tool call
  if (toolCall.type !== "function" || !toolCall.function) {
    throw new Error(`Unsupported tool call type: ${toolCall.type}`);
  }

  const { name, arguments: rawArgs } = toolCall.function;
  try {
    const args = rawArgs ? JSON.parse(rawArgs) : {};
    console.log(`🛠️ [ToolCall:start] name=${name} args=${previewString(args)}`);
    switch (name) {
      case "http_get_json_batch": {
        const { urls, headers } = args as {
          urls: string[];
          headers?: Record<string, string>;
        };
        if (!Array.isArray(urls) || urls.length === 0) {
          return JSON.stringify({
            ok: false,
            error: "No urls provided",
          });
        }
        const qa = AppConfigService.getInstance().getQAConfig();
        const timeoutMs = qa.toolCalls?.advanced?.timeoutMs || 8000;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const out: any[] = [];
          for (const url of urls) {
            try {
              assertSafeUrl(url);
              const res = await fetch(url, {
                method: "GET",
                headers,
                signal: options?.abortSignal || controller.signal,
              });
              const contentType = res.headers.get("content-type") || "";
              let body: any = null;
              try {
                body = await res.json();
              } catch {
                const text = await res.text();
                body = {
                  _nonJsonTextPreview: text.substring(0, 8000),
                };
              }
              out.push({
                ok: res.ok,
                status: res.status,
                contentType,
                url,
                body,
              });
            } catch (e) {
              out.push({
                ok: false,
                status: 0,
                url,
                body: {
                  error: e instanceof Error ? e.message : String(e),
                },
              });
            }
          }
          return JSON.stringify({ ok: true, results: out });
        } finally {
          clearTimeout(timeout);
        }
      }
      case "web_automation": {
        const { url, actions, options } = args as {
          url: string;
          actions: Array<{
            type:
              | "click"
              | "type"
              | "wait"
              | "scroll"
              | "navigate"
              | "select"
              | "hover"
              | "fill_form"
              | "submit_form"
              | "find_and_fill";
            selector?: string;
            text?: string;
            url?: string;
            timeout?: number;
            formData?: Record<string, string>;
            submitSelector?: string;
          }>;
          options?: {
            headless?: boolean;
            timeout?: number;
            waitForNetworkIdle?: boolean;
            includeContent?: boolean;
            useEnhancedExtraction?: boolean;
            enhancedExtractionOptions?: {
              includeHTML?: boolean;
              includeInteractiveElements?: boolean;
              maxContentSize?: number;
              htmlCleaningOptions?: {
                includeImportantJS?: boolean;
                preserveCSS?: boolean;
                includeDataAttributes?: boolean;
                includeAriaAttributes?: boolean;
                maxScriptSize?: number;
                includeEventHandlers?: boolean;
              };
            };
          };
        };

        if (!url || !actions || !Array.isArray(actions)) {
          return JSON.stringify({
            ok: false,
            error: "Invalid arguments: provide url and actions array",
          });
        }

        try {
          console.log(
            `🎭 [WebAutomation] Starting persistent automation for ${url}`
          );

          // Get or create a persistent session ID
          const sessionTracker = WebAutomationSessionTracker.getInstance();
          const sessionId = sessionTracker.getOrCreateSessionId();

          const result = await playwrightService.executeWebAutomationPersistent(
            {
              url,
              actions,
              options: {
                headless: options?.headless ?? true,
                timeout: options?.timeout || 15000, // Reduced from 30000ms to 15000ms
                waitForNetworkIdle: options?.waitForNetworkIdle ?? false,
                includeContent: options?.includeContent ?? true,
                useEnhancedExtraction: options?.useEnhancedExtraction ?? true, // Enable intelligent extraction by default
                enhancedExtractionOptions: {
                  includeHTML: true,
                  includeInteractiveElements: true,
                  maxContentSize: 4000, // Even more aggressive - 4KB limit for LLM consumption
                  htmlCleaningOptions: {
                    includeImportantJS: false,
                    preserveCSS: false,
                    includeDataAttributes: true, // Keep data attributes for challenges
                    includeAriaAttributes: false,
                    includeEventHandlers: false,
                  },
                  ...options?.enhancedExtractionOptions, // Allow override
                },
              },
            },
            sessionId
          );

          if (!result.success) {
            return JSON.stringify({
              ok: false,
              error: result.error || "Web automation failed",
            });
          }

          // Console log what content is being returned to the LLM
          const responseData = {
            ok: true,
            url: result.url,
            pageContent: result.pageContent,
            metadata: result.metadata,
          };

          const responseString = JSON.stringify(responseData);

          console.log("\n🎭 [WebAutomation] SENDING TO LLM:");
          console.log("=".repeat(80));
          console.log("🌐 RESULT URL:", result.url);
          console.log(
            "📄 PAGE CONTENT LENGTH:",
            result.pageContent?.length || 0,
            "characters"
          );
          console.log(
            "🔍 CONTENT TYPE:",
            options?.useEnhancedExtraction ? "Enhanced HTML" : "Basic Text"
          );

          if (result.pageContent) {
            console.log("\n📋 PAGE CONTENT PREVIEW:");
            console.log("-".repeat(40));
            const preview = result.pageContent.substring(0, 800);
            console.log(preview);
          }

          console.log("\n📊 METADATA:");
          console.log("-".repeat(40));
          console.log(JSON.stringify(result.metadata, null, 2));

          console.log("\n📐 RESPONSE SIZE:");
          console.log("-".repeat(40));
          console.log(`Total Response: ${responseString.length} characters`);
          console.log(
            `Page Content: ${result.pageContent?.length || 0} characters`
          );
          console.log("=".repeat(80));

          return responseString;
        } catch (error: any) {
          console.error(`❌ [WebAutomation] Error:`, error);

          // Invalidate session on persistent web automation errors
          const sessionTracker = WebAutomationSessionTracker.getInstance();
          sessionTracker.invalidateSession();

          return JSON.stringify({
            ok: false,
            error: error.message || "Unknown web automation error",
          });
        }
      }
      case "execute_terminal_command": {
        const { command, options = {} } = args as {
          command?: string;
          options?: {
            timeout?: number;
            workingDirectory?: string;
            environment?: Record<string, string>;
            shell?: string;
            maxOutputSize?: number;
            fileUrl?: string;
            runtime?: "auto" | "node" | "python" | "bash" | "deno" | "bun";
          };
        };

        // Validate that either command or fileUrl is provided
        if (!command && !options.fileUrl) {
          return JSON.stringify({
            ok: false,
            error: "Either 'command' or 'options.fileUrl' must be provided",
          });
        }

        if (command && typeof command !== "string") {
          return JSON.stringify({
            ok: false,
            error: "Invalid command: must be a string",
          });
        }

        try {
          if (options.fileUrl) {
            console.log(
              `🖥️ [TerminalTool] Executing file from URL: ${options.fileUrl}`
            );
          } else {
            console.log(`🖥️ [TerminalTool] Executing command: ${command}`);
          }

          const result = await terminalService.executeCommand(command || "", {
            timeout: options.timeout,
            workingDirectory: options.workingDirectory,
            environment: options.environment,
            shell: options.shell,
            maxOutputSize: options.maxOutputSize,
            fileUrl: options.fileUrl,
            runtime: options.runtime,
          });

          console.log(
            `🖥️ [TerminalTool] Command completed - Success: ${result.success}, Exit Code: ${result.exitCode}`
          );
          console.log(
            `🖥️ [TerminalTool] Execution time: ${result.executionTime}ms`
          );
          console.log(
            `🖥️ [TerminalTool] Output length: ${result.stdout.length} chars`
          );

          return JSON.stringify({
            ok: result.success,
            result: {
              success: result.success,
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
              command: result.command,
              workingDirectory: result.workingDirectory,
              executionTime: result.executionTime,
              timedOut: result.timedOut,
              error: result.error,
            },
          });
        } catch (error: any) {
          console.error(`❌ [TerminalTool] Error executing command:`, error);
          return JSON.stringify({
            ok: false,
            error: error.message || "Failed to execute terminal command",
          });
        }
      }
      default:
        console.warn(
          `⚠️ [ToolCall:unknown] name=${name} args=${previewString(rawArgs)}`
        );
        return JSON.stringify({
          ok: false,
          error: `Unknown tool: ${name}`,
        });
    }
  } catch (e) {
    console.error(
      `❌ [ToolCall:error] name=${name} args=${previewString(rawArgs)} error=${
        e instanceof Error ? e.message : String(e)
      }`
    );
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};

export const runWithToolsIfRequested = async (
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: {
    abortSignal?: AbortSignal;
    maxToolLoops?: number;
    toolChoice?:
      | "auto"
      | "none"
      | "required"
      | { type: "function"; function: { name: string } };
    isAzure?: boolean;
  }
): Promise<string> => {
  const qa = AppConfigService.getInstance().getQAConfig();
  const tools = getOpenAIToolsSchemas();
  const toolEnabled = qa.toolCalls?.enabled && tools.length > 0;

  // Build the initial messages
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  // If tools are disabled or no tools available, do a simple call
  if (!toolEnabled) {
    console.log(`🧰 Tools disabled or unavailable. Making direct LLM call.`);

    // Create request options - exclude reasoning_effort for Azure
    const requestOptions: any = {
      model,
      messages,
    };

    // Only add reasoning_effort for non-Azure clients
    if (!options?.isAzure) {
      requestOptions.reasoning_effort = "low";
    }

    const resp = await client.chat.completions.create(requestOptions, {
      signal: options?.abortSignal,
    });
    const content = resp.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("No response content from LLM");
    return content;
  }

  console.log(
    `🧰 Tool-calling enabled. Available tools: [${tools
      .map((t) => (t.type === "function" ? t.function?.name : t.type))
      .join(", ")}]`
  );

  // Determine tool choice strategy
  const toolChoice = options?.toolChoice || "auto";
  const maxLoops = options?.maxToolLoops ?? 6; // Increased for better tool usage

  // Main conversation loop with tool support
  for (let iteration = 0; iteration < maxLoops; iteration++) {
    console.log(`🔁 Tool loop iteration ${iteration + 1}/${maxLoops}`);

    // Create request options - exclude reasoning_effort for Azure
    const requestOptions: any = {
      model,
      messages,
      tools,
      tool_choice: toolChoice,
    };

    // Only add reasoning_effort for non-Azure clients
    if (!options?.isAzure) {
      requestOptions.reasoning_effort = "low";
    }

    const response = await client.chat.completions.create(requestOptions, {
      signal: options?.abortSignal,
    });

    const choice = response.choices[0];
    const assistantMessage = choice?.message;
    const toolCalls = assistantMessage?.tool_calls || [];

    // If no tool calls, the assistant has provided a final answer
    if (!toolCalls.length) {
      console.log(`🧠 Assistant provided final response without tool calls.`);
      const content = assistantMessage?.content?.trim();
      if (content) return content;

      // Edge case: empty response without tool calls
      console.warn(
        "⚠️ Assistant returned empty content. Making fallback call."
      );

      // Create fallback request options - exclude reasoning_effort for Azure
      const fallbackRequestOptions: any = {
        model,
        messages: [
          ...messages,
          {
            role: "system",
            content:
              "Provide a clear, direct answer. Do not return empty content.",
          },
        ],
      };

      // Only add reasoning_effort for non-Azure clients
      if (!options?.isAzure) {
        fallbackRequestOptions.reasoning_effort = "low";
      }

      const fallbackResp = await client.chat.completions.create(
        fallbackRequestOptions,
        {
          signal: options?.abortSignal,
        }
      );
      const fallbackContent = fallbackResp.choices[0]?.message?.content?.trim();
      return fallbackContent || "Unable to generate a response.";
    }

    console.log(`🧠 Assistant requested ${toolCalls.length} tool call(s).`);

    // Add the assistant's message with tool calls to the conversation
    messages.push({
      role: "assistant",
      content: assistantMessage?.content || null,
      tool_calls: toolCalls,
    });

    // Execute tool calls - OpenAI supports parallel execution
    const toolResults = await Promise.allSettled(
      toolCalls.map(async (toolCall) => {
        // Type guard to ensure we have a function tool call
        if (toolCall.type !== "function" || !toolCall.function) {
          return {
            toolCallId: toolCall.id,
            content: `Unsupported tool call type: ${toolCall.type}`,
            success: false,
          };
        }

        const toolName = toolCall.function.name;
        let parsedArgs: any;

        try {
          parsedArgs = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch {
          parsedArgs = toolCall.function.arguments || {};
        }

        console.log(
          `🚀 Executing tool '${toolName}' with args: ${previewString(
            parsedArgs
          )}`
        );

        try {
          const result = await executeToolCall(toolCall, {
            abortSignal: options?.abortSignal,
          });
          console.log(
            `📥 Tool '${toolName}' completed: ${previewString(result)}`
          );
          return {
            toolCallId: toolCall.id,
            content: result,
            success: true,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.error(`❌ Tool '${toolName}' failed:`, errorMsg);
          return {
            toolCallId: toolCall.id,
            content: `Tool execution failed: ${errorMsg}`,
            success: false,
          };
        }
      })
    );

    // Add tool results to the conversation
    toolResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        messages.push({
          role: "tool",
          tool_call_id: result.value.toolCallId,
          content: result.value.content,
        });
      } else {
        // Handle Promise rejection
        const toolCall = toolCalls[index];
        if (toolCall) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Tool execution failed: ${result.reason}`,
          });
        }
      }
    });

    // After first iteration, let the model decide whether to use more tools
    // This prevents infinite tool calling loops
    if (iteration > 0 && toolChoice === "required") {
      // Switch from required to auto after first iteration to allow completion
      console.log(
        `🔄 Switching from 'required' to 'auto' tool choice after first iteration`
      );
    }
  }

  // If we've exhausted the loop, make a final call without tools to get an answer
  console.log(
    `⏰ Tool loop limit reached. Making final call without tool requirements.`
  );

  // Create final request options - exclude reasoning_effort for Azure
  const finalRequestOptions: any = {
    model,
    messages,
    // No tools or tool_choice to force a text response
  };

  // Only add reasoning_effort for non-Azure clients
  if (!options?.isAzure) {
    finalRequestOptions.reasoning_effort = "low";
  }

  const finalResponse = await client.chat.completions.create(
    finalRequestOptions,
    {
      signal: options?.abortSignal,
    }
  );

  const finalContent = finalResponse.choices[0]?.message?.content?.trim();
  return (
    finalContent ||
    "Unable to generate a complete response within the tool execution limit."
  );
};

// Local URL safety check mirroring webScrapingService
const assertSafeUrl = (url: string): void => {
  const qa = AppConfigService.getInstance().getQAConfig();
  const denied = qa.toolCalls?.advanced?.deniedDomains || [];
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (denied.some((d: string) => host === d || host.endsWith(`.${d}`))) {
      throw new Error("Denied host");
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error("Invalid scheme");
  } catch (e) {
    throw new Error(`Unsafe URL: ${url}`);
  }
};

// Heuristics: check city in common keys or anywhere in stringified JSON if keys not provided
const doesBodyMatchCity = (
  body: any,
  cityLower: string,
  matchKeys?: string[]
): boolean => {
  if (!body || !cityLower) return false;
  const keys =
    matchKeys && matchKeys.length > 0
      ? matchKeys
      : ["city", "ticket.city", "result.city", "data.city", "metadata.city"];
  for (const key of keys) {
    const val = getDeep(body, key);
    if (typeof val === "string" && val.toLowerCase().includes(cityLower)) {
      return true;
    }
  }
  // Fallback: search in full JSON text if small
  try {
    const s = JSON.stringify(body).toLowerCase();
    if (s.length <= 50000 && s.includes(cityLower)) return true;
  } catch {}
  return false;
};

const extractFlightNumber = (body: any): string | number | null => {
  if (!body) return null;
  const candidates = [
    getDeep(body, "flightNumber"),
    getDeep(body, "flight_number"),
    getDeep(body, "result.flightNumber"),
    getDeep(body, "data.flightNumber"),
    getDeep(body, "ticket.flightNumber"),
    getDeep(body, "ticket.flight_number"),
  ];
  for (const c of candidates) {
    if (typeof c === "string" || typeof c === "number") return c;
  }
  return null;
};

const getDeep = (obj: any, path: string): any => {
  try {
    return path
      .split(".")
      .reduce((acc, key) => (acc ? acc[key] : undefined), obj);
  } catch {
    return undefined;
  }
};
