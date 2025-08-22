import { loggingService } from "../logging";

export interface HTMLCleaningOptions {
  /** Whether to include JavaScript that contains important operations */
  includeImportantJS?: boolean;
  /** Whether to preserve CSS for styling context */
  preserveCSS?: boolean;
  /** Whether to include data attributes */
  includeDataAttributes?: boolean;
  /** Whether to include ARIA attributes for accessibility */
  includeAriaAttributes?: boolean;
  /** Maximum size of individual script blocks to include (in characters) */
  maxScriptSize?: number;
  /** Whether to include inline event handlers */
  includeEventHandlers?: boolean;
}

export interface CleanedHTMLResult {
  html: string;
  extractedScripts: {
    important: string[];
    filtered: string[];
  };
  metadata: {
    originalSize: number;
    cleanedSize: number;
    compressionRatio: number;
    scriptsProcessed: number;
    importantScriptsFound: number;
  };
}

/**
 * Service for cleaning and optimizing HTML content for LLM consumption
 * Preserves structure and important elements while removing unnecessary bloat
 */
export class HTMLCleaningService {
  private static instance: HTMLCleaningService;
  private logger = loggingService.createComponentLogger("HTMLCleaningService");

  // Patterns to identify important JavaScript
  private static readonly IMPORTANT_JS_PATTERNS = [
    // API and network calls
    /fetch\s*\(/gi,
    /XMLHttpRequest/gi,
    /\.ajax\s*\(/gi,
    /axios\./gi,
    /\$\.get\s*\(/gi,
    /\$\.post\s*\(/gi,
    /\$\.ajax\s*\(/gi,

    // WebSocket and real-time communication
    /WebSocket/gi,
    /socket\.io/gi,
    /EventSource/gi,

    // Form handling and data submission
    /FormData/gi,
    /\.submit\s*\(/gi,
    /\.serialize\s*\(/gi,

    // Authentication and tokens
    /token/gi,
    /auth/gi,
    /login/gi,
    /session/gi,
    /csrf/gi,

    // Local/Session storage operations
    /localStorage/gi,
    /sessionStorage/gi,
    /cookies/gi,

    // Dynamic content loading
    /\.load\s*\(/gi,
    /\.html\s*\(/gi,
    /innerHTML/gi,
    /appendChild/gi,
    /createElement/gi,

    // Event handling that might be important
    /addEventListener/gi,
    /onClick/gi,
    /onSubmit/gi,
    /onChange/gi,

    // JSON operations
    /JSON\.parse/gi,
    /JSON\.stringify/gi,

    // Navigation and routing
    /window\.location/gi,
    /history\.push/gi,
    /router\./gi,

    // Error handling
    /catch\s*\(/gi,
    /throw\s+/gi,
    /Error\(/gi,
  ];

  // Patterns to identify unimportant JavaScript (will be filtered out)
  private static readonly UNIMPORTANT_JS_PATTERNS = [
    // Analytics and tracking
    /google-analytics/gi,
    /gtag\(/gi,
    /ga\(/gi,
    /_gaq/gi,
    /analytics/gi,
    /tracking/gi,
    /mixpanel/gi,
    /segment\./gi,

    // Advertising
    /googletag/gi,
    /doubleclick/gi,
    /adsystem/gi,
    /amazon-adsystem/gi,

    // Social media widgets
    /facebook\.net/gi,
    /connect\.facebook/gi,
    /twitter\.com\/widgets/gi,
    /platform\.linkedin/gi,

    // Chat widgets and support
    /zendesk/gi,
    /intercom/gi,
    /drift/gi,
    /crisp/gi,

    // CDN and library loaders (usually not business logic)
    /cdn\.jsdelivr/gi,
    /unpkg\.com/gi,
    /cdnjs\.cloudflare/gi,

    // Performance monitoring
    /newrelic/gi,
    /sentry/gi,
    /bugsnag/gi,

    // A/B testing
    /optimizely/gi,
    /vwo\.com/gi,

    // Comment systems
    /disqus/gi,
    /livefyre/gi,
  ];

  // HTML elements to preserve with all attributes
  private static readonly IMPORTANT_ELEMENTS = [
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "label",
    "a",
    "nav",
    "header",
    "main",
    "section",
    "article",
    "div",
    "span",
    "table",
    "tr",
    "td",
    "th",
    "tbody",
    "thead",
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
  ];

  // Attributes to always preserve
  private static readonly IMPORTANT_ATTRIBUTES = [
    "id",
    "class",
    "name",
    "type",
    "value",
    "href",
    "src",
    "action",
    "method",
    "for",
    "placeholder",
    "title",
    "role",
    "tabindex",
    "disabled",
    "required",
    "readonly",
  ];

  constructor() {
    this.logger.info("HTMLCleaningService initialized");
  }

  public static getInstance(): HTMLCleaningService {
    if (!HTMLCleaningService.instance) {
      HTMLCleaningService.instance = new HTMLCleaningService();
    }
    return HTMLCleaningService.instance;
  }

  /**
   * Clean HTML content for LLM consumption
   */
  public cleanHTML(
    htmlContent: string,
    options: HTMLCleaningOptions = {}
  ): CleanedHTMLResult {
    const {
      includeImportantJS = true,
      preserveCSS = false,
      includeDataAttributes = true,
      includeAriaAttributes = true,
      maxScriptSize = 2000,
      includeEventHandlers = true,
    } = options;

    const originalSize = htmlContent.length;

    this.logger.info("Starting HTML cleaning process", {
      originalSize: originalSize,
      options,
    });

    console.log("\n🧹 [HTMLCleaning] STARTING CLEANING PROCESS:");
    console.log("=".repeat(60));
    console.log("📏 Original Size:", originalSize, "characters");
    console.log("⚙️ Options:", JSON.stringify(options, null, 2));
    console.log("=".repeat(60));

    let cleanedHTML = htmlContent;

    // Extract and analyze scripts
    const scriptAnalysis = this.extractAndAnalyzeScripts(
      cleanedHTML,
      includeImportantJS,
      maxScriptSize
    );

    console.log("\n🧹 [HTMLCleaning] SCRIPT ANALYSIS:");
    console.log("-".repeat(40));
    console.log("📜 Important Scripts Found:", scriptAnalysis.important.length);
    console.log("🗑️ Filtered Scripts:", scriptAnalysis.filtered.length);
    if (scriptAnalysis.important.length > 0 && scriptAnalysis.important[0]) {
      console.log(
        "✅ Important Script Preview:",
        scriptAnalysis.important[0].substring(0, 100) + "..."
      );
    }
    console.log("-".repeat(40));

    // Remove all script tags first
    cleanedHTML = this.removeScriptTags(cleanedHTML);

    // Remove CSS if not preserving
    if (!preserveCSS) {
      cleanedHTML = this.removeCSS(cleanedHTML);
    }

    // Clean HTML structure
    cleanedHTML = this.cleanHTMLStructure(
      cleanedHTML,
      includeDataAttributes,
      includeAriaAttributes,
      includeEventHandlers
    );

    // Re-inject important scripts if any
    if (includeImportantJS && scriptAnalysis.important.length > 0) {
      cleanedHTML = this.injectImportantScripts(
        cleanedHTML,
        scriptAnalysis.important
      );
    }

    // Final cleanup
    cleanedHTML = this.finalCleanup(cleanedHTML);

    const cleanedSize = cleanedHTML.length;
    const compressionRatio =
      originalSize > 0 ? (originalSize - cleanedSize) / originalSize : 0;

    const result: CleanedHTMLResult = {
      html: cleanedHTML,
      extractedScripts: scriptAnalysis,
      metadata: {
        originalSize,
        cleanedSize,
        compressionRatio,
        scriptsProcessed:
          scriptAnalysis.important.length + scriptAnalysis.filtered.length,
        importantScriptsFound: scriptAnalysis.important.length,
      },
    };

    this.logger.info("HTML cleaning completed", {
      originalSize,
      cleanedSize,
      compressionRatio: Math.round(compressionRatio * 100),
      importantScripts: scriptAnalysis.important.length,
      filteredScripts: scriptAnalysis.filtered.length,
    });

    console.log("\n🧹 [HTMLCleaning] CLEANING COMPLETED:");
    console.log("=".repeat(60));
    console.log("📏 Original Size:", originalSize, "characters");
    console.log("📏 Cleaned Size:", cleanedSize, "characters");
    console.log(
      "📊 Compression Ratio:",
      Math.round(compressionRatio * 100) + "%"
    );
    console.log(
      "📜 Important Scripts Included:",
      scriptAnalysis.important.length
    );
    console.log("🗑️ Scripts Filtered Out:", scriptAnalysis.filtered.length);
    console.log("💾 Size Reduction:", originalSize - cleanedSize, "characters");
    console.log("=".repeat(60));

    return result;
  }

  /**
   * Extract and analyze JavaScript for importance
   */
  private extractAndAnalyzeScripts(
    html: string,
    includeImportantJS: boolean,
    maxScriptSize: number
  ): { important: string[]; filtered: string[] } {
    const important: string[] = [];
    const filtered: string[] = [];

    if (!includeImportantJS) {
      return { important, filtered };
    }

    // Extract all script tags
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = scriptRegex.exec(html)) !== null) {
      const scriptContent = match[1]?.trim() || "";

      // Skip empty scripts
      if (!scriptContent || scriptContent.length === 0) {
        continue;
      }

      // Skip if too large
      if (scriptContent.length > maxScriptSize) {
        filtered.push(
          `[FILTERED: Script too large (${scriptContent.length} chars)]`
        );
        continue;
      }

      // Check if script is unimportant first (these take priority)
      const isUnimportant = HTMLCleaningService.UNIMPORTANT_JS_PATTERNS.some(
        (pattern) => pattern.test(scriptContent)
      );

      if (isUnimportant) {
        filtered.push(`[FILTERED: Analytics/Tracking script]`);
        continue;
      }

      // Check if script contains important patterns
      const isImportant = HTMLCleaningService.IMPORTANT_JS_PATTERNS.some(
        (pattern) => pattern.test(scriptContent)
      );

      if (isImportant) {
        // Clean the script content before including
        const cleanedScript = this.cleanScriptContent(scriptContent);
        important.push(cleanedScript);
      } else {
        filtered.push(`[FILTERED: No important patterns found]`);
      }
    }

    return { important, filtered };
  }

  /**
   * Clean individual script content
   */
  private cleanScriptContent(script: string): string {
    return (
      script
        // Remove comments
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        // Remove console.log statements
        .replace(/console\.(log|debug|info|warn)\s*\([^)]*\);?/g, "")
        // Normalize whitespace
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  /**
   * Remove all script tags from HTML
   */
  private removeScriptTags(html: string): string {
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  }

  /**
   * Remove CSS from HTML
   */
  private removeCSS(html: string): string {
    return (
      html
        // Remove style tags
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        // Remove style attributes (but preserve others)
        .replace(/\s+style\s*=\s*["'][^"']*["']/gi, "")
    );
  }

  /**
   * Clean HTML structure while preserving important elements and attributes
   */
  private cleanHTMLStructure(
    html: string,
    includeDataAttributes: boolean,
    includeAriaAttributes: boolean,
    includeEventHandlers: boolean
  ): string {
    // Use a simple approach since we don't have a full HTML parser
    // This preserves the structure while cleaning attributes

    let cleaned = html;

    // Remove comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

    // Clean up attributes while preserving important ones
    if (!includeEventHandlers) {
      // Remove inline event handlers
      cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
    }

    if (!includeDataAttributes) {
      // Remove data attributes
      cleaned = cleaned.replace(/\s+data-[\w-]+\s*=\s*["'][^"']*["']/gi, "");
    }

    if (!includeAriaAttributes) {
      // Remove aria attributes
      cleaned = cleaned.replace(/\s+aria-[\w-]+\s*=\s*["'][^"']*["']/gi, "");
    }

    return cleaned;
  }

  /**
   * Inject important scripts back into the cleaned HTML
   */
  private injectImportantScripts(
    html: string,
    importantScripts: string[]
  ): string {
    if (importantScripts.length === 0) {
      return html;
    }

    // Add scripts before closing body tag, or at the end if no body tag
    const scriptsHTML = importantScripts
      .map((script) => `<script type="text/javascript">\n${script}\n</script>`)
      .join("\n");

    if (html.includes("</body>")) {
      return html.replace("</body>", `${scriptsHTML}\n</body>`);
    } else {
      return html + "\n" + scriptsHTML;
    }
  }

  /**
   * Final cleanup of the HTML
   */
  private finalCleanup(html: string): string {
    return (
      html
        // Normalize whitespace
        .replace(/\s+/g, " ")
        // Clean up multiple newlines
        .replace(/\n\s*\n/g, "\n")
        // Remove leading/trailing whitespace
        .trim()
    );
  }

  /**
   * Quick method to get a cleaned version with sensible defaults
   */
  public quickClean(htmlContent: string): string {
    const result = this.cleanHTML(htmlContent, {
      includeImportantJS: true,
      preserveCSS: false,
      includeDataAttributes: true,
      includeAriaAttributes: true,
      maxScriptSize: 1500,
      includeEventHandlers: false,
    });

    return result.html;
  }

  /**
   * Get a summary of what would be cleaned without actually cleaning
   */
  public analyzeHTML(htmlContent: string): {
    scriptCount: number;
    importantScripts: number;
    estimatedSizeReduction: number;
    hasInlineCSS: boolean;
    hasExternalCSS: boolean;
  } {
    const scriptMatches =
      htmlContent.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
    const styleMatches =
      htmlContent.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
    const linkCSSMatches =
      htmlContent.match(/<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi) || [];

    const scriptAnalysis = this.extractAndAnalyzeScripts(
      htmlContent,
      true,
      2000
    );

    // Estimate size reduction
    const scriptSize = scriptMatches.join("").length;
    const styleSize = styleMatches.join("").length;
    const estimatedReduction = scriptSize + styleSize;

    return {
      scriptCount: scriptMatches.length,
      importantScripts: scriptAnalysis.important.length,
      estimatedSizeReduction: estimatedReduction,
      hasInlineCSS: styleMatches.length > 0,
      hasExternalCSS: linkCSSMatches.length > 0,
    };
  }
}

// Export singleton instance
export const htmlCleaningService = HTMLCleaningService.getInstance();
