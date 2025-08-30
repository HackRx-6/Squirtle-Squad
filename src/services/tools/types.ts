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
    | "find_element"
    | "get_text"
    | "get_attribute"
    | "set_checkbox"
    | "select_option"
    | "scroll_to_element"
    | "wait_for_element";
  selector?: string;
  text?: string;
  url?: string;
  timeout?: number;
  options?: Record<string, any>;
  // For form-specific actions
  formData?: Record<string, string>; // For fill_form action
  submitSelector?: string; // For submit_form action
  // For selection actions
  optionValue?: string | number; // For select_option action
  checked?: boolean; // For set_checkbox action
  // For retrieval actions
  attributeName?: string; // For get_attribute action
  // For wait actions
  waitState?: 'attached' | 'detached' | 'visible' | 'hidden'; // For wait_for_element action
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
