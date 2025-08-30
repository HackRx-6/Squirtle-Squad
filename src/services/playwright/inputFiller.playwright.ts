import type { Page, Locator } from "playwright";
import { loggingService } from "../logging";
import { elementFinder, type ElementFindOptions, type ElementFindResult } from "./elementFinder.playwright";

export interface InputFillOptions {
  clear?: boolean;
  delay?: number;
  timeout?: number;
  force?: boolean;
  validate?: boolean;
  retryCount?: number;
  elementFindOptions?: ElementFindOptions;
}

export interface InputFillResult {
  success: boolean;
  elementFound: boolean;
  strategy: string;
  selector: string;
  finalValue?: string;
  error?: string;
}

export interface FormFillData {
  [key: string]: string | number | boolean;
}

export interface FormFillOptions extends InputFillOptions {
  stopOnError?: boolean;
  validateAll?: boolean;
}

export interface FormFillResult {
  success: boolean;
  results: { [key: string]: InputFillResult };
  errors: string[];
}

/**
 * Generic input filling utility with intelligent element finding and validation
 */
export class InputFiller {
  private logger = loggingService.createComponentLogger("InputFiller");

  /**
   * Fill a single input element with intelligent finding and validation
   */
  async fillInput(
    page: Page,
    identifier: string,
    value: string | number | boolean,
    options: InputFillOptions = {}
  ): Promise<InputFillResult> {
    const {
      clear = true,
      delay = 50,
      timeout = 10000,
      force = false,
      validate = true,
      retryCount = 3,
      elementFindOptions = {},
    } = options;

    this.logger.info(`Filling input: ${identifier}`, {
      value: String(value),
      clear,
      delay,
      timeout,
    });

    let lastError: string = '';
    
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        // Find the input element
        const findResult = await elementFinder.findInputElement(
          page,
          identifier,
          { ...elementFindOptions, timeout: timeout / retryCount }
        );

        if (!findResult.found) {
          lastError = `Element not found: ${identifier}`;
          this.logger.warn(`Attempt ${attempt}: Element not found`, { identifier });
          continue;
        }

        // Fill the input
        const fillResult = await this.performFill(
          findResult.element,
          String(value),
          { clear, delay, force, validate }
        );

        if (fillResult.success) {
          this.logger.info(`Successfully filled input: ${identifier}`, {
            strategy: findResult.strategy,
            selector: findResult.selector,
            value: String(value),
            attempt,
          });

          return {
            success: true,
            elementFound: true,
            strategy: findResult.strategy,
            selector: findResult.selector,
            finalValue: fillResult.finalValue,
          };
        } else {
          lastError = fillResult.error || 'Fill operation failed';
          this.logger.warn(`Attempt ${attempt}: Fill failed`, {
            identifier,
            error: lastError,
          });
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Attempt ${attempt}: Exception occurred`, {
          identifier,
          error: lastError,
        });
      }

      if (attempt < retryCount) {
        await page.waitForTimeout(1000 * attempt); // Progressive backoff
      }
    }

    this.logger.error(`Failed to fill input after ${retryCount} attempts`, {
      identifier,
      error: lastError,
    });

    return {
      success: false,
      elementFound: false,
      strategy: 'none',
      selector: identifier,
      error: lastError,
    };
  }

  /**
   * Fill multiple form inputs efficiently
   */
  async fillForm(
    page: Page,
    formData: FormFillData,
    options: FormFillOptions = {}
  ): Promise<FormFillResult> {
    const {
      stopOnError = false,
      validateAll = true,
      ...inputOptions
    } = options;

    this.logger.info(`Filling form with ${Object.keys(formData).length} fields`, {
      fields: Object.keys(formData),
      stopOnError,
      validateAll,
    });

    const results: { [key: string]: InputFillResult } = {};
    const errors: string[] = [];

    for (const [identifier, value] of Object.entries(formData)) {
      try {
        const result = await this.fillInput(page, identifier, value, {
          ...inputOptions,
          validate: validateAll,
        });

        results[identifier] = result;

        if (!result.success) {
          const error = `Failed to fill ${identifier}: ${result.error}`;
          errors.push(error);
          
          if (stopOnError) {
            this.logger.error('Stopping form fill due to error', { identifier, error });
            break;
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const fullError = `Exception filling ${identifier}: ${errorMsg}`;
        errors.push(fullError);
        
        results[identifier] = {
          success: false,
          elementFound: false,
          strategy: 'none',
          selector: identifier,
          error: errorMsg,
        };

        if (stopOnError) {
          this.logger.error('Stopping form fill due to exception', { identifier, error: errorMsg });
          break;
        }
      }
    }

    const success = errors.length === 0;
    
    this.logger.info(`Form fill completed`, {
      success,
      totalFields: Object.keys(formData).length,
      successfulFields: Object.values(results).filter(r => r.success).length,
      errorCount: errors.length,
    });

    return {
      success,
      results,
      errors,
    };
  }

  /**
   * Select an option from a dropdown/select element
   */
  async selectOption(
    page: Page,
    identifier: string,
    option: string | number,
    options: InputFillOptions = {}
  ): Promise<InputFillResult> {
    const {
      timeout = 10000,
      retryCount = 3,
      elementFindOptions = {},
    } = options;

    this.logger.info(`Selecting option: ${identifier}`, { option });

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        const findResult = await elementFinder.findInputElement(
          page,
          identifier,
          { ...elementFindOptions, timeout: timeout / retryCount }
        );

        if (!findResult.found) {
          continue;
        }

        // Try different selection strategies
        const element = findResult.element;
        
        // Check if it's a select element
        const tagName = await element.evaluate('el => el.tagName.toLowerCase()');
        
        if (tagName === 'select') {
          await element.selectOption({ label: String(option) });
        } else {
          // Try clicking on option in custom dropdown
          const optionSelector = `${findResult.selector} option:has-text("${option}")`;
          await page.click(optionSelector);
        }

        this.logger.info(`Successfully selected option`, {
          identifier,
          option,
          strategy: findResult.strategy,
        });

        return {
          success: true,
          elementFound: true,
          strategy: findResult.strategy,
          selector: findResult.selector,
          finalValue: String(option),
        };
      } catch (error) {
        this.logger.warn(`Selection attempt ${attempt} failed`, {
          identifier,
          option,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: false,
      elementFound: false,
      strategy: 'none',
      selector: identifier,
      error: `Failed to select option after ${retryCount} attempts`,
    };
  }

  /**
   * Check/uncheck a checkbox or radio button
   */
  async setCheckbox(
    page: Page,
    identifier: string,
    checked: boolean,
    options: InputFillOptions = {}
  ): Promise<InputFillResult> {
    const {
      timeout = 10000,
      retryCount = 3,
      elementFindOptions = {},
    } = options;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        const findResult = await elementFinder.findInputElement(
          page,
          identifier,
          { ...elementFindOptions, timeout: timeout / retryCount }
        );

        if (!findResult.found) {
          continue;
        }

        await findResult.element.setChecked(checked);

        return {
          success: true,
          elementFound: true,
          strategy: findResult.strategy,
          selector: findResult.selector,
          finalValue: String(checked),
        };
      } catch (error) {
        this.logger.warn(`Checkbox attempt ${attempt} failed`, {
          identifier,
          checked,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: false,
      elementFound: false,
      strategy: 'none',
      selector: identifier,
      error: `Failed to set checkbox after ${retryCount} attempts`,
    };
  }

  /**
   * Perform the actual fill operation on a located element
   */
  private async performFill(
    element: Locator,
    value: string,
    options: {
      clear?: boolean;
      delay?: number;
      force?: boolean;
      validate?: boolean;
    }
  ): Promise<{ success: boolean; finalValue?: string; error?: string }> {
    const { clear = true, delay = 50, force = false, validate = true } = options;

    try {
      // Wait for element to be ready
      await element.waitFor({ state: 'visible' });

      // Clear existing content if requested
      if (clear) {
        await element.clear();
      }

      // Fill the element
      await element.fill(value, { force });

      // Add typing delay if specified
      if (delay > 0) {
        await element.type(value, { delay });
      }

      // Validate the fill if requested
      if (validate) {
        const actualValue = await element.inputValue().catch(() => '');
        if (actualValue !== value) {
          return {
            success: false,
            error: `Validation failed: expected "${value}", got "${actualValue}"`,
          };
        }
        return { success: true, finalValue: actualValue };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const inputFiller = new InputFiller();
