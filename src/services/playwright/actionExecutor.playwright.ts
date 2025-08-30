import type { Page } from "playwright";
import type { WebAutomationAction } from "./types";
import { loggingService } from "../logging";
import { browserAutomation } from "./browserAutomation.playwright";
import { elementFinder } from "./elementFinder.playwright";
import { inputFiller } from "./inputFiller.playwright";

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

    this.logger.info(`Executing intelligent click`, {
      actionId,
      selector: action.selector,
    });

    try {
      await browserAutomation.click(page, action.selector, {
        timeout,
        retryCount: 3,
        force: false, // Try normal click first, then force if needed
        elementFindOptions: {
          timeout,
          exact: false,
          caseSensitive: false,
        },
      });

      this.logger.info(`Click completed successfully`, {
        actionId,
        selector: action.selector,
      });
    } catch (error) {
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

    this.logger.info(`Executing intelligent type`, {
      actionId,
      selector: action.selector,
      textLength: action.text.length,
    });

    try {
      await browserAutomation.type(page, action.selector, action.text, {
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
      const findResult = await elementFinder.findElement(page, action.selector, {
        timeout,
        exact: false,
        caseSensitive: false,
      });

      if (!findResult.found) {
        throw new Error(`Element not found: ${action.selector}`);
      }

      this.logger.info(`Element found successfully`, {
        actionId,
        selector: action.selector,
        strategy: findResult.strategy,
        finalSelector: findResult.selector,
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

    this.logger.info(`Getting text from element: ${action.selector}`, { actionId });

    try {
      const text = await browserAutomation.getText(page, action.selector, {
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
      throw new Error("Get attribute action requires both selector and attributeName");
    }

    this.logger.info(`Getting attribute "${action.attributeName}" from element: ${action.selector}`, { actionId });

    try {
      const value = await browserAutomation.getAttribute(page, action.selector, action.attributeName, {
        timeout,
        elementFindOptions: {
          timeout,
          exact: false,
          caseSensitive: false,
        },
      });

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
      throw new Error("Set checkbox action requires both selector and checked value");
    }

    this.logger.info(`Setting checkbox "${action.selector}" to: ${action.checked}`, { actionId });

    try {
      await browserAutomation.setCheckbox(page, action.selector, action.checked, {
        timeout,
        elementFindOptions: {
          timeout,
          exact: false,
          caseSensitive: false,
        },
      });

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
      throw new Error("Select option action requires both selector and optionValue");
    }

    this.logger.info(`Selecting option "${action.optionValue}" from: ${action.selector}`, { actionId });

    try {
      await browserAutomation.selectOption(page, action.selector, action.optionValue, {
        timeout,
        elementFindOptions: {
          timeout,
          exact: false,
          caseSensitive: false,
        },
      });

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

    this.logger.info(`Scrolling to element: ${action.selector}`, { actionId });

    try {
      await browserAutomation.scrollToElement(page, action.selector, {
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

    const waitState = action.waitState || 'visible';
    this.logger.info(`Waiting for element to be ${waitState}: ${action.selector}`, { actionId });

    try {
      await browserAutomation.waitForElement(page, action.selector, {
        timeout,
        state: waitState,
        exact: false,
        caseSensitive: false,
      });

      this.logger.info(`Element wait completed successfully`, {
        actionId,
        selector: action.selector,
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
