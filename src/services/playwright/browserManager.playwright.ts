import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";
import type { PlaywrightServiceConfig } from "./types";
import { loggingService } from "../logging";

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private config: PlaywrightServiceConfig;
  private logger = loggingService.createComponentLogger("BrowserManager");

  constructor(config: PlaywrightServiceConfig) {
    this.config = config;
  }

  /**
   * Initialize the browser and context
   */
  async initializeBrowser(): Promise<void> {
    if (!this.browser) {
      this.logger.info("Launching Chromium browser", {
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

      const startTime = Date.now();

      // Use system Chromium in Docker/production environments
      const isDocker =
        process.env.DOCKER_ENV === "true" ||
        process.env.NODE_ENV === "production";
      const launchOptions: any = {
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
      };

      // In Docker or production, use system-installed Chromium
      if (isDocker) {
        launchOptions.executablePath = "/usr/bin/chromium-browser";
        this.logger.info(
          "Using system Chromium browser in Docker/production environment",
          {
            executablePath: launchOptions.executablePath,
            dockerEnv: process.env.DOCKER_ENV,
            nodeEnv: process.env.NODE_ENV,
          }
        );
      }

      this.browser = await chromium.launch(launchOptions);

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
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
        },
        // Disable unnecessary features for speed
        javaScriptEnabled: true,
        bypassCSP: true,
      });

      // Set faster timeout defaults for the context
      this.context.setDefaultTimeout(this.config.defaultTimeout);
      this.context.setDefaultNavigationTimeout(this.config.defaultTimeout);

      this.logger.info("Browser context created successfully");
    }
  }

  /**
   * Get the browser instance
   */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Get the browser context
   */
  getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * Close browser and context
   */
  async cleanup(): Promise<void> {
    this.logger.info("Starting browser cleanup");

    try {
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

      this.logger.info("Browser cleanup completed successfully");
    } catch (error) {
      this.logger.error("Error during browser cleanup", { error });
      throw error;
    }
  }
}
