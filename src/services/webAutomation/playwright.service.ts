import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import type {
  WebAutomationAction,
  WebAutomationResult,
  WebAutomationRequest,
  PlaywrightServiceConfig,
} from "./types";
import { sentryMonitoringService } from "../monitoring";

export class PlaywrightService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private config: PlaywrightServiceConfig;

  constructor(config?: Partial<PlaywrightServiceConfig>) {
    this.config = {
      defaultTimeout: 30000,
      defaultViewport: { width: 1280, height: 720 },
      headless: true,
      maxConcurrentPages: 3,
      ...config,
    };
  }

  private async initializeBrowser(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    }

    if (!this.context) {
      this.context = await this.browser.newContext({
        viewport: this.config.defaultViewport,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
    }
  }

  private async executeAction(
    page: Page,
    action: WebAutomationAction
  ): Promise<void> {
    const timeout = action.timeout || this.config.defaultTimeout;

    switch (action.type) {
      case "navigate":
        if (!action.url) throw new Error("URL required for navigate action");
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout });
        break;

      case "click":
        if (!action.selector)
          throw new Error("Selector required for click action");
        await page.waitForSelector(action.selector, { timeout });
        await page.click(action.selector, action.options);
        break;

      case "type":
        if (!action.selector || !action.text)
          throw new Error("Selector and text required for type action");
        await page.waitForSelector(action.selector, { timeout });
        await page.fill(action.selector, action.text);
        break;

      case "wait":
        if (action.selector) {
          await page.waitForSelector(action.selector, { timeout });
        } else {
          await page.waitForTimeout(action.timeout || 1000);
        }
        break;

      case "scroll":
        if (action.selector) {
          await page.locator(action.selector).scrollIntoViewIfNeeded();
        } else {
          await page.evaluate(() => {
            // @ts-ignore - This runs in browser context where window and document are available
            window.scrollTo(0, document.body.scrollHeight);
          });
        }
        break;

      case "hover":
        if (!action.selector)
          throw new Error("Selector required for hover action");
        await page.waitForSelector(action.selector, { timeout });
        await page.hover(action.selector);
        break;

      case "select":
        if (!action.selector || !action.text)
          throw new Error("Selector and text required for select action");
        await page.waitForSelector(action.selector, { timeout });
        await page.selectOption(action.selector, action.text);
        break;

      case "fill_form":
        if (!action.formData)
          throw new Error("Form data required for fill_form action");

        // Fill multiple form fields
        for (const [selector, value] of Object.entries(action.formData)) {
          await page.waitForSelector(selector, { timeout });
          await page.fill(selector, value);
        }
        break;

      case "submit_form":
        const submitSelector =
          action.submitSelector ||
          'input[type="submit"], button[type="submit"], button:has-text("Submit")';
        await page.waitForSelector(submitSelector, { timeout });
        await page.click(submitSelector);
        break;

      case "find_and_fill":
        if (!action.selector || !action.text)
          throw new Error(
            "Selector and text required for find_and_fill action"
          );

        // More intelligent input finding
        try {
          await page.waitForSelector(action.selector, { timeout });
        } catch {
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
              await page.waitForSelector(fallbackSelector, { timeout: 2000 });
              action.selector = fallbackSelector;
              found = true;
              break;
            } catch {
              continue;
            }
          }

          if (!found) {
            throw new Error(
              `Could not find input element matching: ${action.selector}`
            );
          }
        }

        await page.fill(action.selector, action.text);
        break;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  async executeWebAutomation(
    request: WebAutomationRequest
  ): Promise<WebAutomationResult> {
    return await sentryMonitoringService.track(
      "web_automation_execution",
      "pdf_processing",
      { url: request.url, actionCount: request.actions.length },
      async () => {
        let page: Page | null = null;

        try {
          await this.initializeBrowser();
          if (!this.context) throw new Error("Browser context not initialized");

          page = await this.context.newPage();

          // Set default timeout
          page.setDefaultTimeout(
            request.options?.timeout || this.config.defaultTimeout
          );

          // Navigate to initial URL if not already included in actions
          const hasNavigateAction = request.actions.some(
            (action) => action.type === "navigate"
          );
          if (!hasNavigateAction) {
            await page.goto(request.url, { waitUntil: "domcontentloaded" });
          }

          // Execute all actions in sequence
          let initialUrl = page.url();
          for (const action of request.actions) {
            console.log(
              `🎭 Executing action: ${action.type}${
                action.selector ? ` on ${action.selector}` : ""
              }`
            );
            await this.executeAction(page, action);

            // Check if URL changed after this action
            const currentUrl = page.url();
            if (currentUrl !== initialUrl) {
              console.log(`🔄 URL changed from ${initialUrl} to ${currentUrl}`);
              // Wait for the new page to load completely
              await page.waitForLoadState("domcontentloaded");
              initialUrl = currentUrl;
            }

            // Small delay between actions to ensure stability
            await page.waitForTimeout(500);
          }

          // Wait for network idle if requested
          if (request.options?.waitForNetworkIdle) {
            await page.waitForLoadState("networkidle", { timeout: 10000 });
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
            // Get basic page content
            const title = await page.title();
            const textContent = await page.textContent("body");
            const cleanText = textContent?.replace(/\s+/g, " ").trim() || "";

            // Get interactive elements
            const buttons = await page.$$eval(
              'button, input[type="button"], input[type="submit"]',
              (elements: Element[]) =>
                elements
                  .map(
                    (el: any) =>
                      el.textContent?.trim() || el.value
                  )
                  .filter(Boolean)
            );

            const links = await page.$$eval("a[href]", (elements: Element[]) =>
              elements
                .map((el: any) => ({
                  text: el.textContent?.trim(),
                  href: el.href,
                }))
                .filter((l: any) => l.text && l.text.length > 0)
            );

            const content = {
              title,
              text:
                cleanText.length > 1000
                  ? cleanText.substring(0, 1000) + "..."
                  : cleanText,
              buttons: buttons.slice(0, 10),
              links: links.slice(0, 5),
            };

            result.pageContent = JSON.stringify(content, null, 2);
          }

          return result;
        } catch (error: any) {
          console.error("❌ Web automation error:", error);

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
              await page.close();
            } catch (closeError) {
              console.warn("Failed to close page:", closeError);
            }
          }
        }
      }
    );
  }

  async cleanup(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch (error) {
      console.warn("Error during Playwright cleanup:", error);
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    await this.cleanup();
  }
}

// Singleton instance
export const playwrightService = new PlaywrightService();
