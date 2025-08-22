import type { ChunkingConfig, QAConfig } from "./types";

export class AppConfigService {
  private static instance: AppConfigService;
  private chunkingConfig: ChunkingConfig;
  private qaConfig: QAConfig;

  private constructor() {
    // Initialize configurations
    this.chunkingConfig = {
      pageWise: {
        enabled: false,
        pagesPerChunk: 1,
      },
      characterWise: {
        enabled: false,
        chunkSize: 4000,
        overlap: 200,
        minChunkSizeRatio: 0.8,
      },
      recursive: {
        enabled: true,
        chunkSize: 2000,
        chunkOverlap: 200,
        separators: ["\n\n", "\n", " ", ""],
        keepSeparator: false,
      },
    };

    this.qaConfig = {
      chunksToLLM: 25, // Unified config for both searchLimit and maxChunksToLLM
      vectorSearch: {
        useHNSW: true,
      },
      embeddingTimeout: 2, // 7 seconds timeout for document chunk embedding generation
      questionEmbeddingTimeout: 4, // 6 seconds timeout for question embedding generation
      embeddingBatch: {
        enabled: true,
        batchSize: 300,
      },
      enableLLMRacing: false, // Cost-effective mode by default - split questions between LLMs
      globalTimer: {
        enabled: false,
        timeoutSeconds: 29.55, // Global API timeout in seconds
      },
      streaming: {
        bufferSize: 1024, // 1KB buffer size for streaming
        flushInterval: 100, // Flush every 100ms
      },
      dynamicChunking: {
        enabled: true,
        pageThreshold: 300, // Use dynamic chunking for PDFs with more than 300 pages
        defaultChunksToLLM: 25, // Default chunks for smaller PDFs
        largeDocumentChunksToLLM: 10, // Reduced chunks for large PDFs
      },
      textExtraction: {
        pdfMethod: "python-pymupdf", // Python service is default for better performance
        fallbackEnabled: process.env.PDF_FALLBACK_ENABLED !== "false", // Fallback enabled by default
        performanceLogging: true,
        pythonService: {
          url: process.env.PDF_SERVICE_URL || "http://localhost:8000",
          timeout: parseInt(process.env.PDF_SERVICE_TIMEOUT || "10000"), // 10 seconds timeout
          healthCheckInterval: parseInt(
            process.env.PDF_HEALTH_CHECK_INTERVAL || "300"
          ), // 5 minutes
        },
      },
      toolCalls: {
        enabled: process.env.TOOLCALLS_ENABLED !== "false", // Simple boolean toggle
        advanced: {
          maxUrlsPerQuery: parseInt(
            process.env.TOOLCALLS_MAX_URLS_PER_QUERY || "2"
          ),
          maxUrlsFromDocs: parseInt(
            process.env.TOOLCALLS_MAX_URLS_FROM_DOCS || "3"
          ),
          timeoutMs: parseInt(process.env.TOOLCALLS_TIMEOUT_MS || "8000"),
          maxBytes: parseInt(process.env.TOOLCALLS_MAX_BYTES || "2000000"),
          concurrency: parseInt(process.env.TOOLCALLS_CONCURRENCY || "2"),
          respectRobotsTxt: process.env.TOOLCALLS_RESPECT_ROBOTS !== "false",
          allowedDomains: (process.env.TOOLCALLS_ALLOWED_DOMAINS || "")
            .split(",")
            .filter(Boolean),
          deniedDomains: (
            process.env.TOOLCALLS_DENIED_DOMAINS ||
            "127.0.0.1,0.0.0.0,localhost,169.254.169.254"
          )
            .split(",")
            .filter(Boolean),
        },
      },
      security: {
        promptInjectionProtection: {
          enabled: true, // Enabled to prevent prompt injection attacks
          strictMode: true, // Disabled by default
          azureContentPolicy: true, // Enabled by default for Azure
          preserveUrls: true,
          maxRiskScore: 40, // Default max risk score
          logSuspiciousContent: true, // Enabled by default
          blockHighRiskRequests: false, // Disabled by default
        },
      },
    };
  }

  public static getInstance(): AppConfigService {
    if (!AppConfigService.instance) {
      AppConfigService.instance = new AppConfigService();
    }
    return AppConfigService.instance;
  }

  public getChunkingConfig(): ChunkingConfig {
    return this.chunkingConfig;
  }

  public getServerConfig() {
    return {
      port: process.env.PORT || 3000,
    };
  }

  public getAuthConfig() {
    return {
      hackrxAuthToken: process.env.HACKRX_AUTH_TOKEN,
    };
  }

  public getQAConfig(): QAConfig {
    return this.qaConfig;
  }

  public getSecurityConfig() {
    return this.qaConfig.security;
  }

  /**
   * Get dynamic chunks to LLM based on total pages in PDF
   * @param totalPages - Total number of pages in the PDF
   * @returns Number of chunks to send to LLM
   */
  public getDynamicChunksToLLM(totalPages: number): number {
    const { dynamicChunking } = this.qaConfig;

    if (!dynamicChunking.enabled) {
      return this.qaConfig.chunksToLLM;
    }

    if (totalPages > dynamicChunking.pageThreshold) {
      console.log(
        `📚 Large PDF detected (${totalPages} pages > ${dynamicChunking.pageThreshold} threshold). Using ${dynamicChunking.largeDocumentChunksToLLM} chunks for LLM.`
      );
      return dynamicChunking.largeDocumentChunksToLLM;
    } else {
      console.log(
        `📄 Standard PDF (${totalPages} pages ≤ ${dynamicChunking.pageThreshold} threshold). Using ${dynamicChunking.defaultChunksToLLM} chunks for LLM.`
      );
      return dynamicChunking.defaultChunksToLLM;
    }
  }

  /**
   * Simple tool configuration control
   */
  public enableTools(): void {
    this.qaConfig.toolCalls = this.qaConfig.toolCalls || { enabled: true };
    this.qaConfig.toolCalls.enabled = true;
    console.log("🧰 Tools enabled");
  }

  public disableTools(): void {
    if (this.qaConfig.toolCalls) {
      this.qaConfig.toolCalls.enabled = false;
    }
    console.log("🧰 Tools disabled");
  }

  public isToolsEnabled(): boolean {
    return this.qaConfig.toolCalls?.enabled ?? false;
  }

  /**
   * Update PDF extraction method at runtime
   * @param method - The PDF extraction method to use
   * @param fallbackEnabled - Whether to enable fallback to alternative method
   */
  public updatePdfExtractionMethod(
    method: "unpdf" | "python-pymupdf",
    fallbackEnabled: boolean = true
  ): void {
    // Update environment variable for persistence across restarts
    process.env.PDF_EXTRACTION_METHOD = method;
    process.env.PDF_FALLBACK_ENABLED = fallbackEnabled.toString();

    console.log(`📄 PDF extraction method updated to: ${method}`);
    console.log(`🔄 Fallback ${fallbackEnabled ? "ENABLED" : "DISABLED"}`);
  }

  /**
   * Get PDF extraction status and configuration
   */
  public getPdfExtractionStatus() {
    const config = this.qaConfig.textExtraction;
    return {
      primaryMethod: config.pdfMethod,
      fallbackEnabled: config.fallbackEnabled,
      pythonServiceUrl: config.pythonService.url,
      pythonServiceTimeout: config.pythonService.timeout,
      healthCheckInterval: config.pythonService.healthCheckInterval,
    };
  }
}
