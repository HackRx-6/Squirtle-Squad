export interface HackRXRequest {
  documents: string;
  questions: string[];
}

export interface HackRXResponse {
  answers: string[];
  metadata?: {
    documents?: string;
    processedAt: number;
    toolsUsed: boolean;
  };
}

export interface HackRXError {
  error: string;
  errorType: "validation" | "timeout" | "llm" | "automation" | "unknown";
  details?: any;
}
