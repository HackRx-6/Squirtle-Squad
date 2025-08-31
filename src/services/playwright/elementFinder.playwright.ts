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
 * 
 * 🚨 CRITICAL FIX: Enhanced DOM Distillation for Multiple Element Disambiguation
 * 
 * This implementation solves the "Exit vs Submit button" problem through:
 * 
 * 1. **Robust Rule-Based Selection**: Primary disambiguation logic that heavily
 *    penalizes semantically opposite actions (Exit when looking for Submit)
 * 
 * 2. **Confidence-Based Strategy**: Uses rule-based selection for high-confidence
 *    cases (>70%) and only falls back to LLM for ambiguous cases
 * 
 * 3. **Enhanced Scoring System**: 
 *    - +25 points for exact text matches
 *    - +20 points for semantic action matches (Submit button for submit action)
 *    - -50 points penalty for opposite actions (Exit button when looking for Submit)
 *    - +15 points for correct button types (type="submit")
 *    - +10 points for proper context (submit buttons in forms)
 * 
 * 4. **Critical Action Protection**: Special handling for critical actions like
 *    Submit, Save, Continue to prevent catastrophic wrong button clicks
 * 
 * 5. **Detailed Logging**: Comprehensive logging shows exactly why each element
 *    was scored and which one was selected for debugging
 * 
 * This prevents the agent from getting stuck in loops by clicking "Exit" instead
 * of "Submit" buttons, which was the core issue causing automation failures.
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

      // Check if multiple elements match this selector
      const elementCount = await element.count();
      
      if (elementCount > 1) {
        console.log(`\n� [ElementFinder] MULTIPLE ELEMENTS DETECTED!`);
        console.log(`🔍 Found ${elementCount} elements matching: ${selector}`);
        console.log(`🎯 Target: ${config.type} with "${JSON.stringify(config.identifier)}"`);
        console.log(`🧠 Initiating DOM Distillation and LLM disambiguation...`);
        
        // Log each element for debugging
        for (let i = 0; i < elementCount; i++) {
          try {
            const currentElement = element.nth(i);
            const text = await currentElement.textContent() || '';
            const tagName = await currentElement.evaluate('el => el.tagName.toLowerCase()') as string;
            console.log(`   ${i + 1}. <${tagName}> "${text.trim()}"`);
          } catch (e) {
            console.log(`   ${i + 1}. [Unable to inspect element]`);
          }
        }
        
        // Collect all matching elements
        const elements: Locator[] = [];
        for (let i = 0; i < elementCount; i++) {
          elements.push(element.nth(i));
        }
        
        // Use the disambiguation method
        return await this.handleMultipleMatches(page, elements, config, strategyName);
      }

      // Single element found - proceed with normal validation
      if (elementCount === 0) {
        throw new Error("No elements found");
      }

      // Apply additional filters if specified
      if (config.options?.visible !== false) {
        // For input elements, be more lenient with visibility checks
        if (config.type === "input") {
          await element.waitFor({ state: "attached", timeout: 6000 });
        } else {
          await element.waitFor({ state: "visible", timeout: 6000 });
        }
      }

      if (config.options?.enabled !== false && config.type === "input") {
        await element.waitFor({ state: "attached", timeout: 1000 });
        const isEnabled = await element.isEnabled().catch(() => true);
        if (!isEnabled) {
          throw new Error("Element is disabled");
        }
      }

      this.logger.info(`Single element found using ${strategyName} strategy`, {
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

  /**
   * Handle multiple element matches with LLM disambiguation
   */
  private async handleMultipleMatches(
    page: Page,
    elements: Locator[],
    selectorConfig: StructuredElementSelector,
    strategy: string
  ): Promise<ElementFindResult> {
    if (elements.length === 0) {
      return {
        element: page.locator("not-found"),
        strategy: "no-elements",
        selector: "none",
        found: false,
        confidence: 0,
      };
    }

    console.log(`\n🔍 [ElementFinder] MULTIPLE ELEMENTS FOUND (${elements.length})`);
    console.log("🧠 Starting DOM Distillation and LLM disambiguation...");

    // Step 1: Distill element information
    const distilledElements = await this.distillElementInformation(elements);
    
    console.log("\n📊 [ElementFinder] DISTILLED ELEMENT INFORMATION:");
    distilledElements.forEach((element, index) => {
      console.log(`Element ${index + 1}:`);
      console.log(`  Text: "${element.textContent}"`);
      console.log(`  Tag: ${element.context.tagName}`);
      console.log(`  Attributes:`, element.attributes);
      console.log(`  Parent: ${element.context.parentInfo}`);
    });

    // Step 2: Always run rule-based selection first as it's more reliable
    const ruleBasedIndex = this.ruleBasedSelection(distilledElements, selectorConfig);
    console.log(`\n🎯 [ElementFinder] Rule-based selection chose element ${ruleBasedIndex + 1}`);
    
    // Step 3: Validate rule-based selection with confidence scoring
    const ruleBasedConfidence = this.calculateSelectionConfidence(
      distilledElements[ruleBasedIndex], 
      selectorConfig, 
      distilledElements
    );
    
    console.log(`📊 [ElementFinder] Rule-based confidence: ${ruleBasedConfidence}%`);
    
    // If rule-based selection has high confidence (>70%), use it
    if (ruleBasedConfidence >= 70 && ruleBasedIndex >= 0 && ruleBasedIndex < elements.length) {
      const selectedElement = elements[ruleBasedIndex];
      if (selectedElement) {
        console.log(`✅ [ElementFinder] Using high-confidence rule-based selection`);
        return {
          element: selectedElement,
          strategy: `${strategy}-rule-based-high-confidence`,
          selector: await this.buildElementSelector(selectedElement),
          found: true,
          confidence: ruleBasedConfidence,
        };
      }
    }
    
    // Step 4: Try LLM disambiguation only for lower confidence cases
    try {
      const selectedIndex = await this.selectBestElement(
        distilledElements,
        selectorConfig,
        strategy
      );

      if (selectedIndex !== -1 && selectedIndex < elements.length) {
        console.log(`✅ [ElementFinder] LLM selected element ${selectedIndex + 1}`);
        const selectedElement = elements[selectedIndex];
        if (selectedElement) {
          const selector = await this.buildElementSelector(selectedElement);
          
          return {
            element: selectedElement,
            strategy: `${strategy}-llm-disambiguated`,
            selector,
            found: true,
            confidence: 85, // High confidence due to LLM reasoning
          };
        }
      }
    } catch (error) {
      console.log("❌ [ElementFinder] LLM disambiguation failed:", error);
    }

    // Step 5: Fall back to rule-based selection even with lower confidence
    if (ruleBasedIndex >= 0 && ruleBasedIndex < elements.length) {
      const selectedElement = elements[ruleBasedIndex];
      if (selectedElement) {
        console.log(`🔄 [ElementFinder] Falling back to rule-based selection`);
        return {
          element: selectedElement,
          strategy: `${strategy}-rule-based-fallback`,
          selector: await this.buildElementSelector(selectedElement),
          found: true,
          confidence: Math.max(ruleBasedConfidence, 50), // Ensure minimum confidence
        };
      }
    }

    // Step 6: Only if everything fails, fall back to the first element
    console.log("⚠️ [ElementFinder] All disambiguation methods failed, using first element as last resort");
    const fallbackElement = elements[0];
    if (fallbackElement) {
      return {
        element: fallbackElement,
        strategy: `${strategy}-fallback-first`,
        selector: await this.buildElementSelector(fallbackElement),
        found: true,
        confidence: 30, // Very low confidence
      };
    }

    // No valid elements found
    return {
      element: page.locator("not-found"),
      strategy: "no-valid-elements",
      selector: "none",
      found: false,
      confidence: 0,
    };
  }

  /**
   * Distill element information for LLM analysis
   */
  private async distillElementInformation(elements: Locator[]): Promise<Array<{
    index: number;
    textContent: string;
    attributes: Record<string, string>;
    context: {
      tagName: string;
      parentInfo: string;
      siblingInfo: string;
      position: { x: number; y: number };
    };
  }>> {
    const distilled: Array<{
      index: number;
      textContent: string;
      attributes: Record<string, string>;
      context: {
        tagName: string;
        parentInfo: string;
        siblingInfo: string;
        position: { x: number; y: number };
      };
    }> = [];

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      
      if (!element) continue;

      try {
        // Extract key information
        const textContent = (await element.textContent()) || '';
        const tagName = (await element.evaluate('el => el.tagName.toLowerCase()')) as string;
        
        // Get relevant attributes
        const attributes: Record<string, string> = {};
        const attrNames = ['id', 'class', 'name', 'type', 'placeholder', 'aria-label', 'role', 'href', 'alt', 'value'];
        
        for (const attr of attrNames) {
          const value = await element.getAttribute(attr);
          if (value) attributes[attr] = value;
        }

        // Get context information
        const parentInfo = (await element.evaluate('el => {' +
          'const parent = el.parentElement;' +
          'return parent ? `${parent.tagName.toLowerCase()}${parent.id ? "#" + parent.id : ""}${parent.className ? "." + parent.className.split(" ")[0] : ""}` : "none";' +
        '}')) as string;

        const siblingInfo = (await element.evaluate('el => {' +
          'const siblings = Array.from(el.parentElement?.children || []);' +
          'const index = siblings.indexOf(el);' +
          'return `${index + 1} of ${siblings.length}`;' +
        '}')) as string;

        const position = (await element.boundingBox()) || { x: 0, y: 0, width: 0, height: 0 };

        distilled.push({
          index: i,
          textContent: textContent.trim().substring(0, 100), // Limit text length
          attributes,
          context: {
            tagName: tagName || 'unknown',
            parentInfo: parentInfo || 'unknown',
            siblingInfo: siblingInfo || 'unknown',
            position: { x: Math.round(position.x), y: Math.round(position.y) },
          }
        });
      } catch (error) {
        // If we can't get info for an element, mark it as problematic
        distilled.push({
          index: i,
          textContent: '',
          attributes: {},
          context: {
            tagName: 'unknown',
            parentInfo: 'unknown',
            siblingInfo: 'unknown',
            position: { x: 0, y: 0 },
          }
        });
      }
    }

    return distilled;
  }

  /**
   * Use LLM reasoning to select the best element
   */
  private async selectBestElement(
    distilledElements: Array<{
      index: number;
      textContent: string;
      attributes: Record<string, string>;
      context: any;
    }>,
    selectorConfig: StructuredElementSelector,
    strategy: string
  ): Promise<number> {
    // Create a structured prompt for the LLM
    const prompt = this.buildDisambiguationPrompt(distilledElements, selectorConfig, strategy);
    
    console.log("\n🧠 [ElementFinder] LLM Disambiguation Prompt:");
    console.log("▼".repeat(80));
    console.log(prompt);
    console.log("▼".repeat(80));

    try {
      // First try calling an actual LLM service if available
      const llmResult = await this.callLLMService(prompt, distilledElements.length);
      if (llmResult !== -1) {
        console.log(`🤖 [ElementFinder] LLM service selected element ${llmResult + 1}`);
        return llmResult;
      }
    } catch (error) {
      console.log("❌ [ElementFinder] LLM service call failed:", error);
    }

    // Fallback to rule-based selection
    console.log("🔄 [ElementFinder] Using rule-based selection as fallback");
    return this.ruleBasedSelection(distilledElements, selectorConfig);
  }

  /**
   * Call LLM service for element disambiguation
   */
  private async callLLMService(prompt: string, elementCount: number): Promise<number> {
    try {
      // This would integrate with your LLM service
      // For now, we'll use a mock implementation that you can replace
      
      // Try to import LLM service if available
      try {
        const llmModule = await import('../LLM');
        if (llmModule && 'llmService' in llmModule && llmModule.llmService) {
          const response = await (llmModule.llmService as any).generateResponse(prompt, {
            maxTokens: 50,
            temperature: 0.1, // Low temperature for more deterministic results
            systemPrompt: "You are an expert web automation assistant. Respond with only the number of the best element choice."
          });

          // Parse the response to get the element number
          const match = response.match(/\b(\d+)\b/);
          if (match) {
            const selectedNumber = parseInt(match[1], 10);
            if (selectedNumber >= 1 && selectedNumber <= elementCount) {
              return selectedNumber - 1; // Convert to 0-based index
            }
          }
        }
      } catch (importError) {
        console.log("📝 [ElementFinder] LLM service not available, using rule-based selection");
      }
      
      return -1; // LLM service not available or invalid response
    } catch (error) {
      console.log("🚫 [ElementFinder] LLM service error:", error);
      return -1;
    }
  }

  /**
   * Build a structured prompt for LLM disambiguation
   */
  private buildDisambiguationPrompt(
    distilledElements: Array<any>,
    selectorConfig: StructuredElementSelector,
    strategy: string
  ): string {
    const targetDescription = JSON.stringify(selectorConfig.identifier, null, 2);
    
    let prompt = `CRITICAL WEB AUTOMATION ELEMENT DISAMBIGUATION\n\n`;
    prompt += `I found ${distilledElements.length} elements that match the selector for a ${selectorConfig.type} element.\n`;
    prompt += `Target criteria: ${targetDescription}\n\n`;
    
    // Add specific guidance for common disambiguation scenarios
    const targetText = selectorConfig.identifier.text?.toLowerCase() || '';
    if (targetText.includes('submit')) {
      prompt += `⚠️ CRITICAL: This is a SUBMIT action. You must avoid Exit/Cancel/Close buttons at all costs!\n`;
      prompt += `Look for buttons with text exactly matching "Submit" or buttons with type="submit".\n`;
      prompt += `NEVER select Exit, Cancel, Close, Back, or similar negative actions.\n\n`;
    } else if (targetText.includes('save')) {
      prompt += `⚠️ CRITICAL: This is a SAVE action. Avoid Delete/Cancel/Discard buttons.\n\n`;
    } else if (targetText.includes('continue') || targetText.includes('next')) {
      prompt += `⚠️ CRITICAL: This is a FORWARD action. Avoid Back/Previous/Cancel buttons.\n\n`;
    }

    prompt += `ELEMENT OPTIONS:\n\n`;

    distilledElements.forEach((element, index) => {
      prompt += `Element ${index + 1}:\n`;
      prompt += `  Text Content: "${element.textContent}"\n`;
      prompt += `  Tag: ${element.context.tagName}\n`;
      prompt += `  Attributes: ${JSON.stringify(element.attributes, null, 4)}\n`;
      prompt += `  Parent: ${element.context.parentInfo}\n`;
      prompt += `  Position: ${element.context.siblingInfo}\n`;
      prompt += `  Screen Position: (${element.context.position.x}, ${element.context.position.y})\n`;
      
      // Add warning flags for problematic buttons
      if (targetText.includes('submit') && 
          (element.textContent.toLowerCase().includes('exit') || 
           element.textContent.toLowerCase().includes('cancel') ||
           element.textContent.toLowerCase().includes('close'))) {
        prompt += `  ⚠️ WARNING: This appears to be a negative action button - NOT suitable for submit!\n`;
      }
      prompt += `\n`;
    });

    prompt += `SELECTION CRITERIA (in priority order):\n`;
    prompt += `1. EXACT text match with target\n`;
    prompt += `2. Avoid buttons with conflicting semantics (Exit vs Submit)\n`;
    prompt += `3. Prefer buttons with type="submit" for submit actions\n`;
    prompt += `4. Consider parent context (forms for submit buttons)\n`;
    prompt += `5. Check CSS classes for semantic hints (primary, secondary, danger)\n`;
    prompt += `6. Element position and visibility\n\n`;

    prompt += `RESPOND WITH ONLY THE NUMBER (1-${distilledElements.length}) of the most appropriate element.\n`;
    prompt += `If unsure, prioritize exact text matches and avoid semantically opposite actions.`;

    return prompt;
  }

  /**
   * Rule-based fallback selection when LLM is unavailable
   */
  private ruleBasedSelection(
    distilledElements: Array<any>,
    selectorConfig: StructuredElementSelector
  ): number {
    const identifier = selectorConfig.identifier;
    let bestScore = -1;
    let bestIndex = 0;

    console.log(`\n🎯 [ElementFinder] RULE-BASED SELECTION ANALYSIS:`);

    distilledElements.forEach((element, index) => {
      let score = 0;
      const scoreBreakdown: string[] = [];

      // Score based on text content match
      if (identifier.text && element.textContent.includes(identifier.text)) {
        score += 10;
        scoreBreakdown.push(`text match (+10)`);
        
        // Special handling for common button scenarios
        if (selectorConfig.type === 'button' || element.context.tagName === 'button') {
          const text = element.textContent.toLowerCase().trim();
          const targetText = identifier.text.toLowerCase().trim();
          
          // Heavily favor exact matches for critical actions
          if (text === targetText) {
            score += 25;
            scoreBreakdown.push(`exact text match (+25)`);
          }
          
          // Critical: Handle Submit vs Exit disambiguation
          if (targetText.includes('submit')) {
            if (text.includes('submit')) {
              score += 20;
              scoreBreakdown.push(`submit button match (+20)`);
            } else if (text.includes('exit') || text.includes('cancel') || text.includes('close') || text.includes('back')) {
              score -= 50; // Heavy penalty for negative actions when looking for submit
              scoreBreakdown.push(`negative action penalty (-50)`);
            }
          }
          
          // Similar logic for other action types
          if (targetText.includes('save')) {
            if (text.includes('save')) {
              score += 20;
              scoreBreakdown.push(`save button match (+20)`);
            } else if (text.includes('delete') || text.includes('cancel') || text.includes('discard')) {
              score -= 30;
              scoreBreakdown.push(`destructive action penalty (-30)`);
            }
          }
          
          if (targetText.includes('continue') || targetText.includes('next')) {
            if (text.includes('continue') || text.includes('next') || text.includes('proceed')) {
              score += 20;
              scoreBreakdown.push(`continue action match (+20)`);
            } else if (text.includes('back') || text.includes('previous') || text.includes('cancel')) {
              score -= 30;
              scoreBreakdown.push(`backward action penalty (-30)`);
            }
          }
        }
      }
      
      if (identifier.textContains && element.textContent.includes(identifier.textContains)) {
        score += 8;
        scoreBreakdown.push(`text contains (+8)`);
      }

      // Score based on attribute matches
      if (identifier.id && element.attributes.id === identifier.id) {
        score += 15;
        scoreBreakdown.push(`id match (+15)`);
      }
      if (identifier.name && element.attributes.name === identifier.name) {
        score += 12;
        scoreBreakdown.push(`name match (+12)`);
      }
      if (identifier.className && element.attributes.class?.includes(identifier.className)) {
        score += 8;
        scoreBreakdown.push(`class match (+8)`);
      }
      if (identifier.classContains && element.attributes.class?.includes(identifier.classContains)) {
        score += 6;
        scoreBreakdown.push(`class contains (+6)`);
      }
      if (identifier.testId && element.attributes['data-testid'] === identifier.testId) {
        score += 15;
        scoreBreakdown.push(`testId match (+15)`);
      }
      if (identifier.placeholder && element.attributes.placeholder === identifier.placeholder) {
        score += 10;
        scoreBreakdown.push(`placeholder match (+10)`);
      }
      if (identifier.ariaLabel && element.attributes['aria-label'] === identifier.ariaLabel) {
        score += 10;
        scoreBreakdown.push(`aria-label match (+10)`);
      }

      // Additional button-specific scoring
      if ((selectorConfig.type === 'button' || element.context.tagName === 'button') && element.attributes.type) {
        const buttonType = element.attributes.type.toLowerCase();
        if (buttonType === 'submit' && identifier.text?.toLowerCase().includes('submit')) {
          score += 15; // Strong favor for submit type buttons when looking for submit
          scoreBreakdown.push(`submit type button (+15)`);
        }
      }

      // Context-based scoring
      if (element.context.parentInfo) {
        const parentInfo = element.context.parentInfo.toLowerCase();
        // Prefer buttons inside forms when looking for submit
        if (parentInfo.includes('form') && identifier.text?.toLowerCase().includes('submit')) {
          score += 10;
          scoreBreakdown.push(`form context (+10)`);
        }
        
        // Prefer buttons in action areas for action buttons
        if ((parentInfo.includes('action') || parentInfo.includes('button') || parentInfo.includes('control')) && 
            (identifier.text?.toLowerCase().includes('submit') || identifier.text?.toLowerCase().includes('save'))) {
          score += 5;
          scoreBreakdown.push(`action context (+5)`);
        }
      }

      // CSS class hints for button priority
      if (element.attributes.class) {
        const classes = element.attributes.class.toLowerCase();
        if (classes.includes('primary') || classes.includes('main') || classes.includes('submit')) {
          score += 8;
          scoreBreakdown.push(`primary class (+8)`);
        } else if (classes.includes('secondary') || classes.includes('cancel') || classes.includes('danger')) {
          score -= 5;
          scoreBreakdown.push(`secondary class (-5)`);
        }
      }

      // Prefer elements that are visible and well-positioned
      if (element.context.position.x > 0 && element.context.position.y > 0) {
        score += 2;
        scoreBreakdown.push(`visible position (+2)`);
      }

      // Prefer elements with more specific attributes (indicates intentional design)
      const attributeBonus = Math.min(Object.keys(element.attributes).length * 0.5, 3);
      if (attributeBonus > 0) {
        score += attributeBonus;
        scoreBreakdown.push(`attribute richness (+${attributeBonus})`);
      }

      console.log(`Element ${index + 1} ("${element.textContent.substring(0, 30)}") score: ${score}`);
      console.log(`  Breakdown: ${scoreBreakdown.join(', ')}`);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    console.log(`\n� [ElementFinder] Rule-based selection: Element ${bestIndex + 1} (score: ${bestScore})`);
    console.log(`    Selected: "${distilledElements[bestIndex]?.textContent?.substring(0, 50)}"`);
    
    return bestIndex;
  }

  /**
   * Calculate confidence score for a selected element
   */
  private calculateSelectionConfidence(
    selectedElement: any,
    selectorConfig: StructuredElementSelector,
    allElements: Array<any>
  ): number {
    if (!selectedElement) return 0;
    
    let confidence = 50; // Base confidence
    const identifier = selectorConfig.identifier;
    
    // Exact text match boosts confidence significantly
    if (identifier.text && selectedElement.textContent === identifier.text) {
      confidence += 30;
    } else if (identifier.text && selectedElement.textContent.includes(identifier.text)) {
      confidence += 20;
    }
    
    // Exact attribute matches boost confidence
    if (identifier.id && selectedElement.attributes.id === identifier.id) {
      confidence += 25;
    }
    if (identifier.testId && selectedElement.attributes['data-testid'] === identifier.testId) {
      confidence += 25;
    }
    if (identifier.name && selectedElement.attributes.name === identifier.name) {
      confidence += 20;
    }
    
    // Button type matching for submit buttons
    if (selectorConfig.type === 'button' && identifier.text?.toLowerCase().includes('submit')) {
      if (selectedElement.attributes.type === 'submit') {
        confidence += 20;
      }
      // Penalize if it's an exit/cancel button when looking for submit
      const text = selectedElement.textContent.toLowerCase();
      if (text.includes('exit') || text.includes('cancel') || text.includes('close')) {
        confidence -= 30;
      }
    }
    
    // Form context for submit buttons
    if (identifier.text?.toLowerCase().includes('submit') && 
        selectedElement.context.parentInfo?.includes('form')) {
      confidence += 15;
    }
    
    // Reduce confidence if there are many similar elements (ambiguous)
    const similarElements = allElements.filter(el => 
      el.textContent.toLowerCase().includes(selectedElement.textContent.toLowerCase()) ||
      el.context.tagName === selectedElement.context.tagName
    );
    if (similarElements.length > 2) {
      confidence -= 10;
    }
    
    return Math.min(Math.max(confidence, 0), 100); // Clamp between 0-100
  }

  /**
   * Build a selector string from a located element for reporting
   */
  private async buildElementSelector(element: Locator): Promise<string> {
    try {
      const id = await element.getAttribute('id');
      if (id) return `#${id}`;

      const className = await element.getAttribute('class');
      if (className) {
        const firstClass = className.split(' ')[0];
        if (firstClass) return `.${firstClass}`;
      }

      const name = await element.getAttribute('name');
      if (name) return `[name="${name}"]`;

      const testId = await element.getAttribute('data-testid');
      if (testId) return `[data-testid="${testId}"]`;

      const tagName = await element.evaluate('el => el.tagName.toLowerCase()') as string;
      return tagName;
    } catch (error) {
      return 'unknown';
    }
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
