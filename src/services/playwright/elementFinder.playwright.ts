import type { Page, Locator } from "playwright";
import { loggingService } from "../logging";

/**
 * Structured element selector configuration for LLM-generated instructions
 *
 * @example Basic button selector:
 * {
 *   "type": "button",
 *   "identifier": {
 *     "text": "Submit Form"
 *   },
 *   "fallbacks": [
 *     { "attributes": { "type": "submit" } },
 *     { "role": "button", "text": "Submit" }
 *   ]
 * }
 *
 * @example Complex form input:
 * {
 *   "type": "input",
 *   "identifier": {
 *     "name": "email",
 *     "placeholder": "Enter your email"
 *   },
 *   "fallbacks": [
 *     { "attributes": { "type": "email" } },
 *     { "label": "Email Address" }
 *   ]
 * }
 *
 * @example Navigation link:
 * {
 *   "type": "link",
 *   "identifier": {
 *     "text": "About Us",
 *     "href": "/about"
 *   },
 *   "context": {
 *     "parent": "nav",
 *     "position": "header"
 *   }
 * }
 */
export interface StructuredElementSelector {
  /** Primary element type (button, input, link, div, etc.) */
  type: string;

  /** Primary identification strategy - at least one property required */
  identifier: {
    /** Exact text content */
    text?: string;
    /** Partial text match */
    textContains?: string;
    /** Element ID */
    id?: string;
    /** Name attribute */
    name?: string;
    /** Placeholder text */
    placeholder?: string;
    /** ARIA label */
    ariaLabel?: string;
    /** Data test ID */
    testId?: string;
    /** Class name (exact) */
    className?: string;
    /** Class contains */
    classContains?: string;
    /** Custom attributes */
    attributes?: Record<string, string>;
    /** Element role */
    role?: string;
    /** Link href */
    href?: string;
    /** Image alt text */
    alt?: string;
  };

  /** Fallback strategies if primary identifier fails */
  fallbacks?: Array<{
    text?: string;
    textContains?: string;
    id?: string;
    name?: string;
    placeholder?: string;
    ariaLabel?: string;
    testId?: string;
    className?: string;
    classContains?: string;
    attributes?: Record<string, string>;
    role?: string;
    href?: string;
    alt?: string;
    label?: string; // Associated label text
  }>;

  /** Context for more precise targeting */
  context?: {
    /** Parent element type or selector */
    parent?: string;
    /** Position context (header, footer, sidebar, main) */
    position?: string;
    /** Sibling elements */
    siblings?: string[];
    /** Index if multiple similar elements */
    index?: number;
  };

  /** Advanced options */
  options?: {
    /** Wait timeout in milliseconds */
    timeout?: number;
    /** Must be visible */
    visible?: boolean;
    /** Must be enabled */
    enabled?: boolean;
    /** Exact text match */
    exact?: boolean;
    /** Case sensitive matching */
    caseSensitive?: boolean;
  };
}

export interface ElementFindResult {
  element: Locator;
  strategy: string;
  selector: string;
  found: boolean;
  confidence: number; // 0-100 confidence score
}

/**
 * Structured JSON-based element finder for robust LLM-driven web automation
 *
 * Supports structured selectors that LLMs can generate consistently, providing
 * multiple fallback strategies and context-aware element location.
 */
export class ElementFinder {
  private logger = loggingService.createComponentLogger(
    "StructuredElementFinder"
  );

