import type { Page } from "playwright";
import { loggingService } from "../logging";
import {
  elementFinder,
  type StructuredElementSelector,
} from "./elementFinder.playwright";
import {
  inputFiller,
  type InputFillOptions,
  type FormFillData,
} from "./inputFiller.playwright";

// Legacy support - will be removed in future version
export interface ElementFindOptions {
  timeout?: number;
  exact?: boolean;
  caseSensitive?: boolean;
}

export interface BrowserAutomationOptions {
  timeout?: number;
  retryCount?: number;
  elementFindOptions?: ElementFindOptions;
  inputFillOptions?: InputFillOptions;
}

export interface ClickOptions extends BrowserAutomationOptions {
  button?: "left" | "right" | "middle";
  clickCount?: number;
  delay?: number;
  force?: boolean;
}

export interface NavigationOptions {
  timeout?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

export interface WaitOptions {
  timeout?: number;
  state?: "attached" | "detached" | "visible" | "hidden";
}

/**
 * Convert legacy string selector to structured selector format
 */
function convertLegacySelector(selector: string): StructuredElementSelector {
  // Handle common Playwright selector patterns and convert to structured format
  console.log("Converting legacy selector:", selector);

  // Handle text selectors with various formats:
  // - text="Start Challenge"
  // - >> text="Start Challenge"
  // - text=Start Challenge
  // - >> text=Start Challenge
  let textMatch = selector.match(/(?:>> )?text="([^"]+)"/);
  if (textMatch) {
    const text = textMatch[1];
    const result = {
      type: "any",
      identifier: { text },
      fallbacks: [{ textContains: text }, { role: "button" }, { role: "link" }],
    };
    console.log("Matched quoted text selector, result:", result);
    return result;
  }

  // Handle unquoted text selectors (can contain spaces until end of string or next selector)
  textMatch = selector.match(/(?:>> )?text=([^>]+?)(?:\s*>>|$)/);
  if (textMatch && textMatch[1]) {
    const text = textMatch[1].trim();
    const result = {
      type: "any",
      identifier: { text },
      fallbacks: [{ textContains: text }, { role: "button" }, { role: "link" }],
    };
    console.log(
      "Matched unquoted text selector, extracted text:",
      text,
      "result:",
      result
    );
    return result;
  }

  // Handle button with text: button:has-text("Start Challenge")
  const buttonTextMatch = selector.match(
    /button:has-text\("([^"]+)"\)|button >> text="([^"]+)"/
  );
  if (buttonTextMatch) {
    const text = buttonTextMatch[1] || buttonTextMatch[2];
    return {
      type: "button",
      identifier: { text },
      fallbacks: [{ textContains: text }, { role: "button" }],
    };
  }

  // Handle input selectors: input[name="email"], input[placeholder="..."], input[type="..."]
  const inputMatch = selector.match(/input\[([^\]]+)\]/);
  if (inputMatch) {
    const attr = inputMatch[1];
    if (attr) {
      const nameMatch = attr.match(/name=["']([^"']+)["']/);
      const typeMatch = attr.match(/type=["']([^"']+)["']/);
      const placeholderMatch = attr.match(/placeholder=["']([^"']+)["']/);

      if (nameMatch && nameMatch[1]) {
        const result = {
          type: "input",
          identifier: { name: nameMatch[1] },
          fallbacks: [
            { placeholder: nameMatch[1] },
            { ariaLabel: nameMatch[1] },
          ],
        };
        console.log("Matched input name selector, result:", result);
        return result;
      }

      if (placeholderMatch && placeholderMatch[1]) {
        const result = {
          type: "input",
          identifier: { placeholder: placeholderMatch[1] },
          fallbacks: [
            { ariaLabel: placeholderMatch[1] },
            { name: placeholderMatch[1] },
          ],
        };
        console.log("Matched input placeholder selector, result:", result);
        return result;
      }

      if (typeMatch && typeMatch[1]) {
        const result = {
          type: "input",
          identifier: { attributes: { type: typeMatch[1] } },
          fallbacks: [{ role: "textbox" }],
        };
        console.log("Matched input type selector, result:", result);
        return result;
      }
    }
  }

  // Handle ID selectors: #submit-button
  if (selector.startsWith("#")) {
    const id = selector.substring(1);
    return {
      type: "any",
      identifier: { id },
      fallbacks: [],
    };
  }

  // Handle class selectors: .submit-btn
  if (selector.startsWith(".")) {
    const className = selector.substring(1);
    const result = {
      type: "any",
      identifier: { className },
      fallbacks: [{ classContains: className }],
    };
    console.log("Matched class selector, result:", result);
    return result;
  }

