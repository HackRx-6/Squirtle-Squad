export interface ToolCallingRequest {
  documents: string;
  questions: string[];
}

export interface ToolCallingResponse {
  answers: string[];
  metadata?: {
    documents?: string;
    processedAt: number;
    toolsUsed: boolean;
  };
}

export interface ToolCallingError {
  error: string;
  errorType: "validation" | "timeout" | "llm" | "automation" | "unknown";
  details?: any;
}
