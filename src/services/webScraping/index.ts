import { AppConfigService } from "../../config/app.config";
import type { DocumentChunk } from "../../types/document.types";
import type { WebChunkMetadata } from "../../types/toolcalls";
import { urlDetectionService } from "./urlDetection.webScraping";
import { coreWebScrapingService } from "./coreWebScraping.webScraping";
import { linkedContentCache } from "./linkedContentCache.webScraping";
import { RecursiveTextChunkingStrategy } from "../chunking/recursiveText.chunking";

/**
 * Service for enriching context with web content from URLs found in questions or documents
 */
export class WebContextService {
  private static instance: WebContextService;
  private configService: AppConfigService;
  private chunker: RecursiveTextChunkingStrategy;

  private constructor() {
    this.configService = AppConfigService.getInstance();
    const qa = this.configService.getQAConfig();
    this.chunker = new RecursiveTextChunkingStrategy({
      chunkSize: qa.dynamicChunking.defaultChunksToLLM * 120, // rough token->char heuristic
      chunkOverlap: 120,
      keepSeparator: false,
    });
  }

  public static getInstance(): WebContextService {
    if (!WebContextService.instance) {
      WebContextService.instance = new WebContextService();
    }
    return WebContextService.instance;
  }

  /**
   * Extract URLs from question and document chunks, scrape them, and return chunked web content
   */
  public async enrichContextWithWebContent(args: {
    question: string;
    retrievedChunks: Array<{
      content: string;
      pageNumber?: number;
      chunkIndex?: number;
    }>;
    timerAbort?: AbortSignal;
  }): Promise<{ webChunks: DocumentChunk[]; metadata: WebChunkMetadata[] }> {
    const qa = this.configService.getQAConfig();
    const toolCfg = qa.toolCalls;

    // Extract URLs from question and document chunks
    const candidateUrls = this.extractCandidateUrls(
      args.question,
      args.retrievedChunks,
      qa.chunksToLLM
    );

    console.log(`🔗 Extracted candidate URLs:`, candidateUrls);

    // If there are no URLs, return empty
    if (!candidateUrls || candidateUrls.length === 0) {
      console.log(`📭 No URLs found in question or chunks`);
      return { webChunks: [], metadata: [] };
    }

    // Rank and limit URLs (still use config for limits, but not for enable/disable)
    const rankedUrls = this.rankAndLimitUrls(
      candidateUrls,
      args.question,
      toolCfg
    );

    console.log(`📊 Ranked URLs:`, rankedUrls);

    // Fetch web content
    const pages = await this.fetchWebPages(rankedUrls, args.timerAbort);

    // Chunk and prepare web content
    return this.chunkWebContent(pages);
  }

  private extractCandidateUrls(
    question: string,
    retrievedChunks: Array<{ content: string }>,
    chunksToLLM: number
  ): Array<{ url: string; idx: number }> {
    const questionIntent = urlDetectionService.classifyUrlIntent(question);
    const docUrls = retrievedChunks
      .slice(0, chunksToLLM)
      .flatMap((c, idx) =>
        urlDetectionService.extractUrls(c.content).map((u) => ({ url: u, idx }))
      );

    return [
      ...questionIntent.urls.map((u) => ({ url: u, idx: -1 })),
      ...docUrls,
    ];
  }

  private rankAndLimitUrls(
    candidateUrls: Array<{ url: string; idx: number }>,
    question: string,
    toolCfg: any
  ): Array<{ url: string; idx: number }> {
    // Dedupe
    const deduped = Array.from(
      new Map(candidateUrls.map((c) => [c.url, c])).values()
    );

    console.log(`🔧 Tool config:`, toolCfg);
    console.log(
      `📏 maxUrlsPerQuery: ${toolCfg?.advanced?.maxUrlsPerQuery}, maxUrlsFromDocs: ${toolCfg?.advanced?.maxUrlsFromDocs}`
    );

    // Rank by relevance and limit count
    const ranked = urlDetectionService.rankUrlRelevance(
      deduped.map((c) => c.url),
      question
    );

    console.log(`🎯 Ranked results from urlDetectionService:`, ranked);

    const mapped = ranked.map((r) => deduped.find((c) => c.url === r.url)!);
    console.log(`🗺️ Mapped results:`, mapped);

    const maxUrls =
      (toolCfg?.advanced?.maxUrlsPerQuery || 2) +
      (toolCfg?.advanced?.maxUrlsFromDocs || 3);
    console.log(`📊 Max URLs allowed: ${maxUrls}`);

    const final = mapped.slice(0, maxUrls);
    console.log(`✂️ Final URLs after slice:`, final);

    return final;
  }

