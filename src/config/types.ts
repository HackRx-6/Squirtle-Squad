export interface AIConfig {
  openAI: {
    primary: {
      apiKey: string;
      endpoint: string;
      deploymentName: string;
      embeddingModel: string;
      apiVersion?: string;
    };
    secondary?: {
      apiKey: string;
      endpoint: string;
      deploymentName: string;
      embeddingModel: string;
      apiVersion?: string;
    };
  };
  llm: {
    primary: {
      apiKey: string;
      baseURL: string;
      model: string;
      service?: string;
      version?: string;
      name?: string;
      apiVersion?: string;
    };
    secondary?: {
      apiKey: string;
      baseURL: string;
      model: string;
      service?: string;
      version?: string;
      name?: string;
      apiVersion?: string;
    };
  };
  claude: {
    primary: {
      apiKey: string;
      baseURL: string;
      model: string;
      service: string;
      name?: string;
      apiVersion?: string;
    };
    secondary?: {
      apiKey: string;
      baseURL: string;
      model: string;
      service: string;
      name?: string;
      apiVersion?: string;
    };
  };
}

export interface ChunkingConfig {
  pageWise: {
    enabled: boolean;
    pagesPerChunk: number;
  };
  characterWise: {
    enabled: boolean;
    chunkSize: number;
    overlap: number;
    minChunkSizeRatio: number;
  };
  recursive: {
    enabled: boolean;
    chunkSize: number;
    chunkOverlap: number;
    separators: string[];
    keepSeparator: boolean;
  };
}

export interface EmbeddingBatchConfig {
  enabled: boolean;
  batchSize: number; // Number of chunks to process in parallel per batch (e.g., 250)
}

export interface VectorSearchConfig {
  useHNSW: boolean;
}

export interface GlobalTimerConfig {
  enabled: boolean;
  timeoutSeconds: number; // Global API timeout in seconds (29.5 default)
}

export interface StreamingConfig {
  bufferSize: number; // Size of streaming buffer
  flushInterval: number; // Interval in ms to flush streaming buffer
}

export interface DynamicChunkingConfig {
  enabled: boolean;
  pageThreshold: number; // Pages above which to use dynamic chunking (e.g., 300)
  defaultChunksToLLM: number; // Default number of chunks for smaller PDFs (e.g., 30)
  largeDocumentChunksToLLM: number; // Reduced number of chunks for large PDFs (e.g., 10)
}

export interface TextExtractionConfig {
  pdfMethod: "unpdf" | "python-pymupdf"; // Primary PDF extraction method
  fallbackEnabled: boolean; // Enable fallback to alternative method on failure
  performanceLogging: boolean; // Enable detailed performance logging
  pythonService: {
    url: string; // Python PDF service URL
    timeout: number; // Request timeout in milliseconds
    healthCheckInterval: number; // Health check interval in seconds
  };
}

export interface QAConfig {
  chunksToLLM: number; // Unified config for both searchLimit and maxChunksToLLM
  vectorSearch: VectorSearchConfig;
  embeddingTimeout: number; // Timeout in seconds for document chunk embedding generation only
  questionEmbeddingTimeout: number; // Timeout in seconds for question embedding generation
  embeddingBatch: EmbeddingBatchConfig; // Batch processing for embeddings
  enableLLMRacing: boolean; // Cost-effective mode by default - split questions between LLMs
  globalTimer: GlobalTimerConfig;
  streaming: StreamingConfig;
  dynamicChunking: DynamicChunkingConfig;
  textExtraction: TextExtractionConfig;
  toolCalls?: ToolCallConfig;
  security: SecurityConfig; // Security and prompt injection protection
}

export interface SecurityConfig {
  promptInjectionProtection: {
    enabled: boolean; // Master toggle for prompt injection protection
    strictMode: boolean; // Enable strict sanitization by default
    azureContentPolicy: boolean; // Enable Azure-specific content policy protection
    preserveUrls: boolean; // Always preserve URLs during sanitization
    maxRiskScore: number; // Maximum acceptable risk score (0-100)
    logSuspiciousContent: boolean; // Log detected prompt injection attempts
    blockHighRiskRequests: boolean; // Block requests that exceed risk threshold
  };
}

export interface ToolCallConfig {
  enabled: boolean;
  maxLoops?: number; // Maximum number of tool call loops
  // Advanced configuration moved to separate interface
  advanced?: {
    maxUrlsPerQuery: number;
    maxUrlsFromDocs: number;
    timeoutMs: number;
    maxBytes: number; // cap downloaded size
    concurrency: number;
    respectRobotsTxt: boolean;
    allowedDomains: string[];
    deniedDomains: string[];
  };
}

export interface LoggingConfig {
  enabled: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  fileLogging: boolean;
  consoleLogging: boolean;
  maxFileSize: number; // in MB
  maxFiles: number;
  archiveAfterDays: number;
  logRotation: boolean;
  logFormat: "simple" | "detailed" | "json";
}
