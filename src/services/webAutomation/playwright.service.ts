import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import type {
  WebAutomationAction,
  WebAutomationResult,
  WebAutomationRequest,
  PlaywrightServiceConfig,
} from "./types";
import { sentryMonitoringService } from "../monitoring";
import { loggingService } from "../logging";
import { htmlCleaningService, type HTMLCleaningOptions } from "../cleaning";

export class PlaywrightService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private config: PlaywrightServiceConfig;
  private logger = loggingService.createComponentLogger("PlaywrightService");

  // Add persistent page management
  private persistentPages: Map<string, Page> = new Map();
  private currentSessionId: string | null = null;
  private sessionStartTime: number = 0;

  constructor(config?: Partial<PlaywrightServiceConfig>) {
    this.config = {
      defaultTimeout: 15000, // Reduced from 30000ms to 15000ms for faster responses
      defaultViewport: { width: 1280, height: 720 },
      headless: true,
      maxConcurrentPages: 3,
      ...config,
    };

    this.logger.info("PlaywrightService initialized", {
      config: this.config,
    });
  }

  private async initializeBrowser(): Promise<void> {
    if (!this.browser) {
      this.logger.info("Launching Chromium browser", {
        headless: this.config.headless,
        args: [
          "--no-sandbox", 
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage", // Overcome limited resource problems
          "--disable-extensions", // Disable extensions for speed
          "--disable-gpu", // Disable GPU for faster startup in headless
          "--disable-background-timer-throttling", // Don't throttle timers
          "--disable-renderer-backgrounding", // Don't background render
          "--disable-backgrounding-occluded-windows",
          "--no-first-run", // Skip first run setup
          "--disable-default-apps", // Don't load default apps
        ],
      });

      const startTime = Date.now();
      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          "--no-sandbox", 
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-extensions",
          "--disable-gpu",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding", 
          "--disable-backgrounding-occluded-windows",
          "--no-first-run",
          "--disable-default-apps",
        ],
      });

      const launchTime = Date.now() - startTime;
      this.logger.info("Chromium browser launched successfully", {
        launchTimeMs: launchTime,
        headless: this.config.headless,
      });
    }

    if (!this.context) {
      this.logger.info("Creating new browser context", {
        viewport: this.config.defaultViewport,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      });

      this.context = await this.browser.newContext({
        viewport: this.config.defaultViewport,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        // Performance optimizations
        ignoreHTTPSErrors: true, // Ignore SSL errors for faster loading
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9', // Set language
        },
        // Disable unnecessary features for speed
        javaScriptEnabled: true, // Keep JS enabled since we need it
        bypassCSP: true, // Bypass content security policy
      });
      
      // Set faster timeout defaults for the context
      this.context.setDefaultTimeout(this.config.defaultTimeout);
      this.context.setDefaultNavigationTimeout(this.config.defaultTimeout);

      this.logger.info("Browser context created successfully");
    }
  }

  private async executeAction(
    page: Page,
    action: WebAutomationAction
  ): Promise<void> {
    const timeout = action.timeout || this.config.defaultTimeout;
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
          if (!action.url) throw new Error("URL required for navigate action");
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
          break;

        case "click":
          if (!action.selector)
            throw new Error("Selector required for click action");
          this.logger.info(
            `Waiting for clickable element: ${action.selector}`,
            { actionId }
          );
          
          try {
            // Use shorter timeout for better responsiveness
            await page.waitForSelector(action.selector, { 
              timeout: Math.min(timeout, 10000), // Max 10 seconds
              state: 'visible' 
            });
            
            this.logger.info(`Clicking element: ${action.selector}`, {
              actionId,
            });
            await page.click(action.selector, { timeout: 5000, ...action.options });
            this.logger.info(`Click completed on: ${action.selector}`, {
              actionId,
            });
          } catch (clickError: any) {
            this.logger.warn(`Click failed, trying alternative approach`, {
              actionId,
              error: clickError?.message || 'Unknown error',
            });
            
            // Alternative: Try to click using locator
            try {
              const locator = page.locator(action.selector);
              await locator.click({ timeout: 5000 });
              this.logger.info(`Click completed with locator: ${action.selector}`, {
                actionId,
              });
            } catch (locatorError: any) {
              throw new Error(`Could not click element ${action.selector}: ${clickError?.message || 'Unknown error'}`);
            }
          }
          break;

        case "type":
          if (!action.selector || !action.text)
            throw new Error("Selector and text required for type action");
          this.logger.info(`Typing into element: ${action.selector}`, {
            actionId,
            textLength: action.text.length,
            textPreview:
              action.text.substring(0, 50) +
              (action.text.length > 50 ? "..." : ""),
          });
          
          // Try multiple strategies to find and fill the input
          try {
            // Strategy 1: Wait for selector with shorter timeout and retry
            this.logger.info(`Waiting for input element: ${action.selector}`, { actionId });
            await page.waitForSelector(action.selector, { 
              timeout: Math.min(timeout, 10000), // Max 10 seconds
              state: 'visible' 
            });
            
            // Clear and fill the input
            await page.fill(action.selector, ''); // Clear first
            await page.fill(action.selector, action.text);
            
            this.logger.info(`Text input completed for: ${action.selector}`, {
              actionId,
            });
          } catch (initialError: any) {
            this.logger.warn(`Initial strategy failed, trying alternatives`, {
              actionId,
              error: initialError?.message || 'Unknown error',
            });
            
            // Strategy 2: Try common input selectors if the specific one fails
            const fallbackSelectors = [
              action.selector,
              'input[type="text"]',
              'input[type="email"]', 
              'input[type="search"]',
              'input[name*="search"]',
              'input[placeholder*="search"]',
              'input[class*="search"]',
              'input[class*="input"]',
              '[role="searchbox"]',
              'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
              'textarea',
              '[contenteditable="true"]'
            ];
            
            let success = false;
            for (const selector of fallbackSelectors) {
              try {
                const elements = await page.$$(selector);
                if (elements.length > 0) {
                  this.logger.info(`Trying fallback selector: ${selector}`, { actionId });
                  await page.fill(selector, ''); // Clear first
                  await page.fill(selector, action.text);
                  success = true;
                  this.logger.info(`Text input completed with fallback: ${selector}`, { actionId });
                  break;
                }
              } catch (fallbackError: any) {
                this.logger.debug(`Fallback selector failed: ${selector}`, {
                  actionId,
                  error: fallbackError?.message || 'Unknown error',
                });
                continue;
              }
            }
            
            if (!success) {
              // Log available input elements for debugging
              try {
                const availableInputs = await page.$$eval('input, textarea', elements => 
                  elements.map(el => ({
                    tagName: el.tagName.toLowerCase(),
                    type: el.type || 'text',
                    id: el.id || null,
                    name: el.name || null,
                    className: el.className || null,
                    placeholder: el.placeholder || null
                  }))
                );
                
                this.logger.warn(`Available input elements on page:`, {
                  actionId,
                  availableInputs: availableInputs.slice(0, 10), // Limit to first 10
                });
              } catch (debugError) {
                this.logger.debug('Could not get available inputs for debugging', { actionId });
              }
              
              throw new Error(`Could not find any input element for selector: ${action.selector}`);
            }
          }
          break;

        case "wait":
          if (action.selector) {
            this.logger.info(`Waiting for element: ${action.selector}`, {
              actionId,
            });
            await page.waitForSelector(action.selector, { timeout });
            this.logger.info(`Element appeared: ${action.selector}`, {
              actionId,
            });
          } else {
            const waitTime = action.timeout || 1000;
            this.logger.info(`Waiting for timeout: ${waitTime}ms`, {
              actionId,
            });
            await page.waitForTimeout(waitTime);
            this.logger.info(`Timeout wait completed: ${waitTime}ms`, {
              actionId,
            });
          }
          break;

        case "scroll":
          if (action.selector) {
            this.logger.info(`Scrolling to element: ${action.selector}`, {
              actionId,
            });
            await page.locator(action.selector).scrollIntoViewIfNeeded();
            this.logger.info(`Scrolled to element: ${action.selector}`, {
              actionId,
            });
          } else {
            this.logger.info("Scrolling to bottom of page", { actionId });
            await page.evaluate(() =>
              window.scrollTo(0, document.body.scrollHeight)
            );
            this.logger.info("Scrolled to bottom of page", { actionId });
          }
          break;

        case "hover":
          if (!action.selector)
            throw new Error("Selector required for hover action");
          this.logger.info(`Hovering over element: ${action.selector}`, {
            actionId,
          });
          await page.waitForSelector(action.selector, { timeout });
          await page.hover(action.selector);
          this.logger.info(`Hover completed on: ${action.selector}`, {
            actionId,
          });
          break;

        case "select":
          if (!action.selector || !action.text)
            throw new Error("Selector and text required for select action");
          this.logger.info(`Selecting option in: ${action.selector}`, {
            actionId,
            optionValue: action.text,
          });
          await page.waitForSelector(action.selector, { timeout });
          await page.selectOption(action.selector, action.text);
          this.logger.info(`Option selected in: ${action.selector}`, {
            actionId,
          });
          break;

        case "fill_form":
          if (!action.formData)
            throw new Error("Form data required for fill_form action");

          this.logger.info("Filling form with multiple fields", {
            actionId,
            fieldCount: Object.keys(action.formData).length,
            fields: Object.keys(action.formData),
          });

          // Fill multiple form fields
          for (const [selector, value] of Object.entries(action.formData)) {
            this.logger.debug(`Filling form field: ${selector}`, {
              actionId,
              selector,
              valueLength: value.length,
            });
            await page.waitForSelector(selector, { timeout });
            await page.fill(selector, value);
          }
          this.logger.info("Form filling completed", { actionId });
          break;

        case "submit_form":
          const submitSelector =
            action.submitSelector ||
            'input[type="submit"], button[type="submit"], button:has-text("Submit")';
          this.logger.info(`Submitting form with selector: ${submitSelector}`, {
            actionId,
          });
          await page.waitForSelector(submitSelector, { timeout });
          await page.click(submitSelector);
          this.logger.info("Form submission completed", { actionId });
          break;

        case "find_and_fill":
          if (!action.selector || !action.text)
            throw new Error(
              "Selector and text required for find_and_fill action"
            );

          this.logger.info(
            `Intelligent input finding for: ${action.selector}`,
            { actionId }
          );

          // More intelligent input finding
          try {
            await page.waitForSelector(action.selector, { timeout });
            this.logger.info(`Found exact selector: ${action.selector}`, {
              actionId,
            });
          } catch {
            this.logger.warn(
              `Exact selector failed, trying fallback methods for: ${action.selector}`,
              { actionId }
            );

            // If exact selector fails, try common input selectors
            const commonSelectors = [
              `input[name*="${action.selector}"]`,
              `input[id*="${action.selector}"]`,
              `input[placeholder*="${action.selector}"]`,
              `textarea[name*="${action.selector}"]`,
              `textarea[id*="${action.selector}"]`,
            ];

            let found = false;
            for (const fallbackSelector of commonSelectors) {
              try {
                this.logger.debug(
                  `Trying fallback selector: ${fallbackSelector}`,
                  { actionId }
                );
                await page.waitForSelector(fallbackSelector, { timeout: 2000 });
                action.selector = fallbackSelector;
                found = true;
                this.logger.info(
                  `Found element with fallback selector: ${fallbackSelector}`,
                  { actionId }
                );
                break;
              } catch {
                continue;
              }
            }

            if (!found) {
              this.logger.error(`Could not find any matching input element`, {
                actionId,
                originalSelector: action.selector,
                triedSelectors: commonSelectors,
              });
              throw new Error(
                `Could not find input element matching: ${action.selector}`
              );
            }
          }

          await page.fill(action.selector, action.text);
          this.logger.info(
            `Intelligent fill completed for: ${action.selector}`,
            { actionId }
          );
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

  // Persistent page management methods
  async getOrCreatePersistentPage(sessionId: string): Promise<Page> {
    this.logger.info("Getting or creating persistent page", { sessionId });

    // Check if we already have a page for this session
    let page = this.persistentPages.get(sessionId);

    if (page && !page.isClosed()) {
      this.logger.info("Reusing existing page", {
        sessionId,
        currentUrl: page.url(),
      });
      return page;
    }

    // Remove closed page from map if it exists
    if (page) {
      this.persistentPages.delete(sessionId);
      this.logger.warn("Removed closed page from map", { sessionId });
    }

    // Initialize browser if needed
    await this.initializeBrowser();
    if (!this.context) throw new Error("Browser context not initialized");

    // Create new page
    this.logger.info("Creating new persistent page", { sessionId });
    page = await this.context.newPage();

    // Set optimized timeouts for faster operations
    page.setDefaultTimeout(this.config.defaultTimeout);
    page.setDefaultNavigationTimeout(this.config.defaultTimeout);
    
    // Set up page performance optimizations
    await page.route('**/*', route => {
      const resourceType = route.request().resourceType();
      const url = route.request().url();
      
      // Block unnecessary resources for faster loading, but allow essential ones
      if (['image', 'font'].includes(resourceType)) {
        route.abort();
      } else if (resourceType === 'stylesheet') {
        // Allow critical CSS but block non-essential styling
        if (url.includes('bootstrap') || url.includes('cdn') || url.includes('googleapis')) {
          route.abort();
        } else {
          route.continue();
        }
      } else {
        route.continue();
      }
    });

    this.logger.info("Page performance optimizations applied", { sessionId });

    // Store in map
    this.persistentPages.set(sessionId, page);
    this.currentSessionId = sessionId;
    this.sessionStartTime = Date.now();

    this.logger.info("Created persistent page successfully", {
      sessionId,
      totalPersistentPages: this.persistentPages.size,
    });

    return page;
  }

  async closePersistentPage(sessionId: string): Promise<void> {
    this.logger.info("Closing persistent page", { sessionId });

    const page = this.persistentPages.get(sessionId);
    if (page && !page.isClosed()) {
      try {
        await page.close();
        this.logger.info("Persistent page closed successfully", { sessionId });
      } catch (error) {
        this.logger.error("Error closing persistent page", {
          sessionId,
          error,
        });
      }
    }

    this.persistentPages.delete(sessionId);

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
      this.sessionStartTime = 0;
    }

    this.logger.info("Persistent page removed from map", {
      sessionId,
      remainingPages: this.persistentPages.size,
    });
  }

  async getCurrentPage(): Promise<Page | null> {
    if (!this.currentSessionId) return null;

    const page = this.persistentPages.get(this.currentSessionId);
    return page && !page.isClosed() ? page : null;
  }

  async executeWebAutomation(
    request: WebAutomationRequest
  ): Promise<WebAutomationResult> {
    const sessionId = `automation_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    this.logger.info("Starting web automation session", {
      sessionId,
      url: request.url,
      actionCount: request.actions.length,
      actions: request.actions.map((a) => ({
        type: a.type,
        selector: a.selector,
      })),
      options: request.options,
    });

    return await sentryMonitoringService.track(
      "web_automation_execution",
      "pdf_processing",
      { url: request.url, actionCount: request.actions.length, sessionId },
      async () => {
        let page: Page | null = null;
        const startTime = Date.now();

        try {
          this.logger.info("Initializing browser for automation", {
            sessionId,
          });
          await this.initializeBrowser();
          if (!this.context) throw new Error("Browser context not initialized");

          this.logger.info("Creating new page", { sessionId });
          page = await this.context.newPage();

          // Set default timeout
          const timeout =
            request.options?.timeout || this.config.defaultTimeout;
          page.setDefaultTimeout(timeout);
          this.logger.info("Page created and timeout set", {
            sessionId,
            timeout,
          });

          // Navigate to initial URL if not already included in actions
          const hasNavigateAction = request.actions.some(
            (action) => action.type === "navigate"
          );
          if (!hasNavigateAction) {
            this.logger.info("Navigating to initial URL (not in actions)", {
              sessionId,
              url: request.url,
            });
            await page.goto(request.url, { waitUntil: "domcontentloaded" });
            this.logger.info("Initial navigation completed", {
              sessionId,
              finalUrl: page.url(),
            });
          } else {
            this.logger.info(
              "Navigation action found in sequence, skipping initial navigation",
              { sessionId }
            );
          }

          // Execute all actions in sequence
          let initialUrl = page.url();
          this.logger.info("Starting action execution sequence", {
            sessionId,
            initialUrl,
            totalActions: request.actions.length,
          });

          for (let i = 0; i < request.actions.length; i++) {
            const action = request.actions[i];
            if (!action) continue; // Safety check

            const actionNumber = i + 1;

            this.logger.info(
              `Executing action ${actionNumber}/${request.actions.length}`,
              {
                sessionId,
                actionNumber,
                actionType: action.type,
                currentUrl: page.url(),
              }
            );

            console.log(
              `🎭 [${sessionId}] Executing action ${actionNumber}/${
                request.actions.length
              }: ${action.type}${
                action.selector ? ` on ${action.selector}` : ""
              }`
            );

            await this.executeAction(page, action);

            // Check if URL changed after this action
            const currentUrl = page.url();
            if (currentUrl !== initialUrl) {
              this.logger.info("URL change detected", {
                sessionId,
                actionNumber,
                fromUrl: initialUrl,
                toUrl: currentUrl,
              });
              console.log(
                `🔄 [${sessionId}] URL changed from ${initialUrl} to ${currentUrl}`
              );
              // Wait for the new page to load completely
              await page.waitForLoadState("domcontentloaded");
              this.logger.info("New page loaded after URL change", {
                sessionId,
                actionNumber,
              });
              initialUrl = currentUrl;
            }

            // Small delay between actions to ensure stability
            await page.waitForTimeout(500);
            this.logger.debug(
              `Action ${actionNumber} completed, waiting 500ms before next action`,
              { sessionId }
            );
          }

          this.logger.info("All actions completed successfully", {
            sessionId,
            finalUrl: page.url(),
            totalActions: request.actions.length,
          });

          // Wait for network idle if requested
          if (request.options?.waitForNetworkIdle) {
            this.logger.info("Waiting for network idle as requested", {
              sessionId,
            });
            await page.waitForLoadState("networkidle", { timeout: 10000 });
            this.logger.info("Network idle completed", { sessionId });
          }

          const result: WebAutomationResult = {
            success: true,
            url: page.url(),
            metadata: {
              title: await page.title(),
              timestamp: Date.now(),
            },
          };

          // Get page content if requested
          if (request.options?.includeContent !== false) {
            this.logger.info("Extracting page content", { sessionId });

            // Check if enhanced extraction is requested
            if (request.options?.useEnhancedExtraction) {
              this.logger.info("Using enhanced content extraction", { sessionId });

              const enhancedContent = await this.extractEnhancedPageContent(page, {
                includeHTML: request.options.enhancedExtractionOptions?.includeHTML ?? true,
                htmlCleaningOptions: request.options.enhancedExtractionOptions?.htmlCleaningOptions,
                includeInteractiveElements: request.options.enhancedExtractionOptions?.includeInteractiveElements ?? true,
                maxContentSize: request.options.enhancedExtractionOptions?.maxContentSize ?? 50000,
              });

              result.pageContent = JSON.stringify(enhancedContent, null, 2);

              this.logger.info("Enhanced page content extracted", {
                sessionId,
                titleLength: enhancedContent.title.length,
                textLength: enhancedContent.text.length,
                htmlIncluded: !!enhancedContent.html,
                htmlSize: enhancedContent.html?.length || 0,
                formsCount: enhancedContent.interactiveElements?.forms.length || 0,
                buttonsCount: enhancedContent.interactiveElements?.buttons.length || 0,
                linksCount: enhancedContent.interactiveElements?.links.length || 0,
                compressionRatio: enhancedContent.metadata.compressionRatio 
                  ? Math.round(enhancedContent.metadata.compressionRatio * 100) 
                  : 0,
              });
            } else {
              // Use original basic content extraction
              const title = await page.title();
              const textContent = await page.textContent("body");
              const cleanText = textContent?.replace(/\s+/g, " ").trim() || "";

              // Get interactive elements
              const buttons = await page.$$eval(
                'button, input[type="button"], input[type="submit"]',
                (elements) =>
                  elements
                    .map((el) => el.textContent?.trim() || (el as any).value)
                    .filter(Boolean)
              );

              const links = await page.$$eval("a[href]", (elements) =>
                elements
                  .map((el) => ({
                    text: el.textContent?.trim(),
                    href: (el as any).href,
                  }))
                  .filter((l) => l.text && l.text.length > 0)
              );

              const content = {
                title,
                text: cleanText, // Remove character limit
                buttons: buttons.slice(0, 20), // Increase button limit
                links: links.slice(0, 50), // Increase link limit
              };

              result.pageContent = JSON.stringify(content, null, 2);

              this.logger.info("Basic page content extracted", {
                sessionId,
                titleLength: title.length,
                textLength: cleanText.length,
                buttonCount: buttons.length,
                linkCount: links.length,
              });
            }
          }

          const totalTime = Date.now() - startTime;
          this.logger.info("Web automation session completed successfully", {
            sessionId,
            totalTimeMs: totalTime,
            finalUrl: result.url,
            success: true,
          });

          return result;
        } catch (error: any) {
          const totalTime = Date.now() - startTime;
          this.logger.error("Web automation session failed", {
            sessionId,
            error: error.message,
            stack: error.stack,
            totalTimeMs: totalTime,
            currentUrl: page?.url(),
          });

          console.error(`❌ [${sessionId}] Web automation error:`, error);

          return {
            success: false,
            error: error.message || "Unknown web automation error",
            url: page?.url(),
            metadata: {
              timestamp: Date.now(),
            },
          };
        } finally {
          if (page) {
            try {
              this.logger.info("Closing page", { sessionId });
              await page.close();
              this.logger.info("Page closed successfully", { sessionId });
            } catch (closeError) {
              this.logger.warn("Failed to close page", {
                sessionId,
                error: closeError,
              });
              console.warn(
                `⚠️ [${sessionId}] Failed to close page:`,
                closeError
              );
            }
          }
        }
      }
    );
  }

  async executeWebAutomationPersistent(
    request: WebAutomationRequest,
    sessionId?: string
  ): Promise<WebAutomationResult> {
    // Use provided sessionId or create a new one
    const actualSessionId =
      sessionId ||
      `persistent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.logger.info("Starting persistent web automation session", {
      sessionId: actualSessionId,
      url: request.url,
      actionCount: request.actions.length,
      actions: request.actions.map((a) => ({
        type: a.type,
        selector: a.selector,
      })),
      options: request.options,
      isReusedSession: !!sessionId,
    });

    return await sentryMonitoringService.track(
      "web_automation_persistent_execution",
      "pdf_processing",
      {
        url: request.url,
        actionCount: request.actions.length,
        sessionId: actualSessionId,
      },
      async () => {
        const startTime = Date.now();

        try {
          this.logger.info("Getting persistent page", {
            sessionId: actualSessionId,
          });
          const page = await this.getOrCreatePersistentPage(actualSessionId);

          // Set default timeout
          const timeout =
            request.options?.timeout || this.config.defaultTimeout;
          page.setDefaultTimeout(timeout);
          this.logger.info("Page timeout set", {
            sessionId: actualSessionId,
            timeout,
          });

          // Navigate to initial URL if not already included in actions
          const hasNavigateAction = request.actions.some(
            (action) => action.type === "navigate"
          );
          if (!hasNavigateAction) {
            this.logger.info(`Navigating to initial URL: ${request.url}`, {
              sessionId: actualSessionId,
            });
            
            // Use faster loading strategy - only wait for DOM content
            await page.goto(request.url, {
              waitUntil: "domcontentloaded", // Don't wait for all resources
              timeout: Math.min(timeout, 15000), // Max 15 seconds for navigation
            });
            
            // Small wait for critical elements to appear
            await page.waitForTimeout(500);
            
            this.logger.info(`Navigation completed: ${page.url()}`, {
              sessionId: actualSessionId,
            });
          } else {
            this.logger.info(
              "Skipping initial navigation - navigate action found in actions list",
              { sessionId: actualSessionId }
            );
          }

          // Execute all actions in sequence
          let initialUrl = page.url();
          this.logger.info("Starting action execution sequence", {
            sessionId: actualSessionId,
            initialUrl,
            totalActions: request.actions.length,
          });

          for (let i = 0; i < request.actions.length; i++) {
            const action = request.actions[i];
            if (!action) continue; // Skip if action is undefined

            const actionNumber = i + 1;

            this.logger.info(
              `Executing action ${actionNumber}/${request.actions.length}`,
              {
                sessionId: actualSessionId,
                actionNumber,
                actionType: action.type,
                currentUrl: page.url(),
              }
            );

            console.log(
              `🎭 [${actualSessionId}] Executing action ${actionNumber}/${
                request.actions.length
              }: ${action.type}${
                action.selector ? ` on ${action.selector}` : ""
              }`
            );

            await this.executeAction(page, action);

            // Check if URL changed after this action
            const currentUrl = page.url();
            if (currentUrl !== initialUrl) {
              this.logger.info("URL change detected", {
                sessionId: actualSessionId,
                actionNumber,
                oldUrl: initialUrl,
                newUrl: currentUrl,
              });
              initialUrl = currentUrl;
            }
          }

          this.logger.info("All actions completed successfully", {
            sessionId: actualSessionId,
            finalUrl: page.url(),
            totalActions: request.actions.length,
          });

          // Wait for network idle if requested
          if (request.options?.waitForNetworkIdle) {
            this.logger.info("Waiting for network idle", {
              sessionId: actualSessionId,
            });
            await page.waitForLoadState("networkidle", { timeout: 10000 });
            this.logger.info("Network idle wait completed", {
              sessionId: actualSessionId,
            });
          }

          const result: WebAutomationResult = {
            success: true,
            url: page.url(),
            metadata: {
              title: await page.title(),
              timestamp: Date.now(),
            },
          };

          // Get page content if requested
          if (request.options?.includeContent !== false) {
            this.logger.info("Extracting page content", {
              sessionId: actualSessionId,
            });

            // Check if enhanced extraction is requested
            if (request.options?.useEnhancedExtraction) {
              this.logger.info("Using enhanced content extraction", { 
                sessionId: actualSessionId 
              });

              const enhancedContent = await this.extractEnhancedPageContent(page, {
                includeHTML: request.options.enhancedExtractionOptions?.includeHTML ?? true,
                htmlCleaningOptions: request.options.enhancedExtractionOptions?.htmlCleaningOptions,
                includeInteractiveElements: request.options.enhancedExtractionOptions?.includeInteractiveElements ?? true,
                maxContentSize: request.options.enhancedExtractionOptions?.maxContentSize ?? 50000,
              });

              result.pageContent = JSON.stringify(enhancedContent, null, 2);

              this.logger.info("Enhanced page content extracted", {
                sessionId: actualSessionId,
                titleLength: enhancedContent.title.length,
                textLength: enhancedContent.text.length,
                htmlIncluded: !!enhancedContent.html,
                htmlSize: enhancedContent.html?.length || 0,
                formsCount: enhancedContent.interactiveElements?.forms.length || 0,
                buttonsCount: enhancedContent.interactiveElements?.buttons.length || 0,
                linksCount: enhancedContent.interactiveElements?.links.length || 0,
                compressionRatio: enhancedContent.metadata.compressionRatio 
                  ? Math.round(enhancedContent.metadata.compressionRatio * 100) 
                  : 0,
              });
            } else {
              // Use original basic content extraction
              const title = await page.title();
              const textContent = await page.textContent("body");
              const cleanText = textContent?.replace(/\s+/g, " ").trim() || "";

              // Get interactive elements
              const buttons = await page.$$eval(
                'button, input[type="button"], input[type="submit"]',
                (elements) =>
                  elements
                    .map((el) => el.textContent?.trim() || (el as any).value)
                    .filter(Boolean)
              );

              const links = await page.$$eval("a[href]", (elements) =>
                elements
                  .map((el) => ({
                    text: el.textContent?.trim(),
                    href: (el as any).href,
                  }))
                  .filter((l) => l.text && l.text.length > 0)
              );

              const content = {
                title,
                text: cleanText, // No character limit
                buttons: buttons.slice(0, 20), // Increase button limit
                links: links.slice(0, 50), // Increase link limit
              };

              result.pageContent = JSON.stringify(content, null, 2);

              this.logger.info("Basic page content extracted", {
                sessionId: actualSessionId,
                titleLength: title.length,
                textLength: cleanText.length,
                buttonCount: buttons.length,
                linkCount: links.length,
              });
            }
          }

          const totalTime = Date.now() - startTime;
          this.logger.info(
            "Persistent web automation session completed successfully",
            {
              sessionId: actualSessionId,
              totalTimeMs: totalTime,
              finalUrl: result.url,
              success: true,
              persistentPagesCount: this.persistentPages.size,
            }
          );

          return result;
        } catch (error: any) {
          const totalTime = Date.now() - startTime;
          this.logger.error("Persistent web automation session failed", {
            sessionId: actualSessionId,
            error: error.message,
            stack: error.stack,
            totalTimeMs: totalTime,
            persistentPagesCount: this.persistentPages.size,
          });

          console.error(
            `❌ [${actualSessionId}] Persistent web automation error:`,
            error
          );

          return {
            success: false,
            error: error.message || "Unknown persistent web automation error",
            url: (await this.getCurrentPage())?.url(),
            metadata: {
              timestamp: Date.now(),
            },
          };
        }
        // Note: No finally block - page stays open for persistent sessions
      }
    );
  }

  /**
   * Enhanced content extraction with HTML cleaning and structure preservation
   * This method extracts more detailed HTML structure while filtering out unnecessary content
   */
  async extractEnhancedPageContent(
    page: Page,
    options: {
      includeHTML?: boolean;
      htmlCleaningOptions?: HTMLCleaningOptions;
      includeInteractiveElements?: boolean;
      maxContentSize?: number;
    } = {}
  ): Promise<{
    title: string;
    text: string;
    html?: string;
    interactiveElements?: {
      forms: Array<{
        id?: string;
        action?: string;
        method?: string;
        inputs: Array<{
          type: string;
          name?: string;
          id?: string;
          placeholder?: string;
          required?: boolean;
        }>;
      }>;
      buttons: Array<{
        text: string;
        id?: string;
        type?: string;
        formAction?: string;
      }>;
      links: Array<{
        text: string;
        href: string;
        id?: string;
      }>;
    };
    metadata: {
      originalHTMLSize?: number;
      cleanedHTMLSize?: number;
      compressionRatio?: number;
      importantScriptsFound?: number;
    };
  }> {
    const {
      includeHTML = true,
      htmlCleaningOptions = {},
      includeInteractiveElements = true,
      maxContentSize = 50000, // 50KB limit
    } = options;

    this.logger.info("Starting enhanced content extraction", {
      includeHTML,
      includeInteractiveElements,
      maxContentSize,
    });

    const startTime = Date.now();

    // Get basic page info
    const title = await page.title();
    const textContent = await page.textContent("body");
    const cleanText = textContent?.replace(/\s+/g, " ").trim() || "";

    const result: any = {
      title,
      text: cleanText,
      metadata: {},
    };

    // Extract and clean HTML if requested
    if (includeHTML) {
      try {
        this.logger.debug("Extracting full HTML content");
        const fullHTML = await page.content();
        
        if (fullHTML) {
          const cleaningResult = htmlCleaningService.cleanHTML(fullHTML, {
            includeImportantJS: true,
            preserveCSS: false,
            includeDataAttributes: true,
            includeAriaAttributes: true,
            maxScriptSize: 1500,
            includeEventHandlers: false,
            ...htmlCleaningOptions,
          });

          // Check if cleaned HTML is within size limit
          if (cleaningResult.html.length <= maxContentSize) {
            result.html = cleaningResult.html;
          } else {
            // If still too large, try more aggressive cleaning
            const aggressiveResult = htmlCleaningService.cleanHTML(fullHTML, {
              includeImportantJS: false,
              preserveCSS: false,
              includeDataAttributes: false,
              includeAriaAttributes: false,
              includeEventHandlers: false,
              ...htmlCleaningOptions,
            });

            result.html = aggressiveResult.html.length <= maxContentSize 
              ? aggressiveResult.html 
              : aggressiveResult.html.substring(0, maxContentSize) + "...[TRUNCATED]";
            
            this.logger.warn("HTML was too large, used aggressive cleaning", {
              originalSize: cleaningResult.html.length,
              aggressiveSize: aggressiveResult.html.length,
              maxSize: maxContentSize,
            });
          }

          result.metadata = {
            originalHTMLSize: cleaningResult.metadata.originalSize,
            cleanedHTMLSize: cleaningResult.metadata.cleanedSize,
            compressionRatio: cleaningResult.metadata.compressionRatio,
            importantScriptsFound: cleaningResult.metadata.importantScriptsFound,
          };

          this.logger.info("HTML cleaning completed", {
            originalSize: cleaningResult.metadata.originalSize,
            cleanedSize: cleaningResult.metadata.cleanedSize,
            compressionRatio: Math.round(cleaningResult.metadata.compressionRatio * 100),
            importantScripts: cleaningResult.metadata.importantScriptsFound,
          });
        }
      } catch (error) {
        this.logger.error("Error during HTML extraction/cleaning", { error });
        // Fallback to basic text content
        result.html = undefined;
      }
    }

    // Extract interactive elements if requested
    if (includeInteractiveElements) {
      try {
        this.logger.debug("Extracting interactive elements");

        // Extract forms with detailed information
        const forms = await page.$$eval("form", (forms) =>
          forms.map((form) => ({
            id: form.id || undefined,
            action: form.action || undefined,
            method: form.method || undefined,
            inputs: Array.from(form.querySelectorAll("input, select, textarea")).map((input: any) => ({
              type: input.type || input.tagName.toLowerCase(),
              name: input.name || undefined,
              id: input.id || undefined,
              placeholder: input.placeholder || undefined,
              required: input.required || false,
            })),
          }))
        );

        // Extract buttons with more details
        const buttons = await page.$$eval(
          'button, input[type="button"], input[type="submit"]',
          (buttons) =>
            buttons.map((btn: any) => ({
              text: btn.textContent?.trim() || btn.value || "",
              id: btn.id || undefined,
              type: btn.type || undefined,
              formAction: btn.formAction || undefined,
            }))
        );

        // Extract links with IDs
        const links = await page.$$eval("a[href]", (links) =>
          links
            .map((link: any) => ({
              text: link.textContent?.trim() || "",
              href: link.href,
              id: link.id || undefined,
            }))
            .filter((link) => link.text && link.text.length > 0)
        );

        result.interactiveElements = {
          forms: forms.slice(0, 10), // Limit to prevent bloat
          buttons: buttons.slice(0, 20),
          links: links.slice(0, 30),
        };

        this.logger.info("Interactive elements extracted", {
          formsCount: forms.length,
          buttonsCount: buttons.length,
          linksCount: links.length,
        });
      } catch (error) {
        this.logger.error("Error during interactive elements extraction", { error });
        result.interactiveElements = undefined;
      }
    }

    const extractionTime = Date.now() - startTime;
    this.logger.info("Enhanced content extraction completed", {
      extractionTimeMs: extractionTime,
      titleLength: title.length,
      textLength: cleanText.length,
      htmlIncluded: !!result.html,
      htmlSize: result.html?.length || 0,
    });

    return result;
  }

  async cleanup(): Promise<void> {
    this.logger.info("Starting PlaywrightService cleanup", {
      persistentPagesCount: this.persistentPages.size,
    });

    try {
      // Close all persistent pages first
      if (this.persistentPages.size > 0) {
        this.logger.info("Closing all persistent pages", {
          pageCount: this.persistentPages.size,
        });

        for (const [sessionId, page] of this.persistentPages.entries()) {
          try {
            if (!page.isClosed()) {
              await page.close();
              this.logger.info("Closed persistent page", { sessionId });
            }
          } catch (error) {
            this.logger.error("Error closing persistent page", {
              sessionId,
              error,
            });
          }
        }

        this.persistentPages.clear();
        this.currentSessionId = null;
        this.sessionStartTime = 0;

        this.logger.info("All persistent pages closed");
      }

      if (this.context) {
        this.logger.info("Closing browser context");
        await this.context.close();
        this.context = null;
        this.logger.info("Browser context closed successfully");
      }
      if (this.browser) {
        this.logger.info("Closing browser");
        await this.browser.close();
        this.browser = null;
        this.logger.info("Browser closed successfully");
      }

      this.logger.info("PlaywrightService cleanup completed successfully");
    } catch (error) {
      this.logger.error("Error during Playwright cleanup", { error });
      console.warn("Error during Playwright cleanup:", error);
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    this.logger.info("Starting PlaywrightService shutdown");
    await this.cleanup();
    this.logger.info("PlaywrightService shutdown completed");
  }
}

// Singleton instance
export const playwrightService = new PlaywrightService();
