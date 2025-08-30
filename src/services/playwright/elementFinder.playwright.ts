import type { Page, Locator } from "playwright";
import { loggingService } from "../logging";

export interface ElementFindOptions {
  timeout?: number;
  exact?: boolean;
  caseSensitive?: boolean;
  retryStrategies?: ElementFindStrategy[];
}

export interface ElementFindStrategy {
  name: string;
  selector: string;
  priority: number;
}

export interface ElementFindResult {
  element: Locator;
  strategy: string;
  selector: string;
  found: boolean;
}

/**
 * Generic element finder with multiple strategies for robust element location
 */
export class ElementFinder {
  private logger = loggingService.createComponentLogger("ElementFinder");

  /**
   * Find an element using multiple intelligent strategies
   */
  async findElement(
    page: Page,
    identifier: string,
    options: ElementFindOptions = {}
  ): Promise<ElementFindResult> {
    const {
      timeout = 10000,
      exact = false,
      caseSensitive = false,
      retryStrategies,
    } = options;

    this.logger.info(`Finding element with identifier: ${identifier}`, {
      timeout,
      exact,
      caseSensitive,
    });

    // Generate strategies based on identifier
    const strategies = retryStrategies || this.generateStrategies(identifier, { exact, caseSensitive });

    // Sort strategies by priority (higher priority first)
    strategies.sort((a, b) => b.priority - a.priority);

    for (const strategy of strategies) {
      try {
        this.logger.debug(`Trying strategy: ${strategy.name}`, {
          selector: strategy.selector,
          priority: strategy.priority,
        });

        const element = page.locator(strategy.selector);
        
        // Check if element exists and is visible
        await element.waitFor({ state: 'visible', timeout: 3000 });
        
        this.logger.info(`Element found using strategy: ${strategy.name}`, {
          selector: strategy.selector,
        });

        return {
          element,
          strategy: strategy.name,
          selector: strategy.selector,
          found: true,
        };
      } catch (error) {
        this.logger.debug(`Strategy failed: ${strategy.name}`, {
          selector: strategy.selector,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // If no strategy worked, return a failed result
    this.logger.warn(`No element found for identifier: ${identifier}`);
    return {
      element: page.locator('not-found'),
      strategy: 'none',
      selector: identifier,
      found: false,
    };
  }

  /**
   * Find multiple elements matching criteria
   */
  async findElements(
    page: Page,
    identifier: string,
    options: ElementFindOptions = {}
  ): Promise<ElementFindResult[]> {
    const strategies = options.retryStrategies || this.generateStrategies(identifier, options);
    const results: ElementFindResult[] = [];

    for (const strategy of strategies) {
      try {
        const elements = page.locator(strategy.selector);
        const count = await elements.count();

        if (count > 0) {
          for (let i = 0; i < count; i++) {
            results.push({
              element: elements.nth(i),
              strategy: strategy.name,
              selector: `${strategy.selector}:nth-child(${i + 1})`,
              found: true,
            });
          }
        }
      } catch (error) {
        this.logger.debug(`Strategy failed for multiple elements: ${strategy.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Find input elements specifically (optimized for form inputs)
   */
  async findInputElement(
    page: Page,
    identifier: string,
    options: ElementFindOptions = {}
  ): Promise<ElementFindResult> {
    const inputStrategies = this.generateInputStrategies(identifier, options);
    return this.findElement(page, identifier, {
      ...options,
      retryStrategies: inputStrategies,
    });
  }

  /**
   * Generate intelligent strategies for finding elements
   */
  private generateStrategies(
    identifier: string,
    options: { exact?: boolean; caseSensitive?: boolean } = {}
  ): ElementFindStrategy[] {
    const { exact = false, caseSensitive = false } = options;
    const strategies: ElementFindStrategy[] = [];

    // Handle Playwright selector syntax first
    if (this.isPlaywrightSelector(identifier)) {
      strategies.push({
        name: 'playwright-selector',
        selector: identifier,
        priority: 100,
      });
      
      // If it's a text selector, also try variations
      if (identifier.includes('text=')) {
        const textContent = this.extractTextFromSelector(identifier);
        if (textContent) {
          strategies.push(...this.generateTextStrategies(textContent, options));
        }
      }
      
      return strategies;
    }

    // If identifier looks like a CSS selector, try it directly first
    if (this.isCssSelector(identifier)) {
      strategies.push({
        name: 'direct-css-selector',
        selector: identifier,
        priority: 100,
      });
    }

    // If identifier looks like an ID
    if (identifier.startsWith('#') || (!identifier.includes(' ') && !identifier.includes(':'))) {
      const idSelector = identifier.startsWith('#') ? identifier : `#${identifier}`;
      strategies.push({
        name: 'id-selector',
        selector: idSelector,
        priority: 95,
      });
    }

    // Generate text-based strategies
    strategies.push(...this.generateTextStrategies(identifier, options));

    // Generate attribute-based strategies
    strategies.push(...this.generateAttributeStrategies(identifier, options));

    return strategies;
  }

  /**
   * Generate text-based finding strategies
   */
  private generateTextStrategies(
    text: string,
    options: { exact?: boolean; caseSensitive?: boolean } = {}
  ): ElementFindStrategy[] {
    const { exact = false, caseSensitive = false } = options;
    const strategies: ElementFindStrategy[] = [];
    
    // Clean the text for better matching
    const cleanText = text.trim();
    
    // Exact text match strategies
    strategies.push(
      // Simple text selector (most reliable)
      {
        name: 'text-exact',
        selector: `text="${cleanText}"`,
        priority: 95,
      },
      // Partial text match
      {
        name: 'text-partial',
        selector: `text=${cleanText}`,
        priority: 90,
      },
      // Button with exact text
      {
        name: 'button-text-exact',
        selector: `button >> text="${cleanText}"`,
        priority: 92,
      },
      // Button with partial text
      {
        name: 'button-text-partial',
        selector: `button >> text=${cleanText}`,
        priority: 88,
      },
      // Link with text
      {
        name: 'link-text',
        selector: `a >> text="${cleanText}"`,
        priority: 85,
      },
      // Any element with exact text
      {
        name: 'element-text-exact',
        selector: `*:has-text("${cleanText}")`,
        priority: 80,
      },
      // Any element with partial text
      {
        name: 'element-text-partial',
        selector: `*:has-text("${cleanText}")`,
        priority: 75,
      }
    );

    // Case insensitive versions if needed
    if (!caseSensitive) {
      const lowerText = cleanText.toLowerCase();
      strategies.push(
        {
          name: 'text-case-insensitive',
          selector: `text=/${cleanText}/i`,
          priority: 85,
        },
        {
          name: 'button-text-case-insensitive',
          selector: `button >> text=/${cleanText}/i`,
          priority: 83,
        }
      );
    }

    return strategies;
  }

  /**
   * Generate attribute-based finding strategies
   */
  private generateAttributeStrategies(
    identifier: string,
    options: { caseSensitive?: boolean } = {}
  ): ElementFindStrategy[] {
    const { caseSensitive = false } = options;
    const textFlag = caseSensitive ? '' : ' i';
    
    return [
      // Data attributes
      {
        name: 'data-testid',
        selector: `[data-testid*="${identifier}"${textFlag}]`,
        priority: 85,
      },
      {
        name: 'data-cy',
        selector: `[data-cy*="${identifier}"${textFlag}]`,
        priority: 85,
      },
      // ARIA attributes
      {
        name: 'aria-label',
        selector: `[aria-label*="${identifier}"${textFlag}]`,
        priority: 80,
      },
      // Placeholder text
      {
        name: 'placeholder',
        selector: `[placeholder*="${identifier}"${textFlag}]`,
        priority: 75,
      },
      // Title attribute
      {
        name: 'title-attribute',
        selector: `[title*="${identifier}"${textFlag}]`,
        priority: 65,
      },
      // Class name partial match
      {
        name: 'class-partial',
        selector: `[class*="${identifier}"${textFlag}]`,
        priority: 60,
      }
    ];
  }

  /**
   * Check if a string is a Playwright selector
   */
  private isPlaywrightSelector(str: string): boolean {
    return (
      str.includes('>>') ||
      str.startsWith('text=') ||
      str.startsWith('xpath=') ||
      str.includes(':has-text(') ||
      str.includes(':visible') ||
      str.includes(':enabled') ||
      str.includes('nth-child(')
    );
  }

  /**
   * Extract text content from Playwright text selector
   */
  private extractTextFromSelector(selector: string): string | null {
    // Handle "text=Start Challenge" or ">> text=Start Challenge"
    const textMatch = selector.match(/text=["']?([^"']+)["']?/);
    if (textMatch && textMatch[1]) {
      return textMatch[1];
    }
    
    // Handle ":has-text("Start Challenge")"
    const hasTextMatch = selector.match(/:has-text\(["']([^"']+)["']\)/);
    if (hasTextMatch && hasTextMatch[1]) {
      return hasTextMatch[1];
    }
    
    return null;
  }

  /**
   * Generate strategies specifically optimized for input elements
   */
  private generateInputStrategies(
    identifier: string,
    options: { exact?: boolean; caseSensitive?: boolean } = {}
  ): ElementFindStrategy[] {
    const { exact = false, caseSensitive = false } = options;
    const textFlag = caseSensitive ? '' : 'i';
    const strategies: ElementFindStrategy[] = [];

    // Direct input selectors
    if (this.isCssSelector(identifier)) {
      strategies.push({
        name: 'direct-input-selector',
        selector: identifier,
        priority: 100,
      });
    }

    // Input-specific strategies
    strategies.push(
      // Input by name attribute
      {
        name: 'input-name',
        selector: `input[name="${identifier}"]`,
        priority: 95,
      },
      // Input by ID
      {
        name: 'input-id',
        selector: `input#${identifier.replace('#', '')}`,
        priority: 95,
      },
      // Input by placeholder
      {
        name: 'input-placeholder',
        selector: `input[placeholder*="${identifier}"${textFlag ? ' i' : ''}]`,
        priority: 90,
      },
      // Input by label (for attribute)
      {
        name: 'input-label-for',
        selector: `input#${identifier} | label[for*="${identifier}"] >> xpath=../input`,
        priority: 88,
      },
      // Input by associated label text
      {
        name: 'input-label-text',
        selector: `label:has-text("${identifier}") >> xpath=..//input | label:has-text("${identifier}") + input`,
        priority: 85,
      },
      // Textarea by placeholder
      {
        name: 'textarea-placeholder',
        selector: `textarea[placeholder*="${identifier}"${textFlag ? ' i' : ''}]`,
        priority: 85,
      },
      // Select by name
      {
        name: 'select-name',
        selector: `select[name="${identifier}"]`,
        priority: 85,
      },
      // Any form element by data-testid
      {
        name: 'form-element-testid',
        selector: `input[data-testid*="${identifier}"], textarea[data-testid*="${identifier}"], select[data-testid*="${identifier}"]`,
        priority: 82,
      },
      // Any form element by class
      {
        name: 'form-element-class',
        selector: `input[class*="${identifier}"], textarea[class*="${identifier}"], select[class*="${identifier}"]`,
        priority: 70,
      }
    );

    return strategies;
  }

  /**
   * Check if a string looks like a CSS selector
   */
  private isCssSelector(str: string): boolean {
    return (
      str.includes('#') ||
      str.includes('.') ||
      str.includes('[') ||
      str.includes(':') ||
      str.includes('>') ||
      str.includes('+') ||
      str.includes('~') ||
      str.includes('*')
    );
  }
}

export const elementFinder = new ElementFinder();
