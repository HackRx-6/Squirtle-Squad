// Note: webContextService is not re-exported here to avoid bundling conflicts
// Import directly from "./webContext.webScraping" if needed

// Re-export service instances with aliases to avoid naming conflicts
export { urlDetectionService as urlDetection } from "./urlDetection.webScraping";
export { coreWebScrapingService } from "./coreWebScraping.webScraping";
export { linkedContentCache } from "./linkedContentCache.webScraping";
export { webQAService as webQA } from "./webQA.webScraping";
export { enhancedWebScrapingService } from "./enhanced.webScraping";

// Export types
export * from "./types";

// Export additional classes for direct usage (use different names to avoid conflicts)
export { UrlDetectionService as UrlDetectionServiceClass } from "./urlDetection.webScraping";
export { CoreWebScrapingService as CoreWebScrapingServiceClass } from "./coreWebScraping.webScraping";
export { LinkedContentCacheService as LinkedContentCacheServiceClass } from "./linkedContentCache.webScraping";
export { WebQAService as WebQAServiceClass } from "./webQA.webScraping";
export { EnhancedWebScrapingService } from "./enhanced.webScraping";
export { WebContextService as WebContextServiceClass } from "./webContext.webScraping";
