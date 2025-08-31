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

  if (!actions || !Array.isArray(actions)) {
    return JSON.stringify({
      ok: false,
      error: "Invalid arguments: provide actions array",
    });
  }

  try {
    const sessionTracker = WebAutomationSessionTracker.getInstance();
    const sessionId = sessionTracker.getOrCreateSessionId();

    if (url) {
      console.log(
        `🎭 [WebAutomation] Starting automation with navigation to ${url}`
      );
    } else {
      console.log(
        `🎭 [WebAutomation] Continuing automation on current page (session: ${sessionId})`
      );
    }

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
      // Removed redundant url field - URL is already in pageContent metadata
      pageContent: result.pageContent,
      metadata: result.metadata,
    };

    const responseString = JSON.stringify(responseData);

    console.log("\n� [WebAutomation] COMPLETE LLM RESPONSE:");
    console.log("◆".repeat(80));
    console.log("📊 Response Size:", responseString.length, "characters");
    console.log("🌐 Final URL:", result.url); // Still log for debugging, but not sent to LLM
    console.log("◆".repeat(80));
    console.log("🎯 FULL JSON RESPONSE TO LLM:");
    console.log(responseString);
    console.log("◆".repeat(80));
    console.log("🚀 This COMPLETE response is being sent to LLM\n");

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

  console.log("\n🛠️ [ToolCall] RECEIVED FROM LLM:");
  console.log("◇".repeat(80));
  console.log("🔧 Tool Name:", name);
  console.log("🔧 Tool Call ID:", toolCall.id);
  console.log("📝 Raw Arguments String:", rawArgs);
  console.log("◇".repeat(80));

  try {
    const args = rawArgs ? JSON.parse(rawArgs) : {};

    console.log("✅ [ToolCall] PARSED ARGUMENTS:");
    console.log("◇".repeat(80));
    console.log(JSON.stringify(args, null, 2));
    console.log("◇".repeat(80));
    console.log("🚀 Executing tool with above arguments...\n");

    console.log(`🛠️ [ToolCall:start] name=${name} args=${previewString(args)}`);

    let result: string;
    switch (name) {
      case "http_get_json_batch":
        result = await executeHttpGetBatch(args as HttpGetBatchArgs);
        break;

      case "web_automation":
        result = await executeWebAutomation(args as WebAutomationArgs);
        break;

      case "execute_terminal_command":
        result = await executeTerminalCommand(args as TerminalCommandArgs);
        break;

      default:
        console.warn(
          `⚠️ [ToolCall:unknown] name=${name} args=${previewString(rawArgs)}`
        );
        result = JSON.stringify({
          ok: false,
          error: `Unknown tool: ${name}`,
        });
    }

    console.log("\n🎯 [ToolCall] FINAL RESULT BEING RETURNED TO LLM:");
    console.log("◆".repeat(80));
    console.log("🔧 Tool:", name);
    console.log("📊 Result Size:", result.length, "characters");
    console.log("◆".repeat(80));
    console.log("📋 COMPLETE RESULT:");
    console.log(result);
    console.log("◆".repeat(80));
    console.log("✅ Tool execution completed\n");

    return result;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("\n❌ [ToolCall] ERROR:");
    console.error("◇".repeat(80));
    console.error("🔧 Tool:", name);
    console.error("📝 Raw Args:", rawArgs);
    console.error("💥 Error:", errorMsg);
    console.error("◇".repeat(80));

    console.error(
      `❌ [ToolCall:error] name=${name} args=${previewString(
        rawArgs
      )} error=${errorMsg}`
    );
    const errorResult = JSON.stringify({
      ok: false,
      error: errorMsg,
    });

    console.log("\n🎯 [ToolCall] ERROR RESULT BEING RETURNED TO LLM:");
    console.log("◆".repeat(80));
    console.log(errorResult);
    console.log("◆".repeat(80));

    return errorResult;
  }
};
