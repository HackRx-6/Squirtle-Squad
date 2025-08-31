import type { Page } from "playwright";
import type { WebAutomationAction } from "./types";
import type { StructuredElementSelector } from "./elementFinder.playwright";
import { loggingService } from "../logging";
import { browserAutomation } from "./browserAutomation.playwright";
import { elementFinder } from "./elementFinder.playwright";
import { inputFiller } from "./inputFiller.playwright";

export class ActionExecutor {
  private logger = loggingService.createComponentLogger("ActionExecutor");

  /**
   * Normalize and convert selector to string format for browserAutomation functions
   * This handles LLM outputs that may be stringified JSON or malformed JSON
   */
  private normalizeSelectorToString(
    selector: string | StructuredElementSelector | any
  ): string {
    console.log("\n🔧 [ActionExecutor] NORMALIZING SELECTOR:");
    console.log("◆".repeat(60));
    console.log("📥 Input Selector Type:", typeof selector);
    console.log("📥 Input Selector:", selector);

    // If it's already a string, check if it's stringified JSON
    if (typeof selector === "string") {
      const trimmed = selector.trim();

      // Check if it looks like JSON (starts with { and ends with })
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        console.log("🔍 Detected possible JSON string, attempting to parse...");

        try {
          // Try to parse as JSON
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object") {
            console.log("✅ Successfully parsed JSON selector:", parsed);
            return this.convertStructuredSelectorToString(parsed);
          }
        } catch (e) {
          console.log("⚠️ JSON parsing failed, trying to fix common issues...");

          // Try to fix common LLM JSON issues
          try {
            const fixed = this.fixLLMJsonIssues(trimmed);
            const parsed = JSON.parse(fixed);
            if (parsed && typeof parsed === "object") {
              console.log(
                "✅ Successfully parsed FIXED JSON selector:",
                parsed
              );
              return this.convertStructuredSelectorToString(parsed);
            }
          } catch (e2) {
            console.log(
              "❌ Even fixed JSON failed to parse, treating as literal string"
            );
          }
        }
      }

