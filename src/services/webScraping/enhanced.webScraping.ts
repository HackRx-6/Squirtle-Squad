import { HTMLCleaningService } from "../cleaning/html.cleaning";
import { TextCleaningService } from "../cleaning/text.cleaning";
import { coreWebScrapingService } from "./coreWebScraping.webScraping";
import type { TimerContext } from "../timer";

export interface EnhancedWebScrapingOptions {
  cleaningStrategy?: "aggressive" | "balanced" | "conservative";
  preserveStructure?: boolean;
  includeTables?: boolean;
  includeLinks?: boolean;
  maxContentLength?: number;
  customCleaningRules?: {
    removeElements?: string[];
    preserveElements?: string[];
    convertToText?: Record<string, string>;
  };
}

export interface EnhancedWebScrapingResult {
  url: string;
  normalizedUrl: string;
  title?: string;
  text: string;
  originalHtmlLength: number;
  cleanedTextLength: number;
  tokenReduction: {
    estimatedOriginalTokens: number;
    estimatedCleanedTokens: number;
    reductionPercent: string;
    tokensSaved: number;
  };
  fetchedAt: string;
  status: number;
  contentType?: string;
  cleaningStats: any;
}

export class EnhancedWebScrapingService {
  private static instance: EnhancedWebScrapingService;

  private constructor() {}

  public static getInstance(): EnhancedWebScrapingService {
    if (!EnhancedWebScrapingService.instance) {
      EnhancedWebScrapingService.instance = new EnhancedWebScrapingService();
    }
    return EnhancedWebScrapingService.instance;
  }

  /**
   * Fetch and clean HTML content with enhanced cleaning options
   */
  public async fetchAndCleanHTML(
    url: string,
    options: EnhancedWebScrapingOptions = {},
    signal?: AbortSignal
  ): Promise<EnhancedWebScrapingResult> {
    console.log(`🌐 Enhanced web scraping for: ${url}`);
    console.log(
      `🧹 Cleaning strategy: ${options.cleaningStrategy || "balanced"}`
    );

    // Use core web scraping to get raw HTML
    const coreResult = await coreWebScrapingService.fetchText(url, signal);

    if (coreResult.status !== 200) {
      throw new Error(
        `Failed to fetch URL: ${url}. Status: ${coreResult.status}`
      );
    }

    // Get raw HTML by bypassing the built-in cleaning
    const rawHtml = await this.fetchRawHTML(url, signal);

    // Apply enhanced cleaning
    const cleanedText = this.applyEnhancedCleaning(rawHtml, options);

    // Get cleaning statistics
    const cleaningStats = HTMLCleaningService.getCleaningStats(
      rawHtml,
      cleanedText
    );

    return {
      url: coreResult.url,
      normalizedUrl: coreResult.normalizedUrl,
      title: coreResult.title,
      text: cleanedText,
      originalHtmlLength: rawHtml.length,
      cleanedTextLength: cleanedText.length,
      tokenReduction: {
        estimatedOriginalTokens: cleaningStats.estimatedOriginalTokens,
        estimatedCleanedTokens: cleaningStats.estimatedCleanedTokens,
        reductionPercent: cleaningStats.tokenReductionPercent,
        tokensSaved: cleaningStats.tokensReduced,
      },
      fetchedAt: coreResult.fetchedAt,
      status: coreResult.status,
      contentType: coreResult.contentType,
      cleaningStats,
    };
  }

  /**
   * Fetch raw HTML without any cleaning
   */
  private async fetchRawHTML(
    url: string,
    signal?: AbortSignal
  ): Promise<string> {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal,
        headers: {
          "user-agent": "fantastic-robo/1.0 (+https://example.com)",
          accept: "text/html,text/plain,application/xhtml+xml",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error: any) {
      throw new Error(`Failed to fetch raw HTML: ${error.message}`);
    }
  }

  /**
   * Apply enhanced cleaning based on options
   */
  private applyEnhancedCleaning(
    html: string,
    options: EnhancedWebScrapingOptions
  ): string {
    const {
      cleaningStrategy = "balanced",
      preserveStructure = true,
      includeTables = false,
      includeLinks = false,
      maxContentLength,
      customCleaningRules,
    } = options;

    let cleanedHtml = html;

    // Apply custom cleaning rules first if provided
    if (customCleaningRules) {
      cleanedHtml = this.applyCustomRules(cleanedHtml, customCleaningRules);
    }

    // Handle table extraction separately if requested
    if (includeTables) {
      cleanedHtml = HTMLCleaningService.extractTableText(cleanedHtml);
    }

    // Apply main cleaning strategy
    let cleanedText: string;

    switch (cleaningStrategy) {
      case "aggressive":
        cleanedText = HTMLCleaningService.advancedClean(
          cleanedHtml,
          "aggressive"
        );
        break;
      case "conservative":
        cleanedText = HTMLCleaningService.advancedClean(
          cleanedHtml,
          "conservative"
        );
        break;
      case "balanced":
      default:
        cleanedText = HTMLCleaningService.advancedClean(
          cleanedHtml,
          "balanced"
        );
        break;
    }

    // Handle links if requested
    if (includeLinks) {
      cleanedText = this.preserveLinks(html, cleanedText);
    }

    // Apply length limit if specified
    if (maxContentLength && cleanedText.length > maxContentLength) {
      cleanedText = this.truncateContent(cleanedText, maxContentLength);
    }

    // Final text cleaning pass
    cleanedText = TextCleaningService.cleanText(cleanedText, {
      enablePromptInjectionProtection: false,
      strictSanitization: false,
    });

    return cleanedText;
  }