  /**
   * Find an element using structured JSON selector configuration
   *
   * @param page - Playwright page instance
   * @param selectorConfig - Structured selector configuration
   * @returns Element find result with confidence score
   */
  async findElement(
    page: Page,
    selectorConfig: StructuredElementSelector
  ): Promise<ElementFindResult> {
    const timeout = selectorConfig.options?.timeout || 10000;

    this.logger.info("Finding element with structured selector", {
      type: selectorConfig.type,
      identifier: selectorConfig.identifier,
      context: selectorConfig.context,
    });

    console.log("\n🔍 [ElementFinder] FINDING ELEMENT:");
    console.log("▼".repeat(60));
    console.log("🎯 Element Type:", selectorConfig.type);
    console.log(
      "🏷️ Primary Identifier:",
      JSON.stringify(selectorConfig.identifier, null, 2)
    );
    console.log(
      "🔄 Fallback Strategies:",
      selectorConfig.fallbacks?.length || 0
    );
    console.log("🌐 Context:", JSON.stringify(selectorConfig.context, null, 2));
    console.log("⏱️ Timeout:", timeout + "ms");
    console.log("📋 Full Selector Config:");
    console.log(JSON.stringify(selectorConfig, null, 2));
    console.log("▼".repeat(60));

    // Try primary identifier first
    console.log("\n🔍 [ElementFinder] TRYING PRIMARY IDENTIFIER:");
    const primaryResult = await this.trySelector(
      page,
      selectorConfig,
      selectorConfig.identifier,
      "primary"
    );
    if (primaryResult.found) {
      console.log("✅ [ElementFinder] PRIMARY IDENTIFIER SUCCESS!");
      console.log("📊 Confidence: 95%");
      console.log("🔍 Strategy:", primaryResult.strategy);
      console.log("🏗️ Final Selector:", primaryResult.selector);
      return { ...primaryResult, confidence: 95 };
    }
    console.log(
      "❌ [ElementFinder] Primary identifier failed, trying fallbacks..."
    );

    // Try fallback strategies
    if (selectorConfig.fallbacks) {
      for (let i = 0; i < selectorConfig.fallbacks.length; i++) {
        const fallback = selectorConfig.fallbacks[i];
        console.log(
          `\n🔍 [ElementFinder] TRYING FALLBACK ${i + 1}/${
            selectorConfig.fallbacks.length
          }:`
        );
        console.log("🔄 Fallback Config:", JSON.stringify(fallback, null, 2));

        const fallbackResult = await this.trySelector(
          page,
          selectorConfig,
          fallback,
          `fallback-${i + 1}`
        );
        if (fallbackResult.found) {
          const confidence = Math.max(85 - i * 10, 50);
          console.log(`✅ [ElementFinder] FALLBACK ${i + 1} SUCCESS!`);
          console.log("📊 Confidence:", confidence + "%");
          console.log("🔍 Strategy:", fallbackResult.strategy);
          console.log("🏗️ Final Selector:", fallbackResult.selector);
          return { ...fallbackResult, confidence };
        }
        console.log(`❌ [ElementFinder] Fallback ${i + 1} failed`);
      }
    }

    // Final attempt with relaxed matching
    console.log("\n🔍 [ElementFinder] TRYING RELAXED MATCHING (last resort):");
    const relaxedResult = await this.tryRelaxedMatching(page, selectorConfig);
    if (relaxedResult.found) {
      console.log("✅ [ElementFinder] RELAXED MATCHING SUCCESS!");
      console.log("📊 Confidence: 30%");
      console.log("🔍 Strategy:", relaxedResult.strategy);
      console.log("🏗️ Final Selector:", relaxedResult.selector);
      return { ...relaxedResult, confidence: 30 };
    }

    console.log("\n❌ [ElementFinder] COMPLETE FAILURE:");
    console.log("▼".repeat(60));
    console.log("💀 NO ELEMENT FOUND with any strategy");
    console.log("🎯 Searched for:", selectorConfig.type);
    console.log(
      "🏷️ Primary ID:",
      JSON.stringify(selectorConfig.identifier, null, 2)
    );
    console.log("🔄 Tried Fallbacks:", selectorConfig.fallbacks?.length || 0);
    console.log("📊 Final Confidence: 0%");
    console.log("▼".repeat(60));

    this.logger.warn("No element found with structured selector", {
      selectorConfig,
    });
    return {
      element: page.locator("not-found"),
      strategy: "none",
      selector: JSON.stringify(selectorConfig),
      found: false,
      confidence: 0,
    };
  }

  /**
   * Find multiple elements using structured selector
   */
  async findElements(
    page: Page,
    selectorConfig: StructuredElementSelector
  ): Promise<ElementFindResult[]> {
    const results: ElementFindResult[] = [];

    // Build selector and find all matching elements
    const selector = this.buildSelector(
      selectorConfig.type,
      selectorConfig.identifier,
      selectorConfig.context
    );

    try {
      const elements = page.locator(selector);
      const count = await elements.count();

      for (let i = 0; i < count; i++) {
        results.push({
          element: elements.nth(i),
          strategy: "multi-element",
          selector: `${selector}:nth(${i})`,
          found: true,
          confidence: 85,
        });
      }
    } catch (error) {
      this.logger.debug("Failed to find multiple elements", {
        selector,
        error,
      });
    }

    return results;
  }

