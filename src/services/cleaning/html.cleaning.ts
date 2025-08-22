import { TextCleaningService } from "./text.cleaning";

export class HTMLCleaningService {
  // Tags that should be completely removed along with their content
  private static readonly REMOVE_WITH_CONTENT = [
    "script",
    "style",
    "nav",
    "footer",
    "header",
    "aside",
    "noscript",
    "iframe",
    "object",
    "embed",
    "applet",
    "form",
    "button",
    "input",
    "select",
    "textarea",
    "label",
    "fieldset",
    "legend",
    "map",
    "area",
    "base",
    "basefont",
    "bgsound",
    "blink",
    "comment",
    "frameset",
    "frame",
    "isindex",
    "link",
    "meta",
    "param",
    "sound",
    "spacer",
    "wbr",
  ];

  // Tags that should be removed but content preserved
  private static readonly REMOVE_TAGS_ONLY = [
    "span",
    "div",
    "section",
    "article",
    "main",
    "figure",
    "figcaption",
    "details",
    "summary",
    "mark",
    "small",
    "del",
    "ins",
    "sub",
    "sup",
    "code",
    "kbd",
    "samp",
    "var",
    "time",
    "data",
    "output",
    "progress",
    "meter",
    "template",
    "slot",
    "canvas",
    "svg",
    "math",
    "ruby",
    "rt",
    "rp",
    "bdi",
    "bdo",
    "abbr",
    "cite",
    "dfn",
    "q",
    "s",
    "u",
    "font",
    "center",
    "big",
    "tt",
    "strike",
    "dir",
    "menu",
    "menuitem",
  ];

  // Tags that should be converted to meaningful text
  private static readonly CONVERT_TO_TEXT = [
    "br",
    "hr",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "dt",
    "dd",
    "blockquote",
    "pre",
    "address",
  ];

  // Tags that should be preserved with their content structure
  private static readonly PRESERVE_STRUCTURE = [
    "ul",
    "ol",
    "dl",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "caption",
    "colgroup",
    "col",
  ];

  /**
   * Extract content from main content containers first
   * @param html - Raw HTML content
   * @param contentSelectors - Array of selectors to look for main content
   * @returns HTML content from main container or original HTML if none found
   */
  public static extractMainContent(
    html: string,
    contentSelectors: string[] = [
      "root",
      "main",
      "content",
      "article",
      "post",
      "entry",
      "page",
      "wrapper",
      "container",
      "body-content",
      "main-content",
      "primary-content",
      "page-content",
    ]
  ): string {
    if (!html || html.trim().length === 0) {
      return html;
    }

    // Try to find content by ID first
    for (const selector of contentSelectors) {
      // Look for elements with specific IDs
      const idRegex = new RegExp(
        `<[^>]+id=['"]${selector}['"][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
        "i"
      );
      const idMatch = html.match(idRegex);
      if (idMatch && idMatch[1]) {
        console.log(`📍 Found main content by ID: ${selector}`);
        return idMatch[1];
      }

      // Look for elements with specific classes
      const classRegex = new RegExp(
        `<[^>]+class=['"][^'"]*${selector}[^'"]*['"][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
        "i"
      );
      const classMatch = html.match(classRegex);
      if (classMatch && classMatch[1]) {
        console.log(`📍 Found main content by class: ${selector}`);
        return classMatch[1];
      }
    }

    // Look for semantic HTML5 elements
    const semanticElements = ["main", "article", "section"];
    for (const element of semanticElements) {
      const regex = new RegExp(
        `<${element}[^>]*>([\\s\\S]*?)<\\/${element}>`,
        "i"
      );
      const match = html.match(regex);
      if (match && match[1]) {
        console.log(`📍 Found main content by semantic element: ${element}`);
        return match[1];
      }
    }

    // Fallback: try to extract body content
    const bodyRegex = /<body[^>]*>([\s\S]*?)<\/body>/i;
    const bodyMatch = html.match(bodyRegex);
    if (bodyMatch && bodyMatch[1]) {
      console.log(`📍 Using body content as fallback`);
      return bodyMatch[1];
    }

    console.log(`📍 No main content container found, using full HTML`);
    return html;
  }

  /**
   * Clean HTML content by removing unnecessary tags and empty nested elements
   * @param html - Raw HTML content
   * @param options - Cleaning options
   * @returns Cleaned text content optimized for LLM processing
   */
  public static cleanHTML(
    html: string,
    options: {
      preserveFormatting?: boolean;
      aggressiveCleanup?: boolean;
      maxEmptyLevels?: number;
      extractMainContent?: boolean;
      contentSelectors?: string[];
    } = {}
  ): string {
    const {
      preserveFormatting = true,
      aggressiveCleanup = true,
      maxEmptyLevels = 3,
      extractMainContent = true,
      contentSelectors = [
        "root",
        "main",
        "content",
        "article",
        "post",
        "entry",
        "page",
      ],
    } = options;

    if (!html || html.trim().length === 0) {
      return "";
    }

    console.log(`🧹 Starting HTML cleaning (${html.length} characters)...`);
    const startTime = Date.now();

    let cleanedHtml = html;

    // Step 0: Extract main content if enabled
    if (extractMainContent) {
      cleanedHtml = this.extractMainContent(cleanedHtml, contentSelectors);
      console.log(
        `📍 After main content extraction: ${cleanedHtml.length} characters`
      );
    }

    // Step 1: Remove comments
    cleanedHtml = this.removeComments(cleanedHtml);

    // Step 2: Remove tags with their content
    cleanedHtml = this.removeTagsWithContent(cleanedHtml);

    // Step 3: Convert structural tags to meaningful text
    cleanedHtml = this.convertStructuralTags(cleanedHtml, preserveFormatting);

    // Step 4: Remove empty nested elements
    if (aggressiveCleanup) {
      cleanedHtml = this.removeEmptyNestedElements(cleanedHtml, maxEmptyLevels);
    }

    // Step 5: Remove remaining unwanted tags but preserve content
    cleanedHtml = this.removeUnwantedTags(cleanedHtml);

    // Step 6: Clean up whitespace and HTML entities
    cleanedHtml = this.cleanupHtmlEntities(cleanedHtml);

    // Step 7: Apply final text cleaning using existing service
    const finalText = TextCleaningService.cleanText(cleanedHtml, {
      enablePromptInjectionProtection: false, // HTML is not user input
      strictSanitization: false,
    });

    const endTime = Date.now();
    const originalLength = html.length;
    const cleanedLength = finalText.length;
    const reductionPercent = (
      ((originalLength - cleanedLength) / originalLength) *
      100
    ).toFixed(1);

    console.log(`✅ HTML cleaning completed in ${endTime - startTime}ms`, {
      originalLength,
      cleanedLength,
      reductionPercent: `${reductionPercent}%`,
      tokensSaved: Math.floor((originalLength - cleanedLength) / 4), // Rough token estimation
    });

    return finalText;
  }

  /**
   * Remove HTML comments
   */
  private static removeComments(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, "");
  }

