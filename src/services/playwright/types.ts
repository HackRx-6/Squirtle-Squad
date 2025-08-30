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

export interface PlaywrightServiceConfig {
  defaultTimeout: number;
  defaultViewport: { width: number; height: number };
  headless: boolean;
  maxConcurrentPages: number;
}

export interface HTMLCleaningOptions {
  /** Whether to include JavaScript that contains important operations */
  includeImportantJS?: boolean;
  /** Whether to preserve CSS for styling context */
  preserveCSS?: boolean;
  /** Whether to include data attributes */
  includeDataAttributes?: boolean;
  /** Whether to include ARIA attributes for accessibility */
  includeAriaAttributes?: boolean;
  /** Maximum size of individual script blocks to include (in characters) */
  maxScriptSize?: number;
  /** Whether to include inline event handlers */
  includeEventHandlers?: boolean;
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
      htmlCleaningOptions?: HTMLCleaningOptions;
    };
  };
}
