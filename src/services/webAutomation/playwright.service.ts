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
import { contentFlowLogger } from "../logging/contentFlow.logging";

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
          "Accept-Language": "en-US,en;q=0.9", // Set language
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
              state: "visible",
            });

            this.logger.info(`Clicking element: ${action.selector}`, {
              actionId,
            });
            await page.click(action.selector, {
              timeout: 5000,
              ...action.options,
            });
            this.logger.info(`Click completed on: ${action.selector}`, {
              actionId,
            });
          } catch (clickError: any) {
            this.logger.warn(`Click failed, trying alternative approach`, {
              actionId,
              error: clickError?.message || "Unknown error",
            });

            // Alternative: Try to click using locator
            try {
              const locator = page.locator(action.selector);
              await locator.click({ timeout: 5000 });
              this.logger.info(
                `Click completed with locator: ${action.selector}`,
                {
                  actionId,
                }
              );
            } catch (locatorError: any) {
              throw new Error(
                `Could not click element ${action.selector}: ${
                  clickError?.message || "Unknown error"
                }`
              );
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

          // Enhanced input finding with multiple selector strategies
          let success = false;
          const selectorsToTry = [
            action.selector, // Primary selector from LLM
            // Common input selectors
            'input[type="text"]',
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
            'input[placeholder*="text"]',
            'input[placeholder*="hidden"]',
            'input[placeholder*="enter"]',
            "textarea",
            '[contenteditable="true"]',
          ];

          for (const selector of selectorsToTry) {
            try {
              this.logger.info(`Trying selector: ${selector}`, { actionId });

              // Check if elements exist first
              const elements = await page.$$(selector);
              if (elements.length === 0) {
                this.logger.debug(
                  `No elements found for selector: ${selector}`,
                  { actionId }
                );
                continue;
              }

              this.logger.info(
                `Found ${elements.length} elements for selector: ${selector}`,
                { actionId }
              );

              // Try to fill the first matching element
              await page.fill(selector, "", { timeout: 5000 }); // Clear first
              await page.fill(selector, action.text, { timeout: 5000 });

              success = true;
              this.logger.info(
                `Text input completed with selector: ${selector}`,
                {
                  actionId,
                }
              );
              break;
            } catch (selectorError: any) {
              this.logger.debug(`Selector failed: ${selector}`, {
                actionId,
                error: selectorError?.message || "Unknown error",
              });
              continue;
            }
          }

          if (!success) {
            // Enhanced debugging - log all available inputs
            try {
              const availableInputs = await page.$$eval(
                "input, textarea, [contenteditable]",
                (elements) =>
                  elements.map((el) => ({
                    tagName: el.tagName.toLowerCase(),
                    type: (el as any).type || "text",
                    id: (el as any).id || null,
                    name: (el as any).name || null,
                    className: (el as any).className || null,
                    placeholder: (el as any).placeholder || null,
                    value: (el as any).value || null,
                    visible: (el as any).offsetParent !== null,
                  }))
              );

              this.logger.error(
                `No input element could be filled. Available inputs:`,
                {
                  actionId,
                  availableInputs,
                  triedSelectors: selectorsToTry,
                }
              );
            } catch (debugError) {
              this.logger.debug(
                "Could not get available inputs for debugging",
                { actionId }
              );
            }

            throw new Error(
              `Could not find any input element for selector: ${action.selector}`
            );
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
            await page.evaluate(() => {
              (globalThis as any).window.scrollTo(
                0,
                (globalThis as any).document.body.scrollHeight
              );
            });
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

          // Enhanced intelligent input finding with better selector strategies
          let found = false;
          const intelligentSelectors = [
            action.selector, // Original selector
            // Try exact attribute matches
            `[placeholder="${action.selector}"]`,
            `[placeholder*="${action.selector}"]`,
            `input[placeholder="${action.selector}"]`,
            `input[placeholder*="${action.selector}"]`,
            // Try ID and name matches
            `#${action.selector}`,
            `[name="${action.selector}"]`,
            `input[name="${action.selector}"]`,
            // Try partial matches
            `input[name*="${action.selector}"]`,
            `input[id*="${action.selector}"]`,
            `textarea[name*="${action.selector}"]`,
            `textarea[id*="${action.selector}"]`,
            // Try generic input selectors
            'input[type="text"]',
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
            "textarea",
          ];

          for (const selector of intelligentSelectors) {
            try {
              this.logger.debug(`Trying intelligent selector: ${selector}`, {
                actionId,
              });

              // Check if elements exist
              const elements = await page.$$(selector);
              if (elements.length === 0) {
                continue;
              }

              this.logger.info(
                `Found ${elements.length} elements with selector: ${selector}`,
                { actionId }
              );

              // Try to fill the element
              await page.fill(selector, action.text, { timeout: 5000 });
              found = true;

              this.logger.info(
                `Intelligent fill completed with selector: ${selector}`,
                { actionId }
              );
              break;
            } catch (error: any) {
              this.logger.debug(`Intelligent selector failed: ${selector}`, {
                actionId,
                error: error?.message || "Unknown error",
              });
              continue;
            }
          }

          if (!found) {
            // Enhanced debugging for find_and_fill
            try {
              const availableInputs = await page.$$eval(
                "input, textarea, [contenteditable]",
                (elements) =>
                  elements.map((el) => ({
                    tagName: el.tagName.toLowerCase(),
                    type: (el as any).type || "text",
                    id: (el as any).id || null,
                    name: (el as any).name || null,
                    placeholder: (el as any).placeholder || null,
                    className: (el as any).className || null,
                  }))
              );

              this.logger.error(
                `Intelligent input finding failed. Available inputs:`,
                {
                  actionId,
                  originalSelector: action.selector,
                  triedSelectors: intelligentSelectors,
                  availableInputs,
                }
              );
            } catch (debugError) {
              this.logger.debug(
                "Could not get available inputs for debugging",
                { actionId }
              );
            }

            throw new Error(
              `Could not find input element matching: ${action.selector}`
            );
          }
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
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      const url = route.request().url();

      // Block unnecessary resources for faster loading, but allow essential ones
      if (["image", "font"].includes(resourceType)) {
        route.abort();
      } else if (resourceType === "stylesheet") {
        // Allow critical CSS but block non-essential styling
        if (
          url.includes("bootstrap") ||
          url.includes("cdn") ||
          url.includes("googleapis")
        ) {
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

            // Get basic page content with JavaScript and unwanted content filtered out
            const title = await page.title();

            // Remove only script and style content from text extraction (keep structure intact)
            const cleanText = await page.evaluate(() => {
              // Clone the body to avoid modifying the original DOM
              const bodyClone = (globalThis as any).document.body.cloneNode(
                true
              ) as any;

              // Only remove script and style tags that contain code (not interactive elements)
              const codeSelectors = [
                "script", // Remove script tags only
                "style", // Remove style tags only
                "noscript", // Remove noscript tags
              ];

              codeSelectors.forEach((selector: string) => {
                const elements = bodyClone.querySelectorAll(selector);
                elements.forEach((el: any) => el.remove());
              });

              // Get clean text content
              let text = bodyClone.textContent || bodyClone.innerText || "";

              // Remove only non-functional JavaScript patterns, preserve API calls and functional code
              text = text
                // Remove analytics and tracking code
                .replace(/gtag\([^)]*\)/g, "") // Remove Google Analytics
                .replace(/ga\([^)]*\)/g, "") // Remove Google Analytics
                .replace(/fbq\([^)]*\)/g, "") // Remove Facebook Pixel
                .replace(/\_gaq\.push\([^)]*\)/g, "") // Remove Google Analytics queue
                // Remove console statements (but keep functional code)
                .replace(/console\.(log|error|warn|info)\([^)]*\)/g, "")
                // Remove comments but preserve code structure
                .replace(/\/\*[\s\S]*?\*\//g, "") // Remove block comments
                .replace(/\/\/(?!.*https?:\/\/).*$/gm, "") // Remove line comments but preserve URLs
                // Clean up excessive whitespace but preserve code structure
                .replace(/\s{3,}/g, " ") // Replace 3+ spaces with single space
                .trim();

              // Extract and preserve important API calls and functional code
              const apiCallMatches = text.match(
                /fetch\s*\(\s*["`'][^"`']*["`'][^}]*\}/g
              );
              const functionMatches = text.match(
                /async\s+function[^}]*\}[^}]*\}/g
              );

              let preservedCode = "";
              if (apiCallMatches) {
                preservedCode +=
                  "\n\nIMPORTANT API CALLS:\n" + apiCallMatches.join("\n");
              }
              if (functionMatches) {
                preservedCode +=
                  "\n\nFUNCTIONAL CODE:\n" + functionMatches.join("\n");
              }

              text = text + preservedCode;

              return text;
            });

            // Get interactive elements (keep all visible elements for automation)
            const buttons = await page.$$eval(
              'button, input[type="button"], input[type="submit"]',
              (elements) =>
                elements
                  .map((el) => el.textContent?.trim() || (el as any).value)
                  .filter(Boolean)
                  .filter((text) => text.length > 0 && text.length < 200) // Allow longer text for buttons
            );

            const links = await page.$$eval(
              "a[href]",
              (elements) =>
                elements
                  .map((el) => ({
                    text: el.textContent?.trim(),
                    href: (el as any).href,
                  }))
                  .filter((l) => l.text && l.text.length > 0)
                  .filter((l) => !l.href.startsWith("javascript:")) // Only filter out javascript links
            );

            // Get input fields for automation (crucial for typing actions)
            const inputs = await page.$$eval(
              'input:not([type="button"]):not([type="submit"]), textarea, select',
              (elements) =>
                elements.map((el, index) => {
                  const element = el as any;

                  // Build possible selectors for this input
                  const selectors = [];

                  if (element.id) {
                    selectors.push(`#${element.id}`);
                  }
                  if (element.name) {
                    selectors.push(`[name="${element.name}"]`);
                  }
                  if (element.placeholder) {
                    selectors.push(`[placeholder="${element.placeholder}"]`);
                  }
                  if (element.type && element.type !== "text") {
                    selectors.push(`input[type="${element.type}"]`);
                  }

                  // Fallback selectors
                  selectors.push(
                    `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`
                  );
                  selectors.push(
                    `${element.tagName.toLowerCase()}:nth-child(${index + 1})`
                  );

                  return {
                    type: element.type || "text",
                    name: element.name || null,
                    id: element.id || null,
                    placeholder: element.placeholder || null,
                    value: element.value || null,
                    tagName: element.tagName.toLowerCase(),
                    selectors: selectors, // Provide multiple selector options
                    index: index, // Add index for fallback
                  };
                })
            );

            // Get elements with data attributes (often used for hidden content or special interactions)
            const dataElements = await page.$$eval(
              '[data-secret], [data-hidden], [data-value], [data-answer], [data-key], [style*="display: none"], [style*="visibility: hidden"]',
              (elements) =>
                elements
                  .map((el, index) => {
                    const element = el as any;
                    const dataAttrs: Record<string, string> = {};

                    // Collect all data-* attributes
                    for (const attr of element.attributes) {
                      if (attr.name.startsWith("data-")) {
                        dataAttrs[attr.name] = attr.value;
                      }
                    }

                    return {
                      tagName: element.tagName.toLowerCase(),
                      id: element.id || null,
                      className: element.className || null,
                      textContent: (element.textContent || "").trim(),
                      dataAttributes: dataAttrs,
                      style: element.style.cssText || null,
                      isHidden:
                        element.style.display === "none" ||
                        element.style.visibility === "hidden",
                    };
                  })
                  .filter(
                    (el) =>
                      Object.keys(el.dataAttributes).length > 0 ||
                      el.isHidden ||
                      el.textContent
                  )
            );

            // Extract API calls and functional code from scripts (important for challenges)
            const apiCalls = await page.evaluate(() => {
              const scripts = Array.from(
                (globalThis as any).document.querySelectorAll("script")
              );
              const apiInfo: any[] = [];

              scripts.forEach((script: any, index: number) => {
                const content = script.textContent || script.innerHTML || "";

                // Look for fetch calls with URLs
                const fetchMatches = content.match(
                  /fetch\s*\(\s*["`']([^"`']+)["`'][^}]*\}/g
                );
                if (fetchMatches) {
                  fetchMatches.forEach((match: string) => {
                    const urlMatch = match.match(/["`']([^"`']+)["`']/);
                    if (urlMatch) {
                      apiInfo.push({
                        type: "fetch",
                        url: urlMatch[1],
                        code:
                          match.substring(0, 200) +
                          (match.length > 200 ? "..." : ""),
                        scriptIndex: index,
                      });
                    }
                  });
                }

                // Look for important variables or functions that might contain answers
                const flightNumberMatches =
                  content.match(/flightNumber[^;]*;/g);
                if (flightNumberMatches) {
                  flightNumberMatches.forEach((match: string) => {
                    apiInfo.push({
                      type: "flightNumber",
                      code: match,
                      scriptIndex: index,
                    });
                  });
                }

                // Look for challenge completion code patterns
                const challengeMatches = content.match(/challenge[^;]*;/gi);
                if (challengeMatches) {
                  challengeMatches.forEach((match: string) => {
                    apiInfo.push({
                      type: "challenge",
                      code: match,
                      scriptIndex: index,
                    });
                  });
                }
              });

              return apiInfo;
            });

            const content = {
              title,
              text:
                cleanText.length > 50000
                  ? cleanText.substring(0, 50000) + "...[truncated]"
                  : cleanText, // Limit text to 50k characters
              buttons: buttons.slice(0, 20), // Limit buttons
              links: links.slice(0, 50), // Limit links
              inputs: inputs.slice(0, 20), // Include input fields for automation
              hiddenElements: dataElements.slice(0, 10), // Include hidden/data elements for challenges
              apiCalls: apiCalls.slice(0, 5), // Include API calls and functional code for challenges
            };

            result.pageContent = JSON.stringify(content, null, 2);

            // Log the extracted page content for analysis
            contentFlowLogger.logPlaywrightExtraction(
              sessionId,
              page.url(),
              result.pageContent,
              {
                actionCount: request.actions.length,
                titleLength: title.length,
                textLength: cleanText.length,
                buttonCount: buttons.length,
                linkCount: links.length,
                inputCount: inputs.length,
                hiddenElementCount: dataElements.length,
                apiCallCount: apiCalls.length,
                extractionTimeMs: Date.now() - startTime,
              }
            );

            this.logger.info("Page content extracted and logged", {
              sessionId,
              titleLength: title.length,
              textLength: cleanText.length,
              buttonCount: buttons.length,
              linkCount: links.length,
              inputCount: inputs.length,
              hiddenElementCount: dataElements.length,
              apiCallCount: apiCalls.length,
            });
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

            // Get basic page content with JavaScript and unwanted content filtered out
            const title = await page.title();

            // Remove only script and style content from text extraction (keep structure intact)
            const cleanText = await page.evaluate(() => {
              // Clone the body to avoid modifying the original DOM
              const bodyClone = (globalThis as any).document.body.cloneNode(
                true
              ) as any;

              // Only remove script and style tags that contain code (not interactive elements)
              const codeSelectors = [
                "script", // Remove script tags only
                "style", // Remove style tags only
                "noscript", // Remove noscript tags
              ];

              codeSelectors.forEach((selector: string) => {
                const elements = bodyClone.querySelectorAll(selector);
                elements.forEach((el: any) => el.remove());
              });

              // Get clean text content
              let text = bodyClone.textContent || bodyClone.innerText || "";

              // Remove only non-functional JavaScript patterns, preserve API calls and functional code
              text = text
                // Remove analytics and tracking code
                .replace(/gtag\([^)]*\)/g, "") // Remove Google Analytics
                .replace(/ga\([^)]*\)/g, "") // Remove Google Analytics
                .replace(/fbq\([^)]*\)/g, "") // Remove Facebook Pixel
                .replace(/\_gaq\.push\([^)]*\)/g, "") // Remove Google Analytics queue
                // Remove console statements (but keep functional code)
                .replace(/console\.(log|error|warn|info)\([^)]*\)/g, "")
                // Remove comments but preserve code structure
                .replace(/\/\*[\s\S]*?\*\//g, "") // Remove block comments
                .replace(/\/\/(?!.*https?:\/\/).*$/gm, "") // Remove line comments but preserve URLs
                // Clean up excessive whitespace but preserve code structure
                .replace(/\s{3,}/g, " ") // Replace 3+ spaces with single space
                .trim();

              // Extract and preserve important API calls and functional code
              const apiCallMatches = text.match(
                /fetch\s*\(\s*["`'][^"`']*["`'][^}]*\}/g
              );
              const functionMatches = text.match(
                /async\s+function[^}]*\}[^}]*\}/g
              );

              let preservedCode = "";
              if (apiCallMatches) {
                preservedCode +=
                  "\n\nIMPORTANT API CALLS:\n" + apiCallMatches.join("\n");
              }
              if (functionMatches) {
                preservedCode +=
                  "\n\nFUNCTIONAL CODE:\n" + functionMatches.join("\n");
              }

              text = text + preservedCode;

              return text;
            });

            // Get interactive elements (keep all visible elements for automation)
            const buttons = await page.$$eval(
              'button, input[type="button"], input[type="submit"]',
              (elements) =>
                elements
                  .map((el) => el.textContent?.trim() || (el as any).value)
                  .filter(Boolean)
                  .filter((text) => text.length > 0 && text.length < 200) // Allow longer text for buttons
            );

            const links = await page.$$eval(
              "a[href]",
              (elements) =>
                elements
                  .map((el) => ({
                    text: el.textContent?.trim(),
                    href: (el as any).href,
                  }))
                  .filter((l) => l.text && l.text.length > 0)
                  .filter((l) => !l.href.startsWith("javascript:")) // Only filter out javascript links
            );

            // Get input fields for automation (crucial for typing actions)
            const inputs = await page.$$eval(
              'input:not([type="button"]):not([type="submit"]), textarea, select',
              (elements) =>
                elements.map((el, index) => {
                  const element = el as any;

                  // Build possible selectors for this input
                  const selectors = [];

                  if (element.id) {
                    selectors.push(`#${element.id}`);
                  }
                  if (element.name) {
                    selectors.push(`[name="${element.name}"]`);
                  }
                  if (element.placeholder) {
                    selectors.push(`[placeholder="${element.placeholder}"]`);
                  }
                  if (element.type && element.type !== "text") {
                    selectors.push(`input[type="${element.type}"]`);
                  }

                  // Fallback selectors
                  selectors.push(
                    `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`
                  );
                  selectors.push(
                    `${element.tagName.toLowerCase()}:nth-child(${index + 1})`
                  );

                  return {
                    type: element.type || "text",
                    name: element.name || null,
                    id: element.id || null,
                    placeholder: element.placeholder || null,
                    value: element.value || null,
                    tagName: element.tagName.toLowerCase(),
                    selectors: selectors, // Provide multiple selector options
                    index: index, // Add index for fallback
                  };
                })
            );

            // Get elements with data attributes (often used for hidden content or special interactions)
            const dataElements = await page.$$eval(
              '[data-secret], [data-hidden], [data-value], [data-answer], [data-key], [style*="display: none"], [style*="visibility: hidden"]',
              (elements) =>
                elements
                  .map((el, index) => {
                    const element = el as any;
                    const dataAttrs: Record<string, string> = {};

                    // Collect all data-* attributes
                    for (const attr of element.attributes) {
                      if (attr.name.startsWith("data-")) {
                        dataAttrs[attr.name] = attr.value;
                      }
                    }

                    return {
                      tagName: element.tagName.toLowerCase(),
                      id: element.id || null,
                      className: element.className || null,
                      textContent: (element.textContent || "").trim(),
                      dataAttributes: dataAttrs,
                      style: element.style.cssText || null,
                      isHidden:
                        element.style.display === "none" ||
                        element.style.visibility === "hidden",
                    };
                  })
                  .filter(
                    (el) =>
                      Object.keys(el.dataAttributes).length > 0 ||
                      el.isHidden ||
                      el.textContent
                  )
            );

            // Extract API calls and functional code from scripts (important for challenges)
            const apiCalls = await page.evaluate(() => {
              const scripts = Array.from(
                (globalThis as any).document.querySelectorAll("script")
              );
              const apiInfo: any[] = [];

              scripts.forEach((script: any, index: number) => {
                const content = script.textContent || script.innerHTML || "";

                // Look for fetch calls with URLs
                const fetchMatches = content.match(
                  /fetch\s*\(\s*["`']([^"`']+)["`'][^}]*\}/g
                );
                if (fetchMatches) {
                  fetchMatches.forEach((match: string) => {
                    const urlMatch = match.match(/["`']([^"`']+)["`']/);
                    if (urlMatch) {
                      apiInfo.push({
                        type: "fetch",
                        url: urlMatch[1],
                        code:
                          match.substring(0, 200) +
                          (match.length > 200 ? "..." : ""),
                        scriptIndex: index,
                      });
                    }
                  });
                }

                // Look for important variables or functions that might contain answers
                const flightNumberMatches =
                  content.match(/flightNumber[^;]*;/g);
                if (flightNumberMatches) {
                  flightNumberMatches.forEach((match: string) => {
                    apiInfo.push({
                      type: "flightNumber",
                      code: match,
                      scriptIndex: index,
                    });
                  });
                }

                // Look for challenge completion code patterns
                const challengeMatches = content.match(/challenge[^;]*;/gi);
                if (challengeMatches) {
                  challengeMatches.forEach((match: string) => {
                    apiInfo.push({
                      type: "challenge",
                      code: match,
                      scriptIndex: index,
                    });
                  });
                }
              });

              return apiInfo;
            });

            const content = {
              title,
              text:
                cleanText.length > 50000
                  ? cleanText.substring(0, 50000) + "...[truncated]"
                  : cleanText, // Limit text to 50k characters
              buttons: buttons.slice(0, 20), // Limit buttons
              links: links.slice(0, 50), // Limit links
              inputs: inputs.slice(0, 20), // Include input fields for automation
              hiddenElements: dataElements.slice(0, 10), // Include hidden/data elements for challenges
              apiCalls: apiCalls.slice(0, 5), // Include API calls and functional code for challenges
            };

            result.pageContent = JSON.stringify(content, null, 2);

            // Log the extracted page content for analysis (persistent session)
            contentFlowLogger.logPlaywrightExtraction(
              actualSessionId,
              page.url(),
              result.pageContent,
              {
                actionCount: request.actions.length,
                titleLength: title.length,
                textLength: cleanText.length,
                buttonCount: buttons.length,
                linkCount: links.length,
                extractionTimeMs: Date.now() - startTime,
                isPersistentSession: true,
              }
            );

            this.logger.info("Page content extracted and logged", {
              sessionId: actualSessionId,
              titleLength: title.length,
              textLength: cleanText.length,
              buttonCount: buttons.length,
              linkCount: links.length,
            });
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