      // It's a regular string selector
      console.log("✅ Using string selector as-is:", selector);
      console.log("◆".repeat(60));
      return selector;
    }

    // If it's already an object (StructuredElementSelector)
    if (typeof selector === "object" && selector !== null) {
      console.log("🏗️ Converting structured object to string selector");
      const result = this.convertStructuredSelectorToString(selector);
      console.log("✅ Converted to string:", result);
      console.log("◆".repeat(60));
      return result;
    }

    // Fallback
    console.log("⚠️ Unknown selector format, converting to string");
    const result = String(selector);
    console.log("✅ Fallback string:", result);
    console.log("◆".repeat(60));
    return result;
  }

  /**
   * Fix common LLM JSON formatting issues
   */
  private fixLLMJsonIssues(jsonString: string): string {
    let fixed = jsonString;

    // Fix escaped quotes
    fixed = fixed.replace(/\\"/g, '"');

    // Fix single quotes to double quotes
    fixed = fixed.replace(/'/g, '"');

    // Fix unquoted object keys
    fixed = fixed.replace(
      /([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g,
      '$1"$2":'
    );

    // Fix trailing commas
    fixed = fixed.replace(/,(\s*[}\]])/g, "$1");

    // Fix missing quotes around string values that aren't objects/arrays
    fixed = fixed.replace(
      /:\s*([^"{\[\]}\s,]+)(?=\s*[,}])/g,
      (match, value) => {
        // Don't quote numbers, booleans, null
        if (/^(true|false|null|\d+(?:\.\d+)?)$/.test(value.trim())) {
          return match;
        }
        return `: "${value.trim()}"`;
      }
    );

    console.log("🔧 JSON Fix Process:");
    console.log("   Original:", jsonString.substring(0, 100) + "...");
    console.log("   Fixed:   ", fixed.substring(0, 100) + "...");

    return fixed;
  }

  /**
   * Convert a StructuredElementSelector to a simple string selector
   * for compatibility with existing browserAutomation functions
   */
  private convertStructuredSelectorToString(
    structured: StructuredElementSelector
  ): string {
    console.log("🔄 Converting structured selector to string:", structured);

    // Extract the most specific identifier
    const identifier = structured.identifier || {};

    // Priority order for identifiers (most specific first)
    if (identifier.id) {
      return `#${identifier.id}`;
    }

    if (identifier.testId) {
      return `[data-testid="${identifier.testId}"]`;
    }

    if (identifier.name) {
      return `[name="${identifier.name}"]`;
    }

    if (identifier.placeholder) {
      return `[placeholder="${identifier.placeholder}"]`;
    }

    if (identifier.text) {
      return `text="${identifier.text}"`;
    }

    if (identifier.textContains) {
      return `text="${identifier.textContains}"`;
    }

    if (identifier.className) {
      return `.${identifier.className}`;
    }

    if (identifier.classContains) {
      return `[class*="${identifier.classContains}"]`;
    }

    if (identifier.ariaLabel) {
      return `[aria-label="${identifier.ariaLabel}"]`;
    }

    if (identifier.role) {
      return `[role="${identifier.role}"]`;
    }

    if (identifier.href) {
      return `[href*="${identifier.href}"]`;
    }

    if (identifier.alt) {
      return `[alt="${identifier.alt}"]`;
    }

    if (identifier.attributes) {
      const attrs = Object.entries(identifier.attributes);
      if (attrs.length > 0) {
        const [key, value] = attrs[0]!; // Use first attribute with non-null assertion
        return `[${key}="${value}"]`;
      }
    }

    // If we have a type but no specific identifier, use the element type
    if (structured.type && structured.type !== "any") {
      return structured.type;
    }

    // Fallback to first fallback if available
    if (structured.fallbacks && structured.fallbacks.length > 0) {
      const fallback = structured.fallbacks[0];
      if (fallback) {
        return this.convertStructuredSelectorToString({
          type: structured.type,
          identifier: fallback,
          fallbacks: [],
        });
      }
    }

    // Last resort fallback
    console.warn("⚠️ Could not convert structured selector, using wildcard");
    return "*";
  }

  /**
   * Execute a single web automation action
   */
  async executeAction(
    page: Page,
    action: WebAutomationAction,
    defaultTimeout: number
  ): Promise<void> {
    const timeout = action.timeout || defaultTimeout;
    const actionId = `${action.type}_${Date.now()}`;

    this.logger.info(`Executing action: ${action.type}`, {
      actionId,
      type: action.type,
      selector: action.selector,
      timeout,
      url: page.url(),
    });

    console.log("\n🎬 [ActionExecutor] EXECUTING ACTION:");
    console.log("▶".repeat(70));
    console.log("🏷️ Action ID:", actionId);
    console.log("🎯 Action Type:", action.type);
    console.log("🔍 Selector:", action.selector || "N/A");
    console.log(
      "📝 Text/Data:",
      action.text ||
        (action as any).optionValue ||
        (action as any).formData ||
        "N/A"
    );
    console.log("⏱️ Timeout:", timeout + "ms");
    console.log("🌐 Current URL:", page.url());
    console.log("📋 Full Action Details:");
    console.log(JSON.stringify(action, null, 2));
    console.log("▶".repeat(70));

    const startTime = Date.now();

    try {
      switch (action.type) {
        case "navigate":
          await this.handleNavigate(page, action, timeout, actionId);
          break;

        case "click":
          await this.handleClick(page, action, timeout, actionId);
          break;

        case "type":
          await this.handleType(page, action, timeout, actionId);
          break;

        case "wait":
          await this.handleWait(page, action, timeout, actionId);
          break;

        case "scroll":
          await this.handleScroll(page, action, timeout, actionId);
          break;

        case "hover":
          await this.handleHover(page, action, timeout, actionId);
          break;

        case "select":
          await this.handleSelect(page, action, timeout, actionId);
          break;

        case "fill_form":
          await this.handleFillForm(page, action, timeout, actionId);
          break;

        case "submit_form":
          await this.handleSubmitForm(page, action, timeout, actionId);
          break;

        case "find_element":
          await this.handleFindElement(page, action, timeout, actionId);
          break;

        case "get_text":
          await this.handleGetText(page, action, timeout, actionId);
          break;

        case "get_attribute":
          await this.handleGetAttribute(page, action, timeout, actionId);
          break;

        case "set_checkbox":
          await this.handleSetCheckbox(page, action, timeout, actionId);
          break;

        case "select_option":
          await this.handleSelectOption(page, action, timeout, actionId);
          break;

        case "scroll_to_element":
          await this.handleScrollToElement(page, action, timeout, actionId);
          break;

        case "wait_for_element":
          await this.handleWaitForElement(page, action, timeout, actionId);
          break;

        default:
          this.logger.error(`Unknown action type encountered`, {
            actionId,
            actionType: action.type,
          });
          throw new Error(`Unknown action type: ${action.type}`);
      }

      const executionTime = Date.now() - startTime;
      this.logger.info(`Action completed successfully`, {
        actionId,
        type: action.type,
        executionTimeMs: executionTime,
        finalUrl: page.url(),
      });

      console.log("\n✅ [ActionExecutor] ACTION COMPLETED:");
      console.log("◆".repeat(70));
      console.log("🏷️ Action ID:", actionId);
      console.log("🎯 Action Type:", action.type);
      console.log("⏱️ Execution Time:", executionTime + "ms");
      console.log("🌐 Final URL:", page.url());
      console.log("✅ Status: SUCCESS");
      console.log("◆".repeat(70));
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Action failed: ${action.type}`, {
        actionId,
        type: action.type,
        selector: action.selector,
        error: error.message,
        executionTimeMs: executionTime,
        currentUrl: page.url(),
      });

      console.log("\n❌ [ActionExecutor] ACTION FAILED:");
      console.log("◆".repeat(70));
      console.log("🏷️ Action ID:", actionId);
      console.log("🎯 Action Type:", action.type);
      console.log("🔍 Selector:", action.selector || "N/A");
      console.log("⏱️ Execution Time:", executionTime + "ms");
      console.log("🌐 Current URL:", page.url());
      console.log("💥 Error:", error.message);
      console.log("📋 Full Error:", error);
      console.log("❌ Status: FAILED");
      console.log("◆".repeat(70));

      throw error;
    }
  }

  private async handleNavigate(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.url) {
      throw new Error("Navigate action requires a URL");
    }

    this.logger.info(`Navigating to: ${action.url}`, {
      actionId,
      targetUrl: action.url,
    });

    console.log("\n🧭 [ActionExecutor] NAVIGATION:");
    console.log("▪".repeat(60));
    console.log("🏷️ Action ID:", actionId);
    console.log("🌐 Target URL:", action.url);
    console.log("🌐 Current URL:", page.url());
    console.log("⏱️ Timeout:", timeout + "ms");
    console.log("▪".repeat(60));

    await page.goto(action.url, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    console.log("\n✅ [ActionExecutor] NAVIGATION COMPLETED:");
    console.log("▪".repeat(60));
    console.log("🏷️ Action ID:", actionId);
    console.log("🌐 Final URL:", page.url());
    console.log("📰 Page Title:", await page.title());
    console.log("▪".repeat(60));

    this.logger.info(`Navigation completed to: ${page.url()}`, {
      actionId,
      finalUrl: page.url(),
    });
  }

  private async handleClick(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector) {
      throw new Error("Click action requires a selector");
    }

    // Normalize selector to string format
    const normalizedSelector = this.normalizeSelectorToString(action.selector);

    this.logger.info(`Executing intelligent click`, {
      actionId,
      selector: action.selector,
      normalizedSelector,
    });

    console.log("\n🖱️ [ActionExecutor] CLICK:");
    console.log("▪".repeat(60));
    console.log("🏷️ Action ID:", actionId);
    console.log("🎯 Original Selector:", action.selector);
    console.log("🔧 Normalized Selector:", normalizedSelector);
    console.log("🌐 Current URL:", page.url());
    console.log("⏱️ Timeout:", timeout + "ms");
    console.log("▪".repeat(60));

    try {
      await browserAutomation.click(page, normalizedSelector, {
        timeout,
        retryCount: 3,
        force: false, // Try normal click first, then force if needed
        elementFindOptions: {
          timeout,
          exact: false,
          caseSensitive: false,
        },
      });

      console.log("\n✅ [ActionExecutor] CLICK COMPLETED:");
      console.log("▪".repeat(60));
      console.log("🏷️ Action ID:", actionId);
      console.log("🎯 Clicked:", action.selector);
      console.log("🌐 Current URL:", page.url());
      console.log("▪".repeat(60));

      this.logger.info(`Click completed successfully`, {
        actionId,
        selector: action.selector,
      });
    } catch (error) {
      console.log("\n❌ [ActionExecutor] CLICK FAILED:");
      console.log("▪".repeat(60));
      console.log("🏷️ Action ID:", actionId);
      console.log("🎯 Selector:", action.selector);
      console.log(
        "💥 Error:",
        error instanceof Error ? error.message : String(error)
      );
      console.log("🌐 Current URL:", page.url());
      console.log("▪".repeat(60));

      this.logger.error(`Click failed`, {
        actionId,
        selector: action.selector,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async handleType(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector || !action.text) {
      throw new Error("Type action requires both selector and text");
    }

    // Normalize selector to string format
    const normalizedSelector = this.normalizeSelectorToString(action.selector);

    this.logger.info(`Executing intelligent type`, {
      actionId,
      selector: action.selector,
      normalizedSelector,
      textLength: action.text.length,
    });

    try {
      await browserAutomation.type(page, normalizedSelector, action.text, {
        timeout,
        retryCount: 3,
        clear: true,
        delay: 50,
        elementFindOptions: {
          timeout,
          exact: false,
          caseSensitive: false,
        },
      });

      this.logger.info(`Type completed successfully`, {
        actionId,
        selector: action.selector,
        normalizedSelector,
      });
    } catch (error) {
      this.logger.error(`Type failed`, {
        actionId,
        selector: action.selector,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async handleWait(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (action.selector) {
      const normalizedSelector = this.normalizeSelectorToString(
        action.selector
      );
      this.logger.info(`Waiting for element: ${action.selector}`, { actionId });
      await page.waitForSelector(normalizedSelector, { timeout });
      this.logger.info(`Element appeared: ${action.selector}`, { actionId });
    } else {
      const waitTime = action.timeout || 1000;
      this.logger.info(`Waiting for ${waitTime}ms`, { actionId });
      await page.waitForTimeout(waitTime);
      this.logger.info(`Wait completed`, { actionId });
    }
  }

  private async handleScroll(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (action.selector) {
      const normalizedSelector = this.normalizeSelectorToString(
        action.selector
      );
      this.logger.info(`Scrolling to element: ${action.selector}`, {
        actionId,
      });
      await page.waitForSelector(normalizedSelector, { timeout });
      await page.locator(normalizedSelector).scrollIntoViewIfNeeded();
      this.logger.info(`Scrolled to element: ${action.selector}`, {
        actionId,
      });
    } else {
      this.logger.info("Scrolling to bottom of page", { actionId });
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      this.logger.info("Scrolled to bottom of page", { actionId });
    }
  }

  private async handleHover(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector) {
      throw new Error("Hover action requires a selector");
    }

    const normalizedSelector = this.normalizeSelectorToString(action.selector);
    this.logger.info(`Hovering over element: ${action.selector}`, {
      actionId,
    });
    await page.waitForSelector(normalizedSelector, { timeout });
    await page.hover(normalizedSelector);
    this.logger.info(`Hover completed on: ${action.selector}`, { actionId });
  }

  private async handleSelect(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector || !action.text) {
      throw new Error("Select action requires both selector and text");
    }

    const normalizedSelector = this.normalizeSelectorToString(action.selector);
    this.logger.info(`Selecting option in: ${action.selector}`, {
      actionId,
      optionValue: action.text,
    });
    await page.waitForSelector(normalizedSelector, { timeout });
    await page.selectOption(normalizedSelector, action.text);
    this.logger.info(`Option selected in: ${action.selector}`, { actionId });
  }

  private async handleFillForm(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.formData) {
      throw new Error("Fill form action requires formData");
    }

    this.logger.info("Filling form with multiple fields", {
      actionId,
      fieldCount: Object.keys(action.formData).length,
      fields: Object.keys(action.formData),
    });

    // Fill multiple form fields
    for (const [selector, value] of Object.entries(action.formData)) {
      if (!selector || value === undefined) continue;

      this.logger.debug(`Filling form field: ${selector}`, {
        actionId,
        value: value.substring(0, 50) + (value.length > 50 ? "..." : ""),
      });

      await page.waitForSelector(selector, { timeout });
      await page.fill(selector, value);
    }
    this.logger.info("Form filling completed", { actionId });
  }

  private async handleSubmitForm(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    const submitSelector =
      action.submitSelector ||
      'input[type="submit"], button[type="submit"], button:has-text("Submit")';

    this.logger.info(`Submitting form with selector: ${submitSelector}`, {
      actionId,
    });

    await page.waitForSelector(submitSelector, { timeout });
    await page.click(submitSelector);
    this.logger.info("Form submission completed", { actionId });
  }

  private async handleFindElement(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector) {
      throw new Error("Find element action requires a selector");
    }

    this.logger.info(`Finding element: ${action.selector}`, { actionId });

    try {
      // Convert legacy string selector to structured selector for the new element finder
      let structuredSelector: any = {
        type: "any",
        identifier: {},
        fallbacks: [],
        options: {
          timeout,
          exact: false,
          caseSensitive: false,
        },
      };

      // First normalize the selector to string format to check it
      const normalizedSelector = this.normalizeSelectorToString(
        action.selector
      );

      // Handle common Playwright selectors
      if (
        normalizedSelector.includes("text=") ||
        normalizedSelector.includes(":has-text(")
      ) {
        // Extract text from text selectors
        const textMatch = normalizedSelector.match(
          /text="([^"]+)"|:has-text\("([^"]+)"\)/
        );
        if (textMatch) {
          const text = textMatch[1] || textMatch[2];
          if (text) {
            structuredSelector.identifier = { text };
            structuredSelector.fallbacks = [
              { textContains: text },
              { role: "button" },
              { role: "link" },
            ];
          }
        }
      } else if (normalizedSelector.startsWith("#")) {
        // ID selector
        structuredSelector.identifier = { id: normalizedSelector.substring(1) };
        structuredSelector.fallbacks = [];
      } else if (normalizedSelector.startsWith(".")) {
        // Class selector
        const className = normalizedSelector.substring(1);
        structuredSelector.identifier = { className };
        structuredSelector.fallbacks = [{ classContains: className }];
      } else {
        // Generic selector - try as text content
        const cleanText = normalizedSelector.replace(/['"]/g, "");
        structuredSelector.identifier = { textContains: cleanText };
        structuredSelector.fallbacks = [
          { classContains: cleanText },
          { id: cleanText },
        ];
      }

      const findResult = await elementFinder.findElement(
        page,
        structuredSelector
      );

      if (!findResult.found) {
        throw new Error(`Element not found: ${action.selector}`);
      }

      this.logger.info(`Element found successfully`, {
        actionId,
        selector: action.selector,
        strategy: findResult.strategy,
        finalSelector: findResult.selector,
        confidence: findResult.confidence,
      });
    } catch (error) {
      this.logger.error(`Find element failed`, {
        actionId,
        selector: action.selector,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async handleGetText(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector) {
      throw new Error("Get text action requires a selector");
    }

    const normalizedSelector = this.normalizeSelectorToString(action.selector);
    this.logger.info(`Getting text from element: ${action.selector}`, {
      actionId,
    });

    try {
      const text = await browserAutomation.getText(page, normalizedSelector, {
        timeout,
        elementFindOptions: {
          timeout,
          exact: false,
          caseSensitive: false,
        },
      });

      this.logger.info(`Text retrieved successfully`, {
        actionId,
        selector: action.selector,
        textLength: text.length,
        textPreview: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
      });
    } catch (error) {
      this.logger.error(`Get text failed`, {
        actionId,
        selector: action.selector,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async handleGetAttribute(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector || !action.attributeName) {
      throw new Error(
        "Get attribute action requires both selector and attributeName"
      );
    }

    const normalizedSelector = this.normalizeSelectorToString(action.selector);
    this.logger.info(
      `Getting attribute "${action.attributeName}" from element: ${action.selector}`,
      { actionId }
    );

    try {
      const value = await browserAutomation.getAttribute(
        page,
        normalizedSelector,
        action.attributeName,
        {
          timeout,
          elementFindOptions: {
            timeout,
            exact: false,
            caseSensitive: false,
          },
        }
      );

      this.logger.info(`Attribute retrieved successfully`, {
        actionId,
        selector: action.selector,
        attributeName: action.attributeName,
        value,
      });
    } catch (error) {
      this.logger.error(`Get attribute failed`, {
        actionId,
        selector: action.selector,
        attributeName: action.attributeName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async handleSetCheckbox(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector || action.checked === undefined) {
      throw new Error(
        "Set checkbox action requires both selector and checked value"
      );
    }

    const normalizedSelector = this.normalizeSelectorToString(action.selector);
    this.logger.info(
      `Setting checkbox "${action.selector}" to: ${action.checked}`,
      { actionId }
    );

    try {
      await browserAutomation.setCheckbox(
        page,
        normalizedSelector,
        action.checked,
        {
          timeout,
          elementFindOptions: {
            timeout,
            exact: false,
            caseSensitive: false,
          },
        }
      );

      this.logger.info(`Checkbox set successfully`, {
        actionId,
        selector: action.selector,
        checked: action.checked,
      });
    } catch (error) {
      this.logger.error(`Set checkbox failed`, {
        actionId,
        selector: action.selector,
        checked: action.checked,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async handleSelectOption(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector || action.optionValue === undefined) {
      throw new Error(
        "Select option action requires both selector and optionValue"
      );
    }

    const normalizedSelector = this.normalizeSelectorToString(action.selector);
    this.logger.info(
      `Selecting option "${action.optionValue}" from: ${action.selector}`,
      { actionId }
    );

    try {
      await browserAutomation.selectOption(
        page,
        normalizedSelector,
        action.optionValue,
        {
          timeout,
          elementFindOptions: {
            timeout,
            exact: false,
            caseSensitive: false,
          },
        }
      );

      this.logger.info(`Option selected successfully`, {
        actionId,
        selector: action.selector,
        optionValue: action.optionValue,
      });
    } catch (error) {
      this.logger.error(`Select option failed`, {
        actionId,
        selector: action.selector,
        optionValue: action.optionValue,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async handleScrollToElement(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector) {
      throw new Error("Scroll to element action requires a selector");
    }

    const normalizedSelector = this.normalizeSelectorToString(action.selector);
    this.logger.info(`Scrolling to element: ${action.selector}`, { actionId });

    try {
      await browserAutomation.scrollToElement(page, normalizedSelector, {
        timeout,
        elementFindOptions: {
          timeout,
          exact: false,
          caseSensitive: false,
        },
      });

      this.logger.info(`Scrolled to element successfully`, {
        actionId,
        selector: action.selector,
      });
    } catch (error) {
      this.logger.error(`Scroll to element failed`, {
        actionId,
        selector: action.selector,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async handleWaitForElement(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector) {
      throw new Error("Wait for element action requires a selector");
    }

    // Normalize selector to string format
    const normalizedSelector = this.normalizeSelectorToString(action.selector);

    const waitState = action.waitState || "visible";
    this.logger.info(
      `Waiting for element to be ${waitState}: ${action.selector}`,
      { actionId, normalizedSelector }
    );

    try {
      await browserAutomation.waitForElement(page, normalizedSelector, {
        timeout,
        state: waitState,
        exact: false,
        caseSensitive: false,
      });

      this.logger.info(`Element wait completed successfully`, {
        actionId,
        selector: action.selector,
        normalizedSelector,
        waitState,
      });
    } catch (error) {
      this.logger.error(`Wait for element failed`, {
        actionId,
        selector: action.selector,
        waitState,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
