import type { Page } from "playwright";
import type {
  PlaywrightServiceConfig,
  WebAutomationRequest,
  WebAutomationResult,
} from "./types";
import { BrowserManager } from "./browserManager.playwright";
import { ActionExecutor } from "./actionExecutor.playwright";
import { ContentExtractor } from "./contentExtractor.playwright";
import { SessionManager } from "./sessionManager.playwright";
import { loggingService } from "../logging";
import { sentryMonitoringService } from "../monitoring";

export class PlaywrightService {
  private config: PlaywrightServiceConfig;
  private logger = loggingService.createComponentLogger("PlaywrightService");

  // Component managers
  private browserManager: BrowserManager;
  private actionExecutor: ActionExecutor;
  private contentExtractor: ContentExtractor;
  private sessionManager: SessionManager;

  constructor(config?: Partial<PlaywrightServiceConfig>) {
    this.config = {
      defaultTimeout: 15000, // Reduced from 30000ms to 15000ms for faster responses
      defaultViewport: { width: 1280, height: 720 },
      headless: true,
      maxConcurrentPages: 3,
      ...config,
    };

    // Initialize component managers
    this.browserManager = new BrowserManager(this.config);
    this.actionExecutor = new ActionExecutor();
    this.contentExtractor = new ContentExtractor();
    this.sessionManager = new SessionManager(this.config);

    this.logger.info("PlaywrightService initialized", {
      config: this.config,
    });
  }

  /**
   * Initialize the Playwright service during server startup
   * This preloads the browser and context for faster subsequent operations
   */
  public async initializeOnStartup(): Promise<void> {
    this.logger.info(
      "Starting Playwright service initialization on server startup"
    );

    try {
      const startTime = Date.now();
      // await this.browserManager.initializeBrowser();
      const initTime = Date.now() - startTime;

      this.logger.info(
        "Playwright service successfully initialized on startup",
        {
          initializationTimeMs: initTime,
          browserReady: !!this.browserManager.getBrowser(),
          contextReady: !!this.browserManager.getContext(),
        }
      );

      console.log(
        `✅ Playwright browser initialized and ready (${initTime}ms)`
      );
    } catch (error: any) {
      this.logger.error("Failed to initialize Playwright service on startup", {
        error: error.message,
        stack: error.stack,
      });

      console.error(
        "❌ Failed to initialize Playwright browser:",
        error.message
      );

      // Don't throw the error to prevent server startup failure
      // The service will still work, it will just initialize lazily when first used
    }
  }

  // Persistent page management methods
  async getOrCreatePersistentPage(sessionId: string): Promise<Page> {
    this.logger.info("Getting or creating persistent page", { sessionId });

    // Ensure browser is initialized
    await this.browserManager.initializeBrowser();
    const context = this.browserManager.getContext();
    if (!context) throw new Error("Browser context not initialized");

    return this.sessionManager.getOrCreatePersistentPage(sessionId, context);
  }

  async closePersistentPage(sessionId: string): Promise<void> {
    return this.sessionManager.closePersistentPage(sessionId);
  }

  async getCurrentPage(): Promise<Page | null> {
    return this.sessionManager.getCurrentPage();
  }

  /**
   * Execute web automation with a temporary page
   */
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
          await this.browserManager.initializeBrowser();
          const context = this.browserManager.getContext();
          if (!context) throw new Error("Browser context not initialized");

          this.logger.info("Creating new page", { sessionId });
          page = await context.newPage();

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
          if (!hasNavigateAction && request.url) {
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
              { sessionId, urlProvided: !!request.url }
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

            console.log("\n🎬 [PlaywrightCore] ACTION EXECUTION:");
            console.log("▶".repeat(80));
            console.log("🏷️ Session ID:", sessionId);
            console.log(
              "🔢 Action Number:",
              `${actionNumber}/${request.actions.length}`
            );
            console.log("🎯 Action Type:", action.type);
            console.log("🔍 Selector:", action.selector || "N/A");
            console.log("📝 Text/Data:", action.text || action.url || "N/A");
            console.log("🌐 Current URL BEFORE:", page.url());
            console.log("📋 Full Action Details:");
            console.log(JSON.stringify(action, null, 2));
            console.log("▶".repeat(80));

            await this.actionExecutor.executeAction(
              page,
              action,
              this.config.defaultTimeout
            );

            console.log("\n✅ [PlaywrightCore] ACTION COMPLETED:");
            console.log("◆".repeat(80));
            console.log("🏷️ Session ID:", sessionId);
            console.log(
              "🔢 Action Number:",
              `${actionNumber}/${request.actions.length}`
            );
            console.log("🎯 Action Type:", action.type);
            console.log("🌐 Current URL AFTER:", page.url());
            console.log("◆".repeat(80));
          }

          this.logger.info("All actions completed successfully", {
            sessionId,
            finalUrl: page.url(),
            totalActions: request.actions.length,
          });

