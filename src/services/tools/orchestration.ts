import type OpenAI from "openai";
import { AppConfigService } from "../../config";
import { getOpenAIToolsSchemas } from "./schemas";
import { executeToolCall } from "./executors";
import { previewString } from "./utils";
import type { ToolChoice } from "./types";

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

  console.log("\n🧰 [Orchestration] TOOL-CALLING SESSION STARTED:");
  console.log("◈".repeat(80));
  console.log("🤖 Model:", model);
  console.log("🛠️ Tools Available:", tools.length);
  console.log("🎯 Tool Choice Strategy:", JSON.stringify(toolChoice, null, 2));
  console.log("🔄 Max Loops:", maxLoops);
  console.log("🌍 Is Azure:", !!options?.isAzure);
  console.log("💬 Initial User Message Length:", userMessage.length);
  console.log("◈".repeat(80));
  console.log("💬 INITIAL USER MESSAGE:");
  console.log("─".repeat(60));
  console.log(userMessage);
  console.log("─".repeat(60));

  // Main conversation loop with tool support
  for (let iteration = 0; iteration < maxLoops; iteration++) {
    console.log(`🔁 Tool loop iteration ${iteration + 1}/${maxLoops}`);

    console.log("\n🔄 [Orchestration] MAKING LLM REQUEST:");
    console.log("◈".repeat(80));
    console.log("🔢 Iteration:", `${iteration + 1}/${maxLoops}`);
    console.log("🤖 Model:", model);
    console.log("💬 Message Count:", messages.length);
    console.log(
      "🛠️ Tools:",
      tools
        .map((t) => (t.type === "function" ? t.function?.name : t.type))
        .join(", ")
    );
    console.log("🎯 Tool Choice:", JSON.stringify(toolChoice, null, 2));
    console.log("◈".repeat(80));

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

    console.log("\n🧠 [Orchestration] LLM RESPONSE RECEIVED:");
    console.log("◈".repeat(80));
    console.log("🔢 Iteration:", `${iteration + 1}/${maxLoops}`);
    console.log("📝 Content Length:", assistantMessage?.content?.length || 0);
    console.log("🛠️ Tool Calls Requested:", toolCalls.length);
    console.log("◈".repeat(80));

    if (assistantMessage?.content) {
      console.log("💬 LLM RESPONSE CONTENT:");
      console.log("─".repeat(60));
      console.log(assistantMessage.content);
      console.log("─".repeat(60));
    }

    if (toolCalls.length > 0) {
      console.log("🛠️ TOOL CALLS REQUESTED BY LLM:");
      console.log("─".repeat(60));
      toolCalls.forEach((call, idx) => {
        console.log(`🔧 Tool Call ${idx + 1}:`);
        console.log("  ID:", call.id);
        console.log("  Type:", call.type);
        console.log("  Function:", call.function?.name);
        console.log("  Arguments:", call.function?.arguments);
      });
      console.log("─".repeat(60));
    }

    // If no tool calls, the assistant has provided a final answer
    if (!toolCalls.length) {
      console.log(`🧠 Assistant provided final response without tool calls.`);
      const content = assistantMessage?.content?.trim();
      if (content) {
        console.log("\n✅ [Orchestration] FINAL RESPONSE:");
        console.log("◈".repeat(80));
        console.log("📝 Response Length:", content.length);
        console.log("💬 FINAL CONTENT:");
        console.log("─".repeat(60));
        console.log(content);
        console.log("─".repeat(60));
        console.log("◈".repeat(80));
        return content;
      }

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

    console.log("\n🛠️ [Orchestration] EXECUTING TOOL CALLS:");
    console.log("◈".repeat(80));
    console.log("🔢 Tool Calls Count:", toolCalls.length);
    console.log("◈".repeat(80));

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

          console.log("\n✅ [Orchestration] TOOL EXECUTION SUCCESS:");
          console.log("◈".repeat(80));
          console.log("🔧 Tool:", toolName);
          console.log("🆔 Call ID:", toolCall.id);
          console.log("📊 Result Length:", result.length);
          console.log("◈".repeat(80));
          console.log("📋 TOOL RESULT:");
          console.log("─".repeat(60));
          console.log(result);
          console.log("─".repeat(60));

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

          console.log("\n❌ [Orchestration] TOOL EXECUTION FAILED:");
          console.log("◈".repeat(80));
          console.log("🔧 Tool:", toolName);
          console.log("🆔 Call ID:", toolCall.id);
          console.log("💥 Error:", errorMsg);
          console.log("◈".repeat(80));

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
    console.log("\n📝 [Orchestration] ADDING TOOL RESULTS TO CONVERSATION:");
    console.log("◈".repeat(80));

    toolResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        console.log(
          `✅ Tool ${index + 1} (${
            result.value.toolCallId
          }): Adding result to conversation`
        );
        console.log(
          `   Content Length: ${result.value.content.length} characters`
        );

        messages.push({
          role: "tool",
          tool_call_id: result.value.toolCallId,
          content: result.value.content,
        });
      } else {
        // Handle Promise rejection
        const toolCall = toolCalls[index];
        console.log(
          `❌ Tool ${index + 1} (${toolCall?.id}): Adding error to conversation`
        );
        console.log(`   Error: ${result.reason}`);

        if (toolCall) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Tool execution promise rejected: ${result.reason}`,
          });
        }
      }
    });

    console.log("◈".repeat(80));
    console.log(`📝 Total messages in conversation: ${messages.length}`);
    console.log("◈".repeat(80));

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

  console.log("\n🔚 [Orchestration] MAKING FINAL CALL:");
  console.log("◈".repeat(80));
  console.log("🔢 Total Iterations:", maxLoops);
  console.log("💬 Final Message Count:", messages.length);
  console.log("🛠️ Tool Choice: none (final call)");
  console.log("◈".repeat(80));

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

  console.log("\n🏁 [Orchestration] FINAL RESPONSE RECEIVED:");
  console.log("◈".repeat(80));
  console.log("📝 Response Length:", finalContent?.length || 0);
  console.log("◈".repeat(80));

  if (finalContent) {
    console.log("💬 FINAL RESPONSE CONTENT:");
    console.log("─".repeat(60));
    console.log(finalContent);
    console.log("─".repeat(60));
  }
  console.log("◈".repeat(80));

  return (
    finalContent ||
    "Unable to generate a complete response within the tool execution limit."
  );
};