  // Handle attribute selectors: [data-secret], [data-testid="value"], [role="button"]
  const attributeMatch = selector.match(/^\[([^\]]+)\]$/);
  if (attributeMatch && attributeMatch[1]) {
    const attrString = attributeMatch[1];
    console.log("Matched attribute selector, parsing:", attrString);

    // Check for attribute with value: data-secret="true" or data-testid="value"
    const attrValueMatch = attrString.match(/^([^=]+)="([^"]+)"$/);
    if (attrValueMatch && attrValueMatch[1] && attrValueMatch[2]) {
      const [, attrName, attrValue] = attrValueMatch;
      const attributes: Record<string, string> = {};
      attributes[attrName] = attrValue;
      const result = {
        type: "any",
        identifier: {
          attributes,
        },
        fallbacks: [],
      };
      console.log("Matched attribute with value, result:", result);
      return result;
    }

    // Check for attribute without value: [data-secret] or [disabled]
    const attrOnlyMatch = attrString.match(/^([a-zA-Z-_]+)$/);
    if (attrOnlyMatch && attrOnlyMatch[1]) {
      const attrName = attrOnlyMatch[1];
      const attributes: Record<string, string> = {};
      attributes[attrName] = ""; // For boolean attributes, we check for presence
      const result = {
        type: "any",
        identifier: {
          attributes,
        },
        fallbacks: [],
      };
      console.log("Matched attribute without value, result:", result);
      return result;
    }
  }

  // Handle generic CSS selectors - try to parse element type
  const elementMatch = selector.match(/^([a-z]+)/);
  if (elementMatch && elementMatch[1]) {
    const elementType = elementMatch[1];
    return {
      type: elementType,
      identifier: {},
      fallbacks: [],
      options: {
        timeout: 10000,
      },
    };
  }

  // Fallback for complex selectors - treat as generic
  return {
    type: "any",
    identifier: {},
    fallbacks: [],
    options: {
      timeout: 10000,
    },
  };
}

/**
 * Generic browser automation utility providing high-level actions
 */
export class BrowserAutomation {
  private logger = loggingService.createComponentLogger("BrowserAutomation");

  /**
   * Navigate to a URL with optional wait conditions
   */
  async navigate(
    page: Page,
    url: string,
    options: NavigationOptions = {}
  ): Promise<void> {
    const { timeout = 30000, waitUntil = "load" } = options;

    this.logger.info(`Navigating to: ${url}`, { timeout, waitUntil });

    await page.goto(url, { timeout, waitUntil });

    this.logger.info(`Navigation completed`, {
      finalUrl: page.url(),
      title: await page.title(),
    });
  }

