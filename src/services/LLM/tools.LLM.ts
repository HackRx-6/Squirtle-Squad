import type OpenAI from "openai";
import { AppConfigService } from "../../config/app.config";
import { playwrightService } from "../webAutomation";

type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;
type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

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
          "Perform HTTP GET to multiple JSON API endpoints and return parsed JSON for each Call this when a city has multiple different landmarks present.",
        parameters: {
          type: "object",
          properties: {
            urls: {
              type: "array",
              items: { type: "string" },
              description: "List of absolute URLs to fetch (http/https).",
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
        name: "resolve_flight_number",
        description:
          "Given a city and a list of candidate flight-number API endpoints, call each endpoint, verify the response corresponds to the specified city, and return the best-matching flight number. If none match, return a fallback from any response.",
        parameters: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description:
                "Target city to validate against API responses (case-insensitive)",
            },
            endpoints: {
              type: "array",
              items: { type: "string" },
              description:
                "List of absolute URLs to query for flight number candidates",
            },
            headers: {
              type: "object",
              description: "Optional HTTP headers to include for all requests",
              additionalProperties: { type: "string" },
            },
            matchKeys: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional list of JSON keys to prioritize when checking for city name (e.g., ['city','ticket.city'])",
            },
          },
          required: ["city", "endpoints"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_automation",
        description:
          "Perform web browser automation tasks like clicking buttons, filling forms, and navigating pages. Use this when you need to interact with web pages programmatically. Returns structured page content including text, buttons, links, and forms.",
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
                    ],
                    description: "The type of action to perform",
                  },
                  selector: {
                    type: "string",
                    description:
                      "CSS selector for the element (required for click, type, hover, select actions)",
                  },
                  text: {
                    type: "string",
                    description:
                      "Text to type or option to select (required for type and select actions)",
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
              },
            },
          },
          required: ["url", "actions"],
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
  const { name, arguments: rawArgs } = toolCall.function;
  try {
    const args = rawArgs ? JSON.parse(rawArgs) : {};
    const startedAt = Date.now();
    console.log(`🛠️ [ToolCall:start] name=${name} args=${previewString(args)}`);
    switch (name) {
      case "resolve_flight_number": {
        const { city, endpoints, headers, matchKeys } = args as {
          city: string;
          endpoints: string[];
          headers?: Record<string, string>;
          matchKeys?: string[];
        };
        const cityLower = (city || "").trim().toLowerCase();
        if (!cityLower || !Array.isArray(endpoints) || endpoints.length === 0) {
          return JSON.stringify({
            ok: false,
            error: "Invalid arguments: provide city and endpoints[]",
          });
        }

        const qa = AppConfigService.getInstance().getQAConfig();
        const timeoutMs = qa.toolCalls?.advanced?.timeoutMs || 8000;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const results: Array<{
          url: string;
          ok: boolean;
          status: number;
          body: any;
          matched: boolean;
          candidateFlight?: string | number | null;
        }> = [];
        try {
          for (const url of endpoints) {
            assertSafeUrl(url);
            try {
              const res = await fetch(url, {
                method: "GET",
                headers,
                signal: controller.signal,
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

              const matched = doesBodyMatchCity(body, cityLower, matchKeys);
              const candidateFlight = extractFlightNumber(body);
              results.push({
                url,
                ok: res.ok,
                status: res.status,
                body,
                matched,
                candidateFlight,
              });
            } catch (e) {
              results.push({
                url,
                ok: false,
                status: 0,
                body: {
                  error: e instanceof Error ? e.message : String(e),
                },
                matched: false,
                candidateFlight: null,
              });
            }
          }

          // Prefer first matched; else fallback to first successful; else any
          const matched = results.find(
            (r) => r.ok && r.matched && r.candidateFlight
          );
          const successful = results.find((r) => r.ok && r.candidateFlight);
          const fallback = results[0];

          const selected = matched || successful || fallback;
          return JSON.stringify({
            ok: !!selected?.ok,
            selectedUrl: selected?.url,
            matched: !!selected?.matched,
            candidateFlight: selected?.candidateFlight ?? null,
            tried: results.map((r) => ({
              url: r.url,
              ok: r.ok,
              status: r.status,
              matched: r.matched,
              candidateFlight: r.candidateFlight ?? null,
            })),
          });
        } finally {
          clearTimeout(timeout);
        }
      }
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
              | "hover";
            selector?: string;
            text?: string;
            url?: string;
            timeout?: number;
          }>;
          options?: {
            headless?: boolean;
            timeout?: number;
            waitForNetworkIdle?: boolean;
            includeContent?: boolean;
          };
        };

        if (!url || !actions || !Array.isArray(actions)) {
          return JSON.stringify({
            ok: false,
            error: "Invalid arguments: provide url and actions array",
          });
        }

        try {
          console.log(`🎭 [WebAutomation] Starting automation for ${url}`);
          const result = await playwrightService.executeWebAutomation({
            url,
            actions,
            options: {
              headless: options?.headless ?? true,
              timeout: options?.timeout || 30000,
              waitForNetworkIdle: options?.waitForNetworkIdle ?? false,
              includeContent: options?.includeContent ?? true,
            },
          });

          if (!result.success) {
            return JSON.stringify({
              ok: false,
              error: result.error || "Web automation failed",
            });
          }

          return JSON.stringify({
            ok: true,
            url: result.url,
            pageContent: result.pageContent,
            metadata: result.metadata,
          });
        } catch (error: any) {
          console.error(`❌ [WebAutomation] Error:`, error);
          return JSON.stringify({
            ok: false,
            error: error.message || "Unknown web automation error",
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
    const resp = await client.chat.completions.create(
      {
        model,

        messages,
      },
      {
        signal: options?.abortSignal,
      }
    );
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
  const maxLoops = options?.maxToolLoops ?? 5; // Reduced from 6 as per OpenAI recommendations

  // Main conversation loop with tool support
  for (let iteration = 0; iteration < maxLoops; iteration++) {
    console.log(`🔁 Tool loop iteration ${iteration + 1}/${maxLoops}`);

    const response = await client.chat.completions.create(
      {
        model,

        messages,
        tools,
        tool_choice: toolChoice,
      },
      {
        signal: options?.abortSignal,
      }
    );

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
      const fallbackResp = await client.chat.completions.create(
        {
          model,

          messages: [
            ...messages,
            {
              role: "system",
              content:
                "Provide a clear, direct answer. Do not return empty content.",
            },
          ],
        },
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
        const toolName = toolCall.function?.name;
        let parsedArgs: any;

        try {
          parsedArgs = toolCall.function?.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch {
          parsedArgs = toolCall.function?.arguments || {};
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
  const finalResponse = await client.chat.completions.create(
    {
      model,

      messages,

      // No tools or tool_choice to force a text response
    },
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