  private async fetchWebPages(
    rankedUrls: Array<{ url: string; idx: number }>,
    timerAbort?: AbortSignal
  ): Promise<Array<{ text: string; url: string; title?: string }>> {
    const pages: Array<{
      text: string;
      url: string;
      title?: string;
    } | null> = [];

    for (const c of rankedUrls) {
      // Check cache first
      const cached = linkedContentCache.get(c.url);
      if (cached) {
        pages.push({
          text: cached.text,
          url: cached.normalizedUrl,
          title: cached.title,
        });
        continue;
      }

      // Fetch from web
      try {
        console.log(`🔍 Attempting to fetch URL: ${c.url}`);
        const page = await coreWebScrapingService.fetchText(c.url, timerAbort);
        console.log(
          `✅ Fetched URL: ${c.url}, status: ${page.status}, text length: ${page.text.length}`
        );
        if (page.text && page.text.length > 0) {
          // Cache for 6 hours
          linkedContentCache.set(c.url, page, 6 * 60 * 60 * 1000);
          pages.push({
            text: page.text,
            url: page.normalizedUrl,
            title: page.title,
          });
        } else {
          console.warn(
            `⚠️ No text content from URL: ${c.url} (status: ${page.status})`
          );
        }
      } catch (error) {
        console.error(`❌ Failed to fetch URL: ${c.url}`, error);
        // Ignore fetch errors; fallback handled upstream
      }
    }

    return pages.filter(Boolean) as Array<{
      text: string;
      url: string;
      title?: string;
    }>;
  }

  private async chunkWebContent(
    pages: Array<{ text: string; url: string; title?: string }>
  ): Promise<{ webChunks: DocumentChunk[]; metadata: WebChunkMetadata[] }> {
    const webChunks: DocumentChunk[] = [];
    const metadata: WebChunkMetadata[] = [];

    for (const page of pages) {
      let chunks = await this.chunker.chunk(page.text, page.url);

      // Fallback for very short pages: keep a single chunk
      if (!chunks || chunks.length === 0) {
        chunks = [
          {
            pageNumber: 1,
            content: page.text.trim(),
            metadata: {
              chunkType: "character-wise",
              startIndex: 0,
              endIndex: page.text.length,
              characterCount: page.text.length,
            } as any,
          },
        ];
      }

      // Add web-specific metadata to chunks
      chunks.forEach((chunk) => {
        (chunk.metadata as any) = {
          ...(chunk.metadata || {}),
          source: "web",
          url: page.url,
          title: page.title,
          fetchedAt: new Date().toISOString(),
        };
      });

      webChunks.push(...chunks);
      metadata.push({
        source: "web",
        url: page.url,
        title: page.title,
        fetchedAt: new Date().toISOString(),
      });
    }

    return { webChunks, metadata };
  }
}

export const webContextService = WebContextService.getInstance();

// Re-export all web scraping services for external consumption
export { urlDetectionService as urlDetection } from "./urlDetection.webScraping";
export { coreWebScrapingService } from "./coreWebScraping.webScraping";
export { linkedContentCache } from "./linkedContentCache.webScraping";
export { webQAService } from "./webQA.webScraping";
export { enhancedWebScrapingService } from "./enhanced.webScraping";

// Export types
export * from "./types";

// Export additional classes for direct usage (use different names to avoid conflicts)
export { UrlDetectionService as UrlDetectionServiceClass } from "./urlDetection.webScraping";
export { CoreWebScrapingService as CoreWebScrapingServiceClass } from "./coreWebScraping.webScraping";
export { LinkedContentCacheService as LinkedContentCacheServiceClass } from "./linkedContentCache.webScraping";
export { WebQAService as WebQAServiceClass } from "./webQA.webScraping";
export { EnhancedWebScrapingService } from "./enhanced.webScraping";