  /**
   * Apply custom cleaning rules
   */
  private applyCustomRules(
    html: string,
    rules: NonNullable<EnhancedWebScrapingOptions["customCleaningRules"]>
  ): string {
    let result = html;

    // Remove specified elements
    if (rules.removeElements) {
      for (const element of rules.removeElements) {
        const regex = new RegExp(
          `<${element}[^>]*>[\\s\\S]*?<\\/${element}>`,
          "gi"
        );
        result = result.replace(regex, " ");
      }
    }

    // Convert elements to specific text
    if (rules.convertToText) {
      for (const [element, replacement] of Object.entries(
        rules.convertToText
      )) {
        const regex = new RegExp(
          `<${element}[^>]*>([\\s\\S]*?)<\\/${element}>`,
          "gi"
        );
        result = result.replace(regex, replacement);
      }
    }

    return result;
  }

  /**
   * Preserve important links in the cleaned text
   */
  private preserveLinks(originalHtml: string, cleanedText: string): string {
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
    const links: string[] = [];
    let match;

    while ((match = linkRegex.exec(originalHtml)) !== null) {
      const [, href, text] = match;
      if (href && text && href.startsWith("http")) {
        links.push(`[${text.trim()}](${href})`);
      }
    }

    if (links.length > 0) {
      cleanedText += "\n\n**Links:**\n" + links.join("\n");
    }

    return cleanedText;
  }

  /**
   * Intelligently truncate content while preserving structure
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    // Try to cut at paragraph boundaries
    const paragraphs = content.split("\n\n");
    let truncated = "";

    for (const paragraph of paragraphs) {
      if ((truncated + paragraph).length > maxLength - 50) {
        // Leave room for ellipsis
        break;
      }
      truncated += paragraph + "\n\n";
    }

    // If no paragraph boundary found, just cut at word boundary
    if (truncated.length < maxLength * 0.5) {
      const words = content.split(" ");
      truncated = "";
      for (const word of words) {
        if ((truncated + word).length > maxLength - 10) {
          break;
        }
        truncated += word + " ";
      }
    }

    return truncated.trim() + "\n\n[Content truncated...]";
  }

  /**
   * Get recommended cleaning strategy based on content analysis
   */
  public static analyzeContentAndRecommendStrategy(html: string): {
    recommendedStrategy: "aggressive" | "balanced" | "conservative";
    reasons: string[];
    contentAnalysis: {
      htmlLength: number;
      estimatedTokens: number;
      hasComplexStructure: boolean;
      hasImportantTables: boolean;
      hasManyImages: boolean;
      scriptToContentRatio: number;
    };
  } {
    const htmlLength = html.length;
    const estimatedTokens = Math.ceil(htmlLength / 4);

    // Analyze content characteristics
    const scriptMatches = html.match(/<script[\s\S]*?<\/script>/gi) || [];
    const scriptLength = scriptMatches.join("").length;
    const scriptToContentRatio = scriptLength / htmlLength;

    const tableCount = (html.match(/<table[^>]*>/gi) || []).length;
    const imgCount = (html.match(/<img[^>]*>/gi) || []).length;
    const divCount = (html.match(/<div[^>]*>/gi) || []).length;

    const hasComplexStructure = divCount > 50;
    const hasImportantTables = tableCount > 2;
    const hasManyImages = imgCount > 10;

    const contentAnalysis = {
      htmlLength,
      estimatedTokens,
      hasComplexStructure,
      hasImportantTables,
      hasManyImages,
      scriptToContentRatio,
    };

    const reasons: string[] = [];
    let recommendedStrategy: "aggressive" | "balanced" | "conservative";

    // Decision logic
    if (estimatedTokens > 5000 || scriptToContentRatio > 0.3) {
      recommendedStrategy = "aggressive";
      reasons.push("High token count detected");
      if (scriptToContentRatio > 0.3) {
        reasons.push("High script-to-content ratio");
      }
    } else if (hasImportantTables || hasComplexStructure) {
      recommendedStrategy = "conservative";
      reasons.push("Important structural elements detected");
      if (hasImportantTables) {
        reasons.push("Multiple tables found");
      }
    } else {
      recommendedStrategy = "balanced";
      reasons.push("Standard content structure");
    }

    return {
      recommendedStrategy,
      reasons,
      contentAnalysis,
    };
  }
}

export const enhancedWebScrapingService =
  EnhancedWebScrapingService.getInstance();
