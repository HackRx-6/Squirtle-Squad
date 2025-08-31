import type { Page } from "playwright";
import { loggingService } from "../logging";
import { HTMLCleaningService } from "../cleaning/html.cleaning";
import type { HTMLCleaningOptions } from "../cleaning/html.cleaning";

export class ContentExtractor {
  private logger = loggingService.createComponentLogger("ContentExtractor");
  private htmlCleaning = new HTMLCleaningService();

  /**
   * Enhanced content extraction with HTML cleaning and structure preservation
   * This method extracts more detailed HTML structure while filtering out unnecessary content
   */
  async extractEnhancedPageContent(
    page: Page,
    options: {
      includeHTML?: boolean;
      htmlCleaningOptions?: HTMLCleaningOptions;
      includeInteractiveElements?: boolean;
      maxContentSize?: number;
    } = {}
  ): Promise<{
    title: string;
    text: string;
    html?: string;
    interactiveElements?: {
      forms: Array<{
        id?: string;
        action?: string;
        method?: string;
        inputs: Array<{
          type: string;
          name?: string;
          id?: string;
          placeholder?: string;
          required?: boolean;
        }>;
      }>;
      buttons: Array<{
        text: string;
        id?: string;
        type?: string;
        formAction?: string;
      }>;
      links: Array<{
        text: string;
        href: string;
        id?: string;
      }>;
    };
    metadata: {
      originalHTMLSize?: number;
      cleanedHTMLSize?: number;
      compressionRatio?: number;
      importantScriptsFound?: number;
    };
  }> {
    const {
      includeHTML = true,
      htmlCleaningOptions = {},
      includeInteractiveElements = true,
      maxContentSize = 50000, // 50KB limit
    } = options;

    this.logger.info("Starting enhanced content extraction", {
      includeHTML,
      includeInteractiveElements,
      maxContentSize,
    });

    console.log(
      "\n📋 [ContentExtractor] STARTING ENHANCED CONTENT EXTRACTION:"
    );
    console.log("=".repeat(70));
    console.log("🌐 Page URL:", page.url());
    console.log("🔧 Include HTML:", includeHTML);
    console.log("🎯 Include Interactive Elements:", includeInteractiveElements);
    console.log("📏 Max Content Size:", maxContentSize);
    console.log(
      "⚙️ HTML Cleaning Options:",
      JSON.stringify(htmlCleaningOptions, null, 2)
    );
    console.log("=".repeat(70));

    const startTime = Date.now();

    // Get basic page info
    const title = await page.title();
    const textContent = await page.textContent("body");
    const cleanText = textContent?.replace(/\s+/g, " ").trim() || "";

    const result: any = {
      title,
      text: cleanText,
      metadata: {},
    };

    // Extract and clean HTML if requested
    if (includeHTML) {
      try {
        this.logger.debug("Extracting full HTML content");
        const fullHTML = await page.content();

        if (fullHTML) {
          const originalSize = fullHTML.length;
          result.metadata.originalHTMLSize = originalSize;

          this.logger.debug("Cleaning HTML content", {
            originalSize,
            cleaningOptions: htmlCleaningOptions,
          });

          // Use the HTML cleaning service
          const cleaningResult = this.htmlCleaning.cleanHTML(
            fullHTML,
            htmlCleaningOptions
          );
          const cleanedHTML = cleaningResult.html;

          const cleanedSize = cleanedHTML.length;
          result.metadata.cleanedHTMLSize = cleanedSize;
          result.metadata.compressionRatio = originalSize / cleanedSize;

          // Truncate if too large
          if (cleanedSize > maxContentSize) {
            this.logger.warn("Cleaned HTML exceeds size limit, truncating", {
              cleanedSize,
              maxContentSize,
            });
            result.html = cleanedHTML.substring(0, maxContentSize) + "...";
          } else {
            result.html = cleanedHTML;
          }

          this.logger.info("HTML content processed", {
            originalSize,
            cleanedSize,
            compressionRatio: result.metadata.compressionRatio,
            finalSize: result.html.length,
          });
        }
      } catch (error) {
        this.logger.error("Error during HTML extraction/cleaning", { error });
        // Fallback to basic text content
        result.html = undefined;
      }
    }

    // Extract interactive elements if requested
    if (includeInteractiveElements) {
      try {
        this.logger.debug("Extracting interactive elements");

        // Extract forms with detailed information
        const forms = await page.$$eval("form", (forms) =>
          forms.map((form) => ({
            id: form.id || undefined,
            action: form.action || undefined,
            method: form.method || undefined,
            inputs: Array.from(
              form.querySelectorAll("input, select, textarea")
            ).map((input: any) => ({
              type: input.type || input.tagName.toLowerCase(),
              name: input.name || undefined,
              id: input.id || undefined,
              placeholder: input.placeholder || undefined,
              required: input.required || false,
            })),
          }))
        );

        // Extract buttons with more details
        const buttons = await page.$$eval(
          'button, input[type="button"], input[type="submit"]',
          (buttons) =>
            buttons.map((btn: any) => ({
              text: btn.textContent?.trim() || btn.value || "",
              id: btn.id || undefined,
              type: btn.type || undefined,
              formAction: btn.formAction || undefined,
            }))
        );

        // Extract links with IDs
        const links = await page.$$eval("a[href]", (links) =>
          links
            .map((link: any) => ({
              text: link.textContent?.trim() || "",
              href: link.href,
              id: link.id || undefined,
            }))
            .filter((link) => link.text && link.text.length > 0)
        );

        result.interactiveElements = {
          forms: forms.slice(0, 10), // Limit to prevent excessive data
          buttons: buttons.slice(0, 20),
          links: links.slice(0, 30),
        };

        this.logger.info("Interactive elements extracted", {
          formsCount: forms.length,
          buttonsCount: buttons.length,
          linksCount: links.length,
        });
      } catch (error) {
        this.logger.error("Error during interactive elements extraction", {
          error,
        });
        result.interactiveElements = undefined;
      }
    }

    const extractionTime = Date.now() - startTime;
    this.logger.info("Enhanced content extraction completed", {
      extractionTimeMs: extractionTime,
      titleLength: title.length,
      textLength: cleanText.length,
      htmlIncluded: !!result.html,
      htmlSize: result.html?.length || 0,
    });

    console.log("\n📋 [ContentExtractor] EXTRACTION COMPLETED:");
    console.log("=".repeat(70));
    console.log("⏱️ Extraction Time:", extractionTime + "ms");
    console.log("📰 Page Title:", title);
    console.log("📏 Text Content Length:", cleanText.length);
    console.log("🔗 HTML Included:", !!result.html);
    console.log("📏 HTML Size:", result.html?.length || 0);
    console.log("=".repeat(70));

    // Log the COMPLETE result that will be sent to LLM
    console.log("\n📋 [ContentExtractor] COMPLETE RESULT FOR LLM:");
    console.log("░".repeat(80));
    console.log("🎯 FINAL JSON STRUCTURE SENT TO LLM:");
    console.log(JSON.stringify(result, null, 2));
    console.log("░".repeat(80));
    console.log(
      "📏 Total JSON size:",
      JSON.stringify(result).length,
      "characters"
    );
    console.log("🚀 This COMPLETE JSON will be sent to the LLM\n");

    return result;
  }