          // Wait for network idle if requested
          if (request.options?.waitForNetworkIdle) {
            this.logger.info("Waiting for network idle", { sessionId });
            await page.waitForLoadState("networkidle", { timeout });
            this.logger.info("Network idle achieved", { sessionId });
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

            if (request.options?.useEnhancedExtraction) {
              const enhancedContent =
                await this.contentExtractor.extractEnhancedPageContent(
                  page,
                  request.options.enhancedExtractionOptions
                );
              result.pageContent = JSON.stringify(enhancedContent);
            } else {
              const basicContent =
                await this.contentExtractor.extractBasicPageContent(page);
              result.pageContent = JSON.stringify(basicContent);
            }

            this.logger.info("Page content extracted", {
              sessionId,
              contentLength: result.pageContent?.length || 0,
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
              await page.close();
              this.logger.info("Page closed successfully", { sessionId });
            } catch (closeError) {
              this.logger.error("Error closing page", {
                sessionId,
                error: closeError,
              });
            }
          }
        }
      }
    );
  }

  /**
   * Execute web automation with a persistent page
   */
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

          // Navigate to initial URL only if:
          // 1. URL is provided, AND
          // 2. There's no navigate action in the sequence, AND
          // 3. This is a new session or the page hasn't been navigated yet
          const hasNavigateAction = request.actions.some(
            (action) => action.type === "navigate"
          );

          const currentUrl = page.url();
          const isBlankPage = currentUrl === "about:blank" || currentUrl === "";

          if (
            request.url && // Only navigate if URL is provided
            !hasNavigateAction &&
            (isBlankPage || currentUrl !== request.url)
          ) {
            this.logger.info(
              "Navigating to initial URL (new session or different URL)",
              {
                sessionId: actualSessionId,
                currentUrl,
                targetUrl: request.url,
                isBlankPage,
              }
            );
            await page.goto(request.url, { waitUntil: "domcontentloaded" });
            this.logger.info("Initial navigation completed", {
              sessionId: actualSessionId,
              finalUrl: page.url(),
            });
          } else {
            this.logger.info("Skipping initial navigation", {
              sessionId: actualSessionId,
              currentUrl,
              targetUrl: request.url || "not provided",
              hasNavigateAction,
              reason: !request.url
                ? "no URL provided (continuing on current page)"
                : hasNavigateAction
                ? "navigate action present"
                : "already on correct page",
            });
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
            if (!action) continue; // Safety check

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

            console.log("\n🎬 [PlaywrightCore] PERSISTENT ACTION EXECUTION:");
            console.log("▶".repeat(80));
            console.log("🏷️ Session ID:", actualSessionId);
            console.log(
              "🔢 Action Number:",
              `${actionNumber}/${request.actions.length}`
            );
            console.log("🎯 Action Type:", action.type);
            console.log("🔍 Selector:", action.selector || "N/A");
            console.log("📝 Text/Data:", action.text || action.url || "N/A");
            console.log("🌐 Current URL BEFORE:", page.url());
            console.log("📋 Full Action Details:");
            console.log(JSON.stringify(action, null, 2));
            console.log("▶".repeat(80));

            await this.actionExecutor.executeAction(
              page,
              action,
              this.config.defaultTimeout
            );

            console.log("\n✅ [PlaywrightCore] PERSISTENT ACTION COMPLETED:");
            console.log("◆".repeat(80));
            console.log("🏷️ Session ID:", actualSessionId);
            console.log(
              "🔢 Action Number:",
              `${actionNumber}/${request.actions.length}`
            );
            console.log("🎯 Action Type:", action.type);
            console.log("🌐 Current URL AFTER:", page.url());
            console.log("◆".repeat(80));
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
            await page.waitForLoadState("networkidle", { timeout });
            this.logger.info("Network idle achieved", {
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

            if (request.options?.useEnhancedExtraction) {
              const enhancedContent =
                await this.contentExtractor.extractEnhancedPageContent(
                  page,
                  request.options.enhancedExtractionOptions
                );
              result.pageContent = JSON.stringify(enhancedContent);
            } else {
              const basicContent =
                await this.contentExtractor.extractBasicPageContent(page);
              result.pageContent = JSON.stringify(basicContent);
            }

            this.logger.info("Page content extracted", {
              sessionId: actualSessionId,
              contentLength: result.pageContent?.length || 0,
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
              persistentPagesCount:
                this.sessionManager.getSessionStats().activeSessions,
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
            persistentPagesCount:
              this.sessionManager.getSessionStats().activeSessions,
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
   */
  async extractEnhancedPageContent(
    page: Page,
    options: {
      includeHTML?: boolean;
      htmlCleaningOptions?: any;
      includeInteractiveElements?: boolean;
      maxContentSize?: number;
    } = {}
  ) {
    return this.contentExtractor.extractEnhancedPageContent(page, options);
  }

  /**
   * Get session statistics
   */
  getSessionStats() {
    return this.sessionManager.getSessionStats();
  }

  /**
   * Check if the Playwright service is ready (browser and context initialized)
   */
  public isReady(): boolean {
    return !!(
      this.browserManager.getBrowser() && this.browserManager.getContext()
    );
  }

  /**
   * Get service status information
   */
  public getStatus(): { browserReady: boolean; contextReady: boolean } {
    return {
      browserReady: !!this.browserManager.getBrowser(),
      contextReady: !!this.browserManager.getContext(),
    };
  }

  async cleanup(): Promise<void> {
    this.logger.info("Starting PlaywrightService cleanup");

    try {
      // Close all persistent pages first
      await this.sessionManager.cleanup();

      // Then cleanup browser
      await this.browserManager.cleanup();

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
