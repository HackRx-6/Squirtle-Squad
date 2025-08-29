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

    // Rank and limit URLs
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
    // Extract URLs from the question itself
    const questionUrls = urlDetectionService.classifyUrlIntent(question);

    // Extract URLs from the top chunks
    const chunkUrls = retrievedChunks
      .slice(0, chunksToLLM)
      .flatMap((chunk, idx) =>
        urlDetectionService
          .extractUrls(chunk.content)
          .map((url) => ({ url, idx }))
      );

    return [
      ...questionUrls.urls.map((url) => ({ url, idx: -1 })), // question URLs
      ...chunkUrls, // chunk URLs
    ];
  }

  private rankAndLimitUrls(
    candidateUrls: Array<{ url: string; idx: number }>,
    question: string,
    toolCfg: any
  ): Array<{ url: string; idx: number }> {
    // Deduplicate URLs
    const uniqueUrls = Array.from(
      new Map(candidateUrls.map((c) => [c.url, c])).values()
    );

    console.log("🔧 Tool config:", toolCfg);
    console.log(
      `📋 maxUrlsPerQuery: ${toolCfg?.advanced?.maxUrlsPerQuery}, maxUrlsFromDocs: ${toolCfg?.advanced?.maxUrlsFromDocs}`
    );

    // Rank URLs by relevance to question
    const rankedResults = urlDetectionService.rankUrlRelevance(
      uniqueUrls.map((c) => c.url),
      question
    );

    console.log("🎯 Ranked results from urlDetectionService:", rankedResults);

    // Map back to original candidateUrls format
    const mappedResults = rankedResults
      .map((r) => uniqueUrls.find((c) => c.url === r.url))
      .filter((item): item is { url: string; idx: number } => item !== undefined);

    console.log("🗺️ Mapped results:", mappedResults);

    // Limit number of URLs
    const maxUrls =
      (toolCfg?.advanced?.maxUrlsPerQuery || 2) +
      (toolCfg?.advanced?.maxUrlsFromDocs || 3);

    console.log(`📊 Max URLs allowed: ${maxUrls}`);

    const finalUrls = mappedResults.slice(0, maxUrls);
    console.log("✂️ Final URLs after slice:", finalUrls);

    return finalUrls;
  }

  private async fetchWebPages(
    rankedUrls: Array<{ url: string; idx: number }>,
    timerAbort?: AbortSignal
  ): Promise<Array<{ text: string; url: string; title?: string }>> {
    const pages: Array<{ text: string; url: string; title?: string }> = [];

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
      } catch (error: any) {
        console.error(`❌ Failed to fetch URL: ${c.url}`, error);
      }
    }

    return pages.filter(Boolean);
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
        chunk.metadata = {
          ...chunk.metadata,
          source: "web",
          url: page.url,
          title: page.title,
          fetchedAt: new Date().toISOString(),
        } as any;
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
