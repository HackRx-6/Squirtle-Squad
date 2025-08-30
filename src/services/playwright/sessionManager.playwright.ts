import type { Page, BrowserContext } from "playwright";
import type { PlaywrightServiceConfig } from "./types";
import { loggingService } from "../logging";

export class SessionManager {
  private persistentPages: Map<string, Page> = new Map();
  private currentSessionId: string | null = null;
  private sessionStartTime: number = 0;
  private config: PlaywrightServiceConfig;
  private logger = loggingService.createComponentLogger("SessionManager");

  constructor(config: PlaywrightServiceConfig) {
    this.config = config;
  }

  /**
   * Get or create a persistent page for a session
   */
  async getOrCreatePersistentPage(
    sessionId: string,
    context: BrowserContext
  ): Promise<Page> {
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

    if (!context) {
      throw new Error("Browser context not initialized");
    }

    // Create new page
    this.logger.info("Creating new persistent page", { sessionId });
    page = await context.newPage();

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

  /**
   * Close a persistent page session
   */
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

  /**
   * Get the current active page
   */
  async getCurrentPage(): Promise<Page | null> {
    if (!this.currentSessionId) return null;

    const page = this.persistentPages.get(this.currentSessionId);
    return page && !page.isClosed() ? page : null;
  }

  /**
   * Get all active session IDs
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.persistentPages.keys()).filter((sessionId) => {
      const page = this.persistentPages.get(sessionId);
      return page && !page.isClosed();
    });
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    currentSessionId: string | null;
    sessionUptime: number;
  } {
    const activeSessions = this.getActiveSessionIds().length;
    const sessionUptime = this.currentSessionId
      ? Date.now() - this.sessionStartTime
      : 0;

    return {
      totalSessions: this.persistentPages.size,
      activeSessions,
      currentSessionId: this.currentSessionId,
      sessionUptime,
    };
  }

  /**
   * Cleanup all persistent pages
   */
  async cleanup(): Promise<void> {
    this.logger.info("Starting session cleanup", {
      persistentPagesCount: this.persistentPages.size,
    });

    if (this.persistentPages.size > 0) {
      this.logger.info("Closing all persistent pages", {
        pageCount: this.persistentPages.size,
      });

      for (const [sessionId, page] of this.persistentPages.entries()) {
        try {
          if (!page.isClosed()) {
            await page.close();
            this.logger.debug("Closed persistent page", { sessionId });
          }
        } catch (error) {
          this.logger.error("Error closing persistent page during cleanup", {
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
  }
}
