import { TextCleaningService } from "./text.cleaning";

export class SimpleHTMLCleaningService {
  /**
   * Simple and effective HTML to text conversion that preserves content
   * @param html - Raw HTML content
   * @returns Clean text content
   */
  public static htmlToText(html: string): string {
    if (!html || html.trim().length === 0) {
      return "";
    }

    console.log(
      `🧹 Starting simple HTML cleaning (${html.length} characters)...`
    );
    const startTime = Date.now();

    let text = html;

    // Step 1: Remove script and style tags with their content
    text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
    text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
    text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

    // Step 2: Remove comments
    text = text.replace(/<!--[\s\S]*?-->/g, " ");

    // Step 3: Convert structural elements to text with spacing
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<hr\s*\/?>/gi, "\n---\n");
    text = text.replace(/<p[^>]*>/gi, "\n\n");
    text = text.replace(/<\/p>/gi, "");
    text = text.replace(/<h[1-6][^>]*>/gi, "\n\n");
    text = text.replace(/<\/h[1-6]>/gi, "\n");
    text = text.replace(/<li[^>]*>/gi, "\n• ");
    text = text.replace(/<\/li>/gi, "");
    text = text.replace(/<ul[^>]*>/gi, "\n");
    text = text.replace(/<\/ul>/gi, "\n");
    text = text.replace(/<ol[^>]*>/gi, "\n");
    text = text.replace(/<\/ol>/gi, "\n");
    text = text.replace(/<blockquote[^>]*>/gi, '\n"');
    text = text.replace(/<\/blockquote>/gi, '"\n');

    // Step 4: Remove all remaining HTML tags but preserve content
    text = text.replace(/<[^>]+>/g, " ");

    // Step 5: Clean up HTML entities
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&apos;/g, "'");

    // Step 6: Normalize whitespace and clean up formatting
    text = text.replace(/\s+/g, " ");
    text = text.replace(/\n\s+/g, "\n");
    text = text.replace(/\s+\n/g, "\n");
    text = text.replace(/\n{3,}/g, "\n\n");

    // Clean up repeated bullet points and formatting artifacts
    text = text.replace(/•\s*•\s*•+/g, "");
    text = text.replace(/^\s*•\s*/gm, "");
    text = text.replace(/\n•\s*\n/g, "\n");
    text = text.replace(/\s+\.\s+/g, ". ");

    text = text.trim();

    const endTime = Date.now();
    const originalLength = html.length;
    const cleanedLength = text.length;
    const reductionPercent = (
      ((originalLength - cleanedLength) / originalLength) *
      100
    ).toFixed(1);

    console.log(
      `✅ Simple HTML cleaning completed in ${endTime - startTime}ms`,
      {
        originalLength,
        cleanedLength,
        reductionPercent: `${reductionPercent}%`,
        tokensSaved: Math.floor((originalLength - cleanedLength) / 4),
      }
    );

    return text;
  }

  /**
   * Extract text content starting from a specific element ID or class
   * @param html - Raw HTML content
   * @param selector - Element ID or class to start extraction from
   * @returns Clean text content from the specified element
   */
  public static extractFromElement(html: string, selector: string): string {
    if (!html || html.trim().length === 0) {
      return "";
    }

    console.log(`🎯 Extracting content from element: ${selector}`);

    // Try to find element by ID first
    let idMatch = html.match(
      new RegExp(
        `<[^>]+id=['"]${selector}['"][^>]*>([\\s\\S]*?)(?=<\\/[^>]+>(?:[\\s\\S]*?<\\/(?:html|body)>|$))`,
        "i"
      )
    );

    if (idMatch && idMatch[1]) {
      console.log(
        `📍 Found element by ID: ${selector} (${idMatch[1].length} characters)`
      );
      return this.htmlToText(idMatch[1]);
    }

    // Try to find element by class
    let classMatch = html.match(
      new RegExp(
        `<[^>]+class=['"][^'"]*${selector}[^'"]*['"][^>]*>([\\s\\S]*?)(?=<\\/[^>]+>(?:[\\s\\S]*?<\\/(?:html|body)>|$))`,
        "i"
      )
    );

    if (classMatch && classMatch[1]) {
      console.log(
        `📍 Found element by class: ${selector} (${classMatch[1].length} characters)`
      );
      return this.htmlToText(classMatch[1]);
    }

    console.log(`❌ Element not found: ${selector}, using full HTML`);
    return this.htmlToText(html);
  }

  /**
   * Smart content extraction that tries multiple strategies
   * @param html - Raw HTML content
   * @returns Clean text content using the best available strategy
   */
  public static smartExtract(html: string): string {
    if (!html || html.trim().length === 0) {
      return "";
    }

    // Common content selectors to try
    const contentSelectors = [
      "root",
      "app",
      "main",
      "content",
      "article",
      "post",
      "entry",
      "page-content",
      "main-content",
      "primary-content",
      "container",
    ];

    let bestResult = "";
    let bestLength = 0;

    // Try each selector and keep the one with the most content
    for (const selector of contentSelectors) {
      try {
        const result = this.extractFromElement(html, selector);
        if (result.length > bestLength && result.length > 100) {
          bestResult = result;
          bestLength = result.length;
          console.log(
            `🏆 New best result from ${selector}: ${result.length} characters`
          );
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    // If no good content found, use full HTML
    if (bestLength < 200) {
      console.log(`📄 No good content container found, using full HTML`);
      return this.htmlToText(html);
    }

    return bestResult;
  }
}