  /**
   * Click on an element using intelligent finding
   */
  async click(
    page: Page,
    identifier: string,
    options: ClickOptions = {}
  ): Promise<void> {
    const {
      button = "left",
      clickCount = 1,
      delay = 0,
      force = false,
      timeout = 10000,
      retryCount = 3,
    } = options;

    // Convert legacy string selector to structured selector
    const structuredSelector = convertLegacySelector(identifier);

    // Add timeout to options if not already set
    if (!structuredSelector.options) {
      structuredSelector.options = {};
    }
    structuredSelector.options.timeout = timeout;

    this.logger.info(`Clicking element: ${identifier}`, {
      legacySelector: identifier,
      structuredSelector,
      button,
      clickCount,
      delay,
      force,
    });

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        this.logger.debug(`Click attempt ${attempt}/${retryCount}`, {
          structuredSelector,
          attempt,
        });

        const findResult = await elementFinder.findElement(
          page,
          structuredSelector
        );

        if (!findResult.found) {
          this.logger.warn(`Attempt ${attempt}: Element not found`, {
            identifier,
            structuredSelector,
            confidence: findResult.confidence,
          });
          continue;
        }

        this.logger.info(
          `Element found with confidence ${findResult.confidence}%`,
          {
            strategy: findResult.strategy,
            selector: findResult.selector,
            attempt,
          }
        );

        await findResult.element.click({
          button,
          clickCount,
          delay,
          force,
        });

        this.logger.info(`Successfully clicked element`, {
          identifier,
          strategy: findResult.strategy,
          selector: findResult.selector,
          attempt,
        });
        return;
      } catch (error) {
        this.logger.warn(`Click attempt ${attempt} failed`, {
          identifier,
          error: error instanceof Error ? error.message : String(error),
        });

        if (attempt < retryCount) {
          await page.waitForTimeout(1000 * attempt);
        }
      }
    }

    throw new Error(
      `Failed to click element "${identifier}" after ${retryCount} attempts`
    );
  }

  /**
   * Type text into an element
   */
  async type(
    page: Page,
    identifier: string,
    text: string,
    options: BrowserAutomationOptions & { delay?: number; clear?: boolean } = {}
  ): Promise<void> {
    const { delay = 50, clear = true, timeout = 10000 } = options;

    // Convert legacy string selector to structured selector
    const structuredSelector = convertLegacySelector(identifier);
    if (!structuredSelector.options) {
      structuredSelector.options = {};
    }
    structuredSelector.options.timeout = timeout;

    this.logger.info(`Typing into element: ${identifier}`, {
      legacySelector: identifier,
      structuredSelector,
      textLength: text.length,
      delay,
      clear,
    });

    try {
      const findResult = await elementFinder.findElement(
        page,
        structuredSelector
      );

      if (!findResult.found) {
        throw new Error(`Element not found: ${identifier}`);
      }

      this.logger.info(
        `Element found for typing with confidence ${findResult.confidence}%`,
        {
          strategy: findResult.strategy,
          selector: findResult.selector,
        }
      );

      if (clear) {
        await findResult.element.clear();
      }

      await findResult.element.type(text, { delay });

      this.logger.info(`Successfully typed into element`, {
        identifier,
        strategy: findResult.strategy,
        selector: findResult.selector,
        textLength: text.length,
      });
    } catch (error) {
      this.logger.error(`Failed to type into element "${identifier}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to type into element "${identifier}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Fill a form with multiple inputs
   */
  async fillForm(
    page: Page,
    formData: FormFillData,
    options: BrowserAutomationOptions & { stopOnError?: boolean } = {}
  ): Promise<void> {
    const { stopOnError = false } = options;

    this.logger.info(
      `Filling form with ${Object.keys(formData).length} fields`,
      {
        fields: Object.keys(formData),
        stopOnError,
      }
    );

    const result = await inputFiller.fillForm(page, formData, {
      stopOnError,
      timeout: options.timeout,
      retryCount: options.retryCount,
      elementFindOptions: options.elementFindOptions,
      ...options.inputFillOptions,
    });

    if (!result.success) {
      const errorMsg = `Form filling failed with ${
        result.errors.length
      } errors: ${result.errors.join(", ")}`;
      throw new Error(errorMsg);
    }

    this.logger.info(`Successfully filled form`, {
      totalFields: Object.keys(formData).length,
      successfulFields: Object.values(result.results).filter((r) => r.success)
        .length,
    });
  }

  /**
   * Wait for an element to appear
   */
  async waitForElement(
    page: Page,
    identifier: string,
    options: WaitOptions & ElementFindOptions = {}
  ): Promise<void> {
    const { timeout = 10000, state = "visible" } = options;

    // Convert legacy string selector to structured selector
    const structuredSelector = convertLegacySelector(identifier);
    if (!structuredSelector.options) {
      structuredSelector.options = {};
    }
    structuredSelector.options.timeout = timeout;

    this.logger.info(`Waiting for element: ${identifier}`, {
      legacySelector: identifier,
      structuredSelector: JSON.stringify(structuredSelector, null, 2),
      timeout,
      state,
    });

    const findResult = await elementFinder.findElement(
      page,
      structuredSelector
    );

    if (!findResult.found) {
      this.logger.error(`Element not found during wait`, {
        identifier,
        structuredSelector,
        confidence: findResult.confidence,
        strategy: findResult.strategy,
        selector: findResult.selector,
      });
      throw new Error(`Element not found: ${identifier}`);
    }

    await findResult.element.waitFor({ state, timeout });

    this.logger.info(`Element found and ready`, {
      identifier,
      strategy: findResult.strategy,
      selector: findResult.selector,
      confidence: findResult.confidence,
    });
  }

  /**
   * Get text content from an element
   */
  async getText(
    page: Page,
    identifier: string,
    options: BrowserAutomationOptions = {}
  ): Promise<string> {
    const { timeout = 10000 } = options;

    // Convert legacy string selector to structured selector
    const structuredSelector = convertLegacySelector(identifier);
    if (!structuredSelector.options) {
      structuredSelector.options = {};
    }
    structuredSelector.options.timeout = timeout;

    this.logger.info(`Getting text from element: ${identifier}`, {
      legacySelector: identifier,
      structuredSelector,
    });

    const findResult = await elementFinder.findElement(
      page,
      structuredSelector
    );

    if (!findResult.found) {
      throw new Error(`Element not found: ${identifier}`);
    }

    const text = (await findResult.element.textContent()) || "";

    this.logger.info(`Retrieved text from element`, {
      identifier,
      strategy: findResult.strategy,
      textLength: text.length,
      confidence: findResult.confidence,
    });

    return text;
  }

  /**
   * Get attribute value from an element
   */
  async getAttribute(
    page: Page,
    identifier: string,
    attributeName: string,
    options: BrowserAutomationOptions = {}
  ): Promise<string | null> {
    const { timeout = 10000 } = options;

    // Convert legacy string selector to structured selector
    const structuredSelector = convertLegacySelector(identifier);
    if (!structuredSelector.options) {
      structuredSelector.options = {};
    }
    structuredSelector.options.timeout = timeout;

    this.logger.info(
      `Getting attribute "${attributeName}" from element: ${identifier}`,
      {
        legacySelector: identifier,
        structuredSelector,
        attributeName,
      }
    );

    const findResult = await elementFinder.findElement(
      page,
      structuredSelector
    );

    if (!findResult.found) {
      throw new Error(`Element not found: ${identifier}`);
    }

    const value = await findResult.element.getAttribute(attributeName);

    this.logger.info(`Retrieved attribute from element`, {
      identifier,
      strategy: findResult.strategy,
      attributeName,
      value,
      confidence: findResult.confidence,
    });

    return value;
  }

  /**
   * Select an option from a dropdown
   */
  async selectOption(
    page: Page,
    identifier: string,
    option: string | number,
    options: BrowserAutomationOptions = {}
  ): Promise<void> {
    this.logger.info(`Selecting option "${option}" from: ${identifier}`);

    const result = await inputFiller.selectOption(page, identifier, option, {
      timeout: options.timeout,
      retryCount: options.retryCount,
      elementFindOptions: options.elementFindOptions,
    });

    if (!result.success) {
      throw new Error(
        `Failed to select option "${option}" from "${identifier}": ${result.error}`
      );
    }

    this.logger.info(`Successfully selected option`, {
      identifier,
      option,
      strategy: result.strategy,
    });
  }

  /**
   * Check or uncheck a checkbox
   */
  async setCheckbox(
    page: Page,
    identifier: string,
    checked: boolean,
    options: BrowserAutomationOptions = {}
  ): Promise<void> {
    this.logger.info(`Setting checkbox "${identifier}" to: ${checked}`);

    const result = await inputFiller.setCheckbox(page, identifier, checked, {
      timeout: options.timeout,
      retryCount: options.retryCount,
      elementFindOptions: options.elementFindOptions,
    });

    if (!result.success) {
      throw new Error(
        `Failed to set checkbox "${identifier}" to ${checked}: ${result.error}`
      );
    }

    this.logger.info(`Successfully set checkbox`, {
      identifier,
      checked,
      strategy: result.strategy,
    });
  }

  /**
   * Scroll to an element
   */
  async scrollToElement(
    page: Page,
    identifier: string,
    options: BrowserAutomationOptions = {}
  ): Promise<void> {
    const { timeout = 10000 } = options;

    // Convert legacy string selector to structured selector
    const structuredSelector = convertLegacySelector(identifier);
    if (!structuredSelector.options) {
      structuredSelector.options = {};
    }
    structuredSelector.options.timeout = timeout;

    this.logger.info(`Scrolling to element: ${identifier}`, {
      legacySelector: identifier,
      structuredSelector,
    });

    const findResult = await elementFinder.findElement(
      page,
      structuredSelector
    );

    if (!findResult.found) {
      throw new Error(`Element not found: ${identifier}`);
    }

    await findResult.element.scrollIntoViewIfNeeded();

    this.logger.info(`Successfully scrolled to element`, {
      identifier,
      strategy: findResult.strategy,
      confidence: findResult.confidence,
    });
  }

  /**
   * Hover over an element
   */
  async hover(
    page: Page,
    identifier: string,
    options: BrowserAutomationOptions = {}
  ): Promise<void> {
    const { timeout = 10000 } = options;

    // Convert legacy string selector to structured selector
    const structuredSelector = convertLegacySelector(identifier);
    if (!structuredSelector.options) {
      structuredSelector.options = {};
    }
    structuredSelector.options.timeout = timeout;

    this.logger.info(`Hovering over element: ${identifier}`, {
      legacySelector: identifier,
      structuredSelector,
    });

    const findResult = await elementFinder.findElement(
      page,
      structuredSelector
    );

    if (!findResult.found) {
      throw new Error(`Element not found: ${identifier}`);
    }

    await findResult.element.hover();

    this.logger.info(`Successfully hovered over element`, {
      identifier,
      strategy: findResult.strategy,
      confidence: findResult.confidence,
    });
  }
}

export const browserAutomation = new BrowserAutomation();
