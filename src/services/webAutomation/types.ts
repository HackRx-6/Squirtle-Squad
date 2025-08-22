export interface WebAutomationAction {
  type: "click" | "type" | "wait" | "scroll" | "navigate" | "select" | "hover";
  selector?: string;
  text?: string;
  url?: string;
  timeout?: number;
  options?: Record<string, any>;
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
  };
}

export interface PlaywrightServiceConfig {
  defaultTimeout: number;
  defaultViewport: { width: number; height: number };
  headless: boolean;
  maxConcurrentPages: number;
}
