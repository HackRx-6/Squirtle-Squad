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
  options?: Record<string, any>;
  // For form-specific actions
  formData?: Record<string, string>; // For fill_form action
  submitSelector?: string; // For submit_form action
}

export interface WebAutomationResult {
  success: boolean;
  pageContent?: string; // Structured page content
  url?: string; // current page URL
  error?: string;
  metadata?: {
    title?: string;
    timestamp?: number;
  };
}

export interface WebAutomationRequest {
  url: string;
  actions: WebAutomationAction[];
  options?: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    timeout?: number;
    waitForNetworkIdle?: boolean;
    includeContent?: boolean;
    // Enhanced content extraction options
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
}

export interface PlaywrightServiceConfig {
  defaultTimeout: number;
  defaultViewport: { width: number; height: number };
  headless: boolean;
  maxConcurrentPages: number;
}