  /**
   * Try a specific identifier strategy
   */
  private async trySelector(
    page: Page,
    config: StructuredElementSelector,
    identifier: any,
    strategyName: string
  ): Promise<ElementFindResult> {
    const selector = this.buildSelector(
      config.type,
      identifier,
      config.context
    );

    try {
      this.logger.debug(`Trying ${strategyName} strategy`, { selector });

      const element = page.locator(selector);

      // Apply additional filters if specified
      if (config.options?.visible !== false) {
        // For input elements, be more lenient with visibility checks
        if (config.type === "input") {
          await element.waitFor({ state: "attached", timeout: 3000 });
        } else {
          await element.waitFor({ state: "visible", timeout: 3000 });
        }
      }

      if (config.options?.enabled !== false && config.type === "input") {
        await element.waitFor({ state: "attached", timeout: 1000 });
        const isEnabled = await element.isEnabled().catch(() => true);
        if (!isEnabled) {
          throw new Error("Element is disabled");
        }
      }

      this.logger.info(`Element found using ${strategyName} strategy`, {
        selector,
      });

      return {
        element,
        strategy: strategyName,
        selector,
        found: true,
        confidence: 0, // Will be set by caller
      };
    } catch (error) {
      this.logger.debug(`${strategyName} strategy failed`, {
        selector,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`ERROR in ${strategyName} strategy:`, {
        selector,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      return {
        element: page.locator("not-found"),
        strategy: strategyName,
        selector,
        found: false,
        confidence: 0,
      };
    }
  }

  /**
   * Build a Playwright selector from structured configuration
   */
  private buildSelector(type: string, identifier: any, context?: any): string {
    this.logger.debug("Building selector", { type, identifier, context });
    console.log("DEBUG buildSelector:", { type, identifier, context });
    let selector = "";

    // Start with element type if specified
    if (type && type !== "any") {
      selector = type;
    }

    // Add context parent if specified
    if (context?.parent) {
      selector = context.parent + (selector ? ` ${selector}` : " *");
    }

    // Add position context
    if (context?.position) {
      const positionSelectors = {
        header: "header",
        footer: "footer",
        sidebar: '[role="sidebar"], .sidebar, aside',
        main: 'main, [role="main"], .main-content',
      };
      const positionSelector =
        positionSelectors[context.position as keyof typeof positionSelectors];
      if (positionSelector) {
        selector = positionSelector + (selector ? ` ${selector}` : " *");
      }
    }

    const conditions: string[] = [];

    // Build attribute conditions
    if (identifier.id) {
      conditions.push(`[id="${identifier.id}"]`);
    }

    if (identifier.name) {
      conditions.push(`[name="${identifier.name}"]`);
    }

    if (identifier.className) {
      conditions.push(`[class="${identifier.className}"]`);
    }

    if (identifier.classContains) {
      conditions.push(`[class*="${identifier.classContains}"]`);
    }

    if (identifier.placeholder) {
      conditions.push(`[placeholder="${identifier.placeholder}"]`);
    }

    if (identifier.ariaLabel) {
      conditions.push(`[aria-label="${identifier.ariaLabel}"]`);
    }

    if (identifier.testId) {
      conditions.push(`[data-testid="${identifier.testId}"]`);
    }

    if (identifier.role) {
      conditions.push(`[role="${identifier.role}"]`);
    }

    if (identifier.href) {
      conditions.push(`[href*="${identifier.href}"]`);
    }

    if (identifier.alt) {
      conditions.push(`[alt="${identifier.alt}"]`);
    }

    // Handle custom attributes
    if (identifier.attributes) {
      Object.entries(identifier.attributes).forEach(([key, value]) => {
        if (value === "") {
          // Boolean attribute - just check for presence
          conditions.push(`[${key}]`);
        } else {
          // Attribute with value
          conditions.push(`[${key}="${value}"]`);
        }
      });
    }

    // Combine base selector with conditions
    if (conditions.length > 0) {
      selector = (selector || "*") + conditions.join("");
    }

    // Handle text-based selection
    if (identifier.text) {
      if (selector) {
        selector += ` >> text="${identifier.text}"`;
      } else {
        selector = `text="${identifier.text}"`;
      }
    } else if (identifier.textContains) {
      if (selector) {
        selector += ` >> text=/${identifier.textContains}/i`;
      } else {
        selector = `text=/${identifier.textContains}/i`;
      }
    }

    // Handle label association for inputs
    if (
      identifier.label &&
      (type === "input" || type === "textarea" || type === "select")
    ) {
      selector = `label:has-text("${
        identifier.label
      }") >> xpath=following-sibling::${type || "input"}`;
    }

    // Add index if specified
    if (context?.index !== undefined) {
      selector += ` >> nth=${context.index}`;
    }

    const finalSelector = selector || "*";
    this.logger.debug("Built final selector", { finalSelector });
    console.log("DEBUG final selector:", finalSelector);
    return finalSelector;
  }

  /**
   * Try relaxed matching as a last resort
   */
  private async tryRelaxedMatching(
    page: Page,
    config: StructuredElementSelector
  ): Promise<ElementFindResult> {
    const relaxedStrategies: string[] = [];

    // Try partial text matching if text was specified
    if (config.identifier.text) {
      const words = config.identifier.text.split(" ");
      if (words.length > 1) {
        relaxedStrategies.push(`text=/${words[0]}/i`);
        relaxedStrategies.push(`*:has-text("${words[0]}")`);
      }
    }

    // Try element type only
    if (config.type && config.type !== "any") {
      relaxedStrategies.push(config.type);
    }

    // Try any element with specific attributes
    if (config.identifier.className) {
      relaxedStrategies.push(`[class*="${config.identifier.className}"]`);
    }

    for (const strategy of relaxedStrategies) {
      try {
        const element = page.locator(strategy);
        await element.first().waitFor({ state: "visible", timeout: 2000 });

        return {
          element: element.first(),
          strategy: "relaxed-matching",
          selector: strategy,
          found: true,
          confidence: 0, // Will be set by caller
        };
      } catch (error) {
        continue;
      }
    }

    return {
      element: page.locator("not-found"),
      strategy: "relaxed-matching",
      selector: "none",
      found: false,
      confidence: 0,
    };
  }
}

export const elementFinder = new ElementFinder();

/**
 * LLM INSTRUCTIONS FOR STRUCTURED ELEMENT SELECTION
 *
 * When generating element selectors for web automation, use this structured JSON format:
 *
 * BASIC TEMPLATE:
 * {
 *   "type": "button|input|link|div|span|form|...",
 *   "identifier": {
 *     // At least one of these properties is required
 *     "text": "exact text content",
 *     "textContains": "partial text",
 *     "id": "element-id",
 *     "name": "input-name",
 *     "placeholder": "placeholder text",
 *     "className": "exact-class-name",
 *     "classContains": "partial-class",
 *     "testId": "data-testid-value",
 *     "ariaLabel": "accessibility label"
 *   },
 *   "fallbacks": [
 *     // Alternative strategies if primary fails
 *     { "textContains": "partial text" },
 *     { "role": "button" }
 *   ],
 *   "context": {
 *     "parent": "form|nav|header|...",
 *     "position": "header|footer|sidebar|main",
 *     "index": 0  // if multiple similar elements
 *   },
 *   "options": {
 *     "timeout": 10000,
 *     "visible": true,
 *     "exact": false
 *   }
 * }
 *
 * COMMON EXAMPLES:
 *
 * 1. Button with text:
 * {
 *   "type": "button",
 *   "identifier": { "text": "Sign Up" },
 *   "fallbacks": [{ "textContains": "Sign" }]
 * }
 *
 * 2. Email input field:
 * {
 *   "type": "input",
 *   "identifier": { "name": "email" },
 *   "fallbacks": [
 *     { "placeholder": "Email" },
 *     { "attributes": { "type": "email" } }
 *   ]
 * }
 *
 * 3. Navigation link:
 * {
 *   "type": "link",
 *   "identifier": { "text": "About" },
 *   "context": { "parent": "nav" }
 * }
 *
 * 4. Form submit button:
 * {
 *   "type": "button",
 *   "identifier": { "attributes": { "type": "submit" } },
 *   "context": { "parent": "form" }
 * }
 *
 * 5. Specific div by class:
 * {
 *   "type": "div",
 *   "identifier": { "classContains": "content" },
 *   "context": { "position": "main" }
 * }
 *
 * PRIORITY ORDER:
 * 1. Use specific identifiers (id, name, testId) when available
 * 2. Use text content for buttons and links
 * 3. Use semantic attributes (role, aria-label)
 * 4. Use class names and other attributes as fallbacks
 * 5. Always provide context when elements might be ambiguous
 * 6. Include fallback strategies for robust selection
 */
