export interface ScrapedPage {
    url: string;
    normalizedUrl: string;
    title?: string;
    text: string;
    htmlLength: number;
    fetchedAt: string; // ISO
    status: number;
    contentType?: string;
}

export interface WebScrapingResult {
    url: string;
    content: string;
    title?: string;
    metadata: WebPageMetadata;
    success: boolean;
    error?: string;
    processingTime: number;
}

export interface WebPageMetadata {
    contentType: string;
    lastModified?: string;
    contentLength: number;
    encoding?: string;
    statusCode: number;
    redirectedFrom?: string;
}

export interface WebScrapingOptions {
    timeout?: number;
    maxBytes?: number;
    followRedirects?: boolean;
    respectRobotsTxt?: boolean;
    userAgent?: string;
    headers?: Record<string, string>;
}

export interface UrlDetectionResult {
    urls: string[];
    intent: UrlIntent;
    confidence: number;
}

export interface UrlIntent {
    type: "reference" | "search" | "direct" | "context";
    urls: string[];
    confidence: number;
}

export interface LinkedContentCacheEntry {
    url: string;
    content: string;
    timestamp: number;
    ttl: number;
    metadata: WebPageMetadata;
}

export interface WebContextEnrichmentOptions {
    maxUrlsPerQuery: number;
    maxUrlsFromDocs: number;
    timeoutMs: number;
    allowedDomains?: string[];
    deniedDomains?: string[];
    respectRobotsTxt: boolean;
}

export interface WebContextResult {
    originalQuestion: string;
    enrichedChunks: Array<{
        content: string;
        source: "document" | "web";
        url?: string;
        relevance: number;
    }>;
    webSources: WebScrapingResult[];
    processingTime: number;
}