  /**
   * Extract basic page content
   */
  async extractBasicPageContent(page: Page): Promise<{
    title: string;
    text: string;
    url: string;
  }> {
    this.logger.debug("Extracting basic page content");

    const title = await page.title();
    const textContent = await page.textContent("body");
    const cleanText = textContent?.replace(/\s+/g, " ").trim() || "";
    const url = page.url();

    this.logger.debug("Basic content extraction completed", {
      titleLength: title.length,
      textLength: cleanText.length,
      url,
    });

    return {
      title,
      text: cleanText,
      url,
    };
  }

  /**
   * Extract page metadata
   */
  async extractPageMetadata(page: Page): Promise<{
    title: string;
    description?: string;
    keywords?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    canonicalUrl?: string;
  }> {
    this.logger.debug("Extracting page metadata");

    const title = await page.title();

    // Extract meta tags using individual element queries to avoid TypeScript issues
    const description = await page
      .$eval('meta[name="description"], meta[property="description"]', (el) =>
        el.getAttribute("content")
      )
      .catch(() => undefined);

    const keywords = await page
      .$eval('meta[name="keywords"], meta[property="keywords"]', (el) =>
        el.getAttribute("content")
      )
      .catch(() => undefined);

    const ogTitle = await page
      .$eval('meta[property="og:title"]', (el) => el.getAttribute("content"))
      .catch(() => undefined);

    const ogDescription = await page
      .$eval('meta[property="og:description"]', (el) =>
        el.getAttribute("content")
      )
      .catch(() => undefined);

    const ogImage = await page
      .$eval('meta[property="og:image"]', (el) => el.getAttribute("content"))
      .catch(() => undefined);

    const canonicalUrl = await page
      .$eval('link[rel="canonical"]', (el) => el.getAttribute("href"))
      .catch(() => undefined);

    const metadata = {
      description,
      keywords,
      ogTitle,
      ogDescription,
      ogImage,
      canonicalUrl,
    };

    this.logger.debug("Page metadata extraction completed", {
      title,
      hasDescription: !!metadata.description,
      hasKeywords: !!metadata.keywords,
      hasOgData: !!(metadata.ogTitle || metadata.ogDescription),
    });

    return {
      title,
      ...metadata,
    };
  }
}
