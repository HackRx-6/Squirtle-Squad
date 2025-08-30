import type { Page } from "playwright";
import type { WebAutomationAction } from "./types";
import { loggingService } from "../logging";

export class ActionExecutor {
  private logger = loggingService.createComponentLogger("ActionExecutor");

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

        case "find_and_fill":
          await this.handleFindAndFill(page, action, timeout, actionId);
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
    
    await page.goto(action.url, {
      waitUntil: "domcontentloaded",
      timeout,
    });
    
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

    this.logger.info(`Waiting for clickable element: ${action.selector}`, {
      actionId,
    });

    try {
      // Wait for element to be visible and enabled
      await page.waitForSelector(action.selector, {
        state: "visible",
        timeout,
      });

      // Try multiple click strategies
      try {
        await page.click(action.selector, { timeout: 5000 });
      } catch (clickError: any) {
        this.logger.warn("Standard click failed, trying force click", {
          actionId,
          error: clickError.message,
        });
        await page.click(action.selector, { force: true, timeout: 5000 });
      }

      this.logger.info(`Click completed on: ${action.selector}`, { actionId });
    } catch (clickError: any) {
      this.logger.error("All click strategies failed", {
        actionId,
        selector: action.selector,
        error: clickError.message,
      });
      throw new Error(
        `Failed to click element ${action.selector}: ${clickError.message}`
      );
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

    this.logger.info(`Typing into element: ${action.selector}`, {
      actionId,
      textLength: action.text.length,
      textPreview:
        action.text.substring(0, 50) + (action.text.length > 50 ? "..." : ""),
    });

    // Try multiple strategies to find and fill the input
    try {
      await page.waitForSelector(action.selector, { timeout });
      await page.fill(action.selector, action.text);
      this.logger.info(`Text entered into: ${action.selector}`, { actionId });
    } catch (initialError: any) {
      this.logger.warn("Standard fill failed, trying alternative strategies", {
        actionId,
        error: initialError.message,
      });

      try {
        // Clear the field first, then type
        await page.click(action.selector);
        await page.keyboard.press("Control+a");
        await page.keyboard.type(action.text);
        this.logger.info(
          `Alternative typing strategy succeeded for: ${action.selector}`,
          { actionId }
        );
      } catch (alternativeError: any) {
        this.logger.error("All typing strategies failed", {
          actionId,
          selector: action.selector,
          error: alternativeError.message,
        });
        throw new Error(
          `Failed to type into element ${action.selector}: ${alternativeError.message}`
        );
      }
    }
  }

  private async handleWait(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (action.selector) {
      this.logger.info(`Waiting for element: ${action.selector}`, { actionId });
      await page.waitForSelector(action.selector, { timeout });
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
      this.logger.info(`Scrolling to element: ${action.selector}`, {
        actionId,
      });
      await page.waitForSelector(action.selector, { timeout });
      await page.locator(action.selector).scrollIntoViewIfNeeded();
      this.logger.info(`Scrolled to element: ${action.selector}`, {
        actionId,
      });
    } else {
      this.logger.info("Scrolling to bottom of page", { actionId });
      await page.evaluate(
        "window.scrollTo(0, document.body.scrollHeight)"
      );
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

    this.logger.info(`Hovering over element: ${action.selector}`, {
      actionId,
    });
    await page.waitForSelector(action.selector, { timeout });
    await page.hover(action.selector);
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

    this.logger.info(`Selecting option in: ${action.selector}`, {
      actionId,
      optionValue: action.text,
    });
    await page.waitForSelector(action.selector, { timeout });
    await page.selectOption(action.selector, action.text);
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

  private async handleFindAndFill(
    page: Page,
    action: WebAutomationAction,
    timeout: number,
    actionId: string
  ): Promise<void> {
    if (!action.selector || !action.text) {
      throw new Error("Find and fill action requires both selector and text");
    }

    this.logger.info(`Intelligent input finding for: ${action.selector}`, {
      actionId,
    });

    // More intelligent input finding
    try {
      // Try exact selector first
      await page.waitForSelector(action.selector, { timeout: 3000 });
    } catch {
      // Try partial text match for labels
      const labelSelector = `label:has-text("${action.selector}")`;
      try {
        await page.waitForSelector(labelSelector, { timeout: 2000 });
        const inputId = await page.getAttribute(labelSelector, "for");
        if (inputId) {
          action.selector = `#${inputId}`;
        }
      } catch {
        // Try input with placeholder
        action.selector = `input[placeholder*="${action.selector}" i]`;
      }
    }

    await page.fill(action.selector, action.text);
    this.logger.info(`Intelligent fill completed for: ${action.selector}`, {
      actionId,
    });
  }
}
