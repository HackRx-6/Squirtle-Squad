import type OpenAI from "openai";

export type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;
export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export interface WebAutomationAction {
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
}

export interface WebAutomationOptions {
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
}

export interface TerminalCommandOptions {
  timeout?: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
  shell?: string;
  maxOutputSize?: number;
  fileUrl?: string;
  runtime?: "auto" | "node" | "python" | "bash" | "deno" | "bun";
}

export interface HttpGetBatchArgs {
  urls: string[];
  headers?: Record<string, string>;
}

export interface WebAutomationArgs {
  url: string;
  actions: WebAutomationAction[];
  options?: WebAutomationOptions;
}

export interface TerminalCommandArgs {
  command?: string;
  options?: TerminalCommandOptions;
}