  /**
   * Remove tags along with their content
   */
  private static removeTagsWithContent(html: string): string {
    let result = html;

    for (const tag of this.REMOVE_WITH_CONTENT) {
      // Remove opening and closing tags with all content in between
      const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
      result = result.replace(regex, " ");

      // Remove self-closing tags
      const selfClosingRegex = new RegExp(`<${tag}[^>]*\\/>`, "gi");
      result = result.replace(selfClosingRegex, "");
    }

    return result;
  }

  /**
   * Convert structural tags to meaningful text
   */
  private static convertStructuralTags(
    html: string,
    preserveFormatting: boolean
  ): string {
    let result = html;

    if (preserveFormatting) {
      // Convert headers to text with emphasis
      result = result.replace(/<h([1-6])[^>]*>/gi, "\n\n");
      result = result.replace(/<\/h[1-6]>/gi, "\n");

      // Convert paragraphs
      result = result.replace(/<p[^>]*>/gi, "\n\n");
      result = result.replace(/<\/p>/gi, "");

      // Convert line breaks
      result = result.replace(/<br[^>]*\/?>/gi, "\n");
      result = result.replace(/<hr[^>]*\/?>/gi, "\n---\n");

      // Convert list items
      result = result.replace(/<li[^>]*>/gi, "\n• ");
      result = result.replace(/<\/li>/gi, "");

      // Convert definition terms and descriptions
      result = result.replace(/<dt[^>]*>/gi, "\n");
      result = result.replace(/<\/dt>/gi, ": ");
      result = result.replace(/<dd[^>]*>/gi, "");
      result = result.replace(/<\/dd>/gi, "\n");

      // Convert blockquotes
      result = result.replace(/<blockquote[^>]*>/gi, '\n"');
      result = result.replace(/<\/blockquote>/gi, '"\n');

      // Convert preformatted text
      result = result.replace(/<pre[^>]*>/gi, "\n```\n");
      result = result.replace(/<\/pre>/gi, "\n```\n");

      // Convert address
      result = result.replace(/<address[^>]*>/gi, "\n");
      result = result.replace(/<\/address>/gi, "\n");
    } else {
      // Simple conversion - just add spaces
      for (const tag of this.CONVERT_TO_TEXT) {
        const regex = new RegExp(`<\\/?${tag}[^>]*>`, "gi");
        result = result.replace(regex, " ");
      }
    }

    return result;
  }

  /**
   * Remove empty nested elements that don't contribute to content
   */
  private static removeEmptyNestedElements(
    html: string,
    maxLevels: number
  ): string {
    let result = html;
    let previousLength = 0;
    let iterations = 0;

    // Keep removing empty elements until no more can be removed or max iterations reached
    while (result.length !== previousLength && iterations < maxLevels) {
      previousLength = result.length;

      // Only remove truly empty elements (no text content, only whitespace/nbsp)
      result = result.replace(
        /<(div|span|section|article|aside|main|figure|figcaption)[^>]*>[\s&nbsp;]*<\/\1>/gi,
        " "
      );

      // Remove nested empty elements that only contain other empty elements
      result = result.replace(
        /<(div|span|section|article|aside|main|figure|figcaption)[^>]*>\s*(<(div|span|section|article|aside|main|figure|figcaption)[^>]*>[\s&nbsp;]*<\/\3>\s*)+<\/\1>/gi,
        " "
      );

      iterations++;
    }

    return result;
  }

