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
            content: `Tool execution promise rejected: ${result.reason}`,
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
