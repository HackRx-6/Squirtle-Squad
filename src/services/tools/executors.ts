import type OpenAI from "openai";
import { AppConfigService } from "../../config";
import { playwrightService } from "../playwright";
import { terminalService } from "../terminal";
import { WebAutomationSessionTracker } from "./sessionTracker";
import { previewString, assertSafeUrl } from "./utils";
import type {
  HttpGetBatchArgs,
  WebAutomationArgs,
  TerminalCommandArgs,
} from "./types";

export const executeHttpGetBatch = async (
  args: HttpGetBatchArgs
): Promise<string> => {
  const { urls, headers } = args;
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
      assertSafeUrl(url);
      console.log(`🌐 [HTTP:get] ${url}`);
      const resp = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      if (!resp.ok) {
        out.push({
          url,
          ok: false,
          status: resp.status,
          error: resp.statusText,
        });
        continue;
      }
      try {
        const json = await resp.json();
        out.push({ url, ok: true, data: json });
      } catch {
        const text = await resp.text();
        out.push({ url, ok: true, data: text });
      }
    }
    return JSON.stringify({ ok: true, results: out });
  } finally {
    clearTimeout(timeout);
  }
};

export const executeWebAutomation = async (
  args: WebAutomationArgs
): Promise<string> => {
  const { url, actions, options } = args;

  if (!url || !actions || !Array.isArray(actions)) {
    return JSON.stringify({
      ok: false,
      error: "Invalid arguments: provide url and actions array",
    });
  }

  try {
    console.log(`🎭 [WebAutomation] Starting persistent automation for ${url}`);

    // Get or create a persistent session ID
    const sessionTracker = WebAutomationSessionTracker.getInstance();
    const sessionId = sessionTracker.getOrCreateSessionId();

    const result = await playwrightService.executeWebAutomationPersistent(
      {
        url,
        actions,
        options: {
          headless: options?.headless ?? true,
          timeout: options?.timeout || 15000,
          waitForNetworkIdle: options?.waitForNetworkIdle ?? false,
          includeContent: options?.includeContent ?? true,
          useEnhancedExtraction: options?.useEnhancedExtraction ?? true,
          enhancedExtractionOptions: {
            includeHTML: true,
            includeInteractiveElements: true,
            maxContentSize: 4000,
            htmlCleaningOptions: {
              includeImportantJS: false,
              preserveCSS: false,
              includeDataAttributes: true,
              includeAriaAttributes: false,
              includeEventHandlers: false,
            },
            ...options?.enhancedExtractionOptions,
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
    console.log(
      `📋 [WebAutomation] Returning ${responseString.length} chars to LLM`
    );

    return responseString;
  } catch (error: any) {
    console.error(`❌ [WebAutomation] Error:`, error);
    return JSON.stringify({
      ok: false,
      error: error.message || "Unknown web automation error",
    });
  }
};

export const executeTerminalCommand = async (
  args: TerminalCommandArgs
): Promise<string> => {
  const { command, options = {} } = args;

  // Validate that either command or fileUrl is provided
  if (!command && !options.fileUrl) {
    return JSON.stringify({
      ok: false,
      error: "Either command or fileUrl must be provided",
    });
  }

  if (command && typeof command !== "string") {
    return JSON.stringify({
      ok: false,
      error: "Command must be a string",
    });
  }

  try {
    const result = await terminalService.executeCommand(command || "", options);

    return JSON.stringify({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    console.error(`❌ [Terminal] Error:`, error);
    return JSON.stringify({
      ok: false,
      error: error.message || "Terminal command execution failed",
    });
  }
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
      case "http_get_json_batch":
        return await executeHttpGetBatch(args as HttpGetBatchArgs);

      case "web_automation":
        return await executeWebAutomation(args as WebAutomationArgs);

      case "execute_terminal_command":
        return await executeTerminalCommand(args as TerminalCommandArgs);

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