  /**
   * Remove unwanted tags but preserve their content
   */
  private static removeUnwantedTags(html: string): string {
    let result = html;

    for (const tag of this.REMOVE_TAGS_ONLY) {
      // Remove opening and closing tags but preserve content
      const openingRegex = new RegExp(`<${tag}[^>]*>`, "gi");
      const closingRegex = new RegExp(`<\\/${tag}>`, "gi");

      result = result.replace(openingRegex, " ");
      result = result.replace(closingRegex, " ");
    }

    // Remove any remaining HTML tags (catch-all)
    result = result.replace(/<[^>]+>/g, " ");

    return result;
  }

  /**
   * Clean up HTML entities and normalize whitespace
   */
  private static cleanupHtmlEntities(html: string): string {
    let result = html;

    // Common HTML entities
    const entities: Record<string, string> = {
      "&nbsp;": " ",
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
      "&apos;": "'",
      "&copy;": "©",
      "&reg;": "®",
      "&trade;": "™",
      "&ndash;": "–",
      "&mdash;": "—",
      "&lsquo;": "\u2018", // Left single quotation mark
      "&rsquo;": "\u2019", // Right single quotation mark
      "&ldquo;": "\u201C", // Left double quotation mark
      "&rdquo;": "\u201D", // Right double quotation mark
      "&hellip;": "…",
      "&bull;": "•",
    };

    // Replace HTML entities
    for (const [entity, replacement] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, "g"), replacement);
    }

    // Handle numeric entities (e.g., &#123;, &#x1F;)
    result = result.replace(/&#(\d+);/g, (match, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return " ";
      }
    });

    result = result.replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return " ";
      }
    });

    return result;
  }

  /**
   * Extract clean text from table structures
   */
  public static extractTableText(html: string): string {
    let result = html;

    // Convert table structure to readable text
    result = result.replace(/<table[^>]*>/gi, "\n[TABLE]\n");
    result = result.replace(/<\/table>/gi, "\n[/TABLE]\n");
    result = result.replace(/<tr[^>]*>/gi, "\n");
    result = result.replace(/<\/tr>/gi, "");
    result = result.replace(/<t[hd][^>]*>/gi, " | ");
    result = result.replace(/<\/t[hd]>/gi, "");
    result = result.replace(/<thead[^>]*>/gi, "\n");
    result = result.replace(/<\/thead>/gi, "\n---\n");
    result = result.replace(/<tbody[^>]*>/gi, "");
    result = result.replace(/<\/tbody>/gi, "");
    result = result.replace(/<tfoot[^>]*>/gi, "\n---\n");
    result = result.replace(/<\/tfoot>/gi, "");

    return result;
  }

  /**
   * Get HTML cleaning statistics
   */
  public static getCleaningStats(originalHtml: string, cleanedText: string) {
    const originalLength = originalHtml.length;
    const cleanedLength = cleanedText.length;
    const reductionPercent = (
      ((originalLength - cleanedLength) / originalLength) *
      100
    ).toFixed(1);

    // Estimate token reduction (rough approximation: 1 token ≈ 4 characters)
    const estimatedOriginalTokens = Math.ceil(originalLength / 4);
    const estimatedCleanedTokens = Math.ceil(cleanedLength / 4);
    const tokensReduced = estimatedOriginalTokens - estimatedCleanedTokens;

    return {
      originalLength,
      cleanedLength,
      charactersRemoved: originalLength - cleanedLength,
      reductionPercent: `${reductionPercent}%`,
      estimatedOriginalTokens,
      estimatedCleanedTokens,
      tokensReduced,
      tokenReductionPercent: `${(
        (tokensReduced / estimatedOriginalTokens) *
        100
      ).toFixed(1)}%`,
    };
  }

  /**
   * Advanced HTML cleaning with content extraction strategies
   */
  public static advancedClean(
    html: string,
    strategy: "aggressive" | "balanced" | "conservative" = "balanced"
  ): string {
    const strategies = {
      aggressive: {
        preserveFormatting: false,
        aggressiveCleanup: true,
        maxEmptyLevels: 5,
        extractMainContent: true,
        contentSelectors: [
          "root",
          "main",
          "content",
          "article",
          "post",
          "entry",
          "page",
          "wrapper",
          "container",
        ],
      },
      balanced: {
        preserveFormatting: true,
        aggressiveCleanup: true,
        maxEmptyLevels: 3,
        extractMainContent: true,
        contentSelectors: ["root", "main", "content", "article", "post"],
      },
      conservative: {
        preserveFormatting: true,
        aggressiveCleanup: false,
        maxEmptyLevels: 1,
        extractMainContent: true,
        contentSelectors: ["main", "article"],
      },
    };

    return this.cleanHTML(html, strategies[strategy]);
  }
}
