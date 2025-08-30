import type { Page } from "playwright";
import { loggingService } from "../logging";
import { elementFinder, type ElementFindOptions } from "./elementFinder.playwright";
import { inputFiller, type InputFillOptions, type FormFillData } from "./inputFiller.playwright";

export interface BrowserAutomationOptions {
  timeout?: number;
  retryCount?: number;
  elementFindOptions?: ElementFindOptions;
  inputFillOptions?: InputFillOptions;
}

export interface ClickOptions extends BrowserAutomationOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  force?: boolean;
}

export interface NavigationOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface WaitOptions {
  timeout?: number;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
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
    const { timeout = 30000, waitUntil = 'load' } = options;

    this.logger.info(`Navigating to: ${url}`, { timeout, waitUntil });
    
    await page.goto(url, { timeout, waitUntil });
    
    this.logger.info(`Navigation completed`, { 
      finalUrl: page.url(),
      title: await page.title()
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
      button = 'left',
      clickCount = 1,
      delay = 0,
      force = false,
      timeout = 10000,
      retryCount = 3,
      elementFindOptions = {},
    } = options;

    this.logger.info(`Clicking element: ${identifier}`, {
      button,
      clickCount,
      delay,
      force,
    });

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        const findResult = await elementFinder.findElement(
          page,
          identifier,
          { ...elementFindOptions, timeout: timeout / retryCount }
        );

        if (!findResult.found) {
          this.logger.warn(`Attempt ${attempt}: Element not found`, { identifier });
          continue;
        }

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

    throw new Error(`Failed to click element "${identifier}" after ${retryCount} attempts`);
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
    const { delay = 50, clear = true } = options;

    this.logger.info(`Typing into element: ${identifier}`, { 
      textLength: text.length,
      delay,
      clear 
    });

    const result = await inputFiller.fillInput(page, identifier, text, {
      clear,
      delay,
      timeout: options.timeout,
      retryCount: options.retryCount,
      elementFindOptions: options.elementFindOptions,
    });

    if (!result.success) {
      throw new Error(`Failed to type into element "${identifier}": ${result.error}`);
    }

    this.logger.info(`Successfully typed into element`, {
      identifier,
      strategy: result.strategy,
      selector: result.selector,
    });
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

    this.logger.info(`Filling form with ${Object.keys(formData).length} fields`, {
      fields: Object.keys(formData),
      stopOnError,
    });

    const result = await inputFiller.fillForm(page, formData, {
      stopOnError,
      timeout: options.timeout,
      retryCount: options.retryCount,
      elementFindOptions: options.elementFindOptions,
      ...options.inputFillOptions,
    });

    if (!result.success) {
      const errorMsg = `Form filling failed with ${result.errors.length} errors: ${result.errors.join(', ')}`;
      throw new Error(errorMsg);
    }

    this.logger.info(`Successfully filled form`, {
      totalFields: Object.keys(formData).length,
      successfulFields: Object.values(result.results).filter(r => r.success).length,
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
    const { timeout = 10000, state = 'visible' } = options;

    this.logger.info(`Waiting for element: ${identifier}`, { timeout, state });

    const findResult = await elementFinder.findElement(page, identifier, options);

    if (!findResult.found) {
      throw new Error(`Element not found: ${identifier}`);
    }

    await findResult.element.waitFor({ state, timeout });

    this.logger.info(`Element found and ready`, {
      identifier,
      strategy: findResult.strategy,
      selector: findResult.selector,
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
    this.logger.info(`Getting text from element: ${identifier}`);

    const findResult = await elementFinder.findElement(
      page,
      identifier,
      options.elementFindOptions
    );

    if (!findResult.found) {
      throw new Error(`Element not found: ${identifier}`);
    }

    const text = await findResult.element.textContent() || '';

    this.logger.info(`Retrieved text from element`, {
      identifier,
      strategy: findResult.strategy,
      textLength: text.length,
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
    this.logger.info(`Getting attribute "${attributeName}" from element: ${identifier}`);

    const findResult = await elementFinder.findElement(
      page,
      identifier,
      options.elementFindOptions
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
      throw new Error(`Failed to select option "${option}" from "${identifier}": ${result.error}`);
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
      throw new Error(`Failed to set checkbox "${identifier}" to ${checked}: ${result.error}`);
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
    this.logger.info(`Scrolling to element: ${identifier}`);

    const findResult = await elementFinder.findElement(
      page,
      identifier,
      options.elementFindOptions
    );

    if (!findResult.found) {
      throw new Error(`Element not found: ${identifier}`);
    }

    await findResult.element.scrollIntoViewIfNeeded();

    this.logger.info(`Successfully scrolled to element`, {
      identifier,
      strategy: findResult.strategy,
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
    this.logger.info(`Hovering over element: ${identifier}`);

    const findResult = await elementFinder.findElement(
      page,
      identifier,
      options.elementFindOptions
    );

    if (!findResult.found) {
      throw new Error(`Element not found: ${identifier}`);
    }

    await findResult.element.hover();

    this.logger.info(`Successfully hovered over element`, {
      identifier,
      strategy: findResult.strategy,
    });
  }
}

export const browserAutomation = new BrowserAutomation();
