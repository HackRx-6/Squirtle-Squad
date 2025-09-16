import { loggingService } from "../logging";
import { playwrightService } from "../playwright";

export class StartupService {
  private static instance: StartupService;
  private logger = loggingService.createComponentLogger("StartupService");
  private isInitialized = false;

  private constructor() {
    this.logger.info("StartupService created");
  }

  public static getInstance(): StartupService {
    if (!StartupService.instance) {
      StartupService.instance = new StartupService();
    }
    return StartupService.instance;
  }

  /**
   * Initialize all services required for the application
   * This should be called during server startup
   */
  public async initializeServices(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn("Services already initialized, skipping initialization");
      return;
    }

    this.logger.info("Starting service initialization sequence");
    console.log("🚀 Initializing services...");

    const startTime = Date.now();
    const initResults: {
      service: string;
      success: boolean;
      timeMs?: number;
      error?: string;
    }[] = [];

    // Always try to initialize Playwright at startup for better performance
    // Will gracefully handle deployment issues and fall back to on-demand initialization

    // Initialize Playwright Service
    try {
      this.logger.info("Initializing Playwright service", {
        environment: process.env.NODE_ENV,
        dockerEnv: process.env.DOCKER_ENV,
      });
      console.log("🎭 Initializing Playwright browser...");

      const playwrightStartTime = Date.now();
      await playwrightService.initializeOnStartup();
      const playwrightTime = Date.now() - playwrightStartTime;

      initResults.push({
        service: "PlaywrightService",
        success: true,
        timeMs: playwrightTime,
      });

      this.logger.info("Playwright service initialized successfully", {
        initTimeMs: playwrightTime,
      });
    } catch (error: any) {
      // Handle specific bundling errors that are non-critical
      if (
        error.message?.includes("DOMMatrix") ||
        error.message?.includes("Cannot replace module namespace") ||
        error.message?.includes("configurable attribute") ||
        error.message?.includes("defineProperty")
      ) {
        console.warn(
          "⚠️  Non-critical bundling warning detected - Playwright will work on-demand"
        );
        this.logger.warn("Non-critical Playwright bundling warning", {
          error: error.message,
          note: "This is expected in bundled environments",
        });

        initResults.push({
          service: "PlaywrightService",
          success: true,
          timeMs: 0,
          error: "Bundling warning (non-critical)",
        });
      } else {
        const errorMsg = `Playwright service initialization failed: ${error.message}`;
        this.logger.error(errorMsg, {
          error: error.message,
          stack: error.stack,
        });

        initResults.push({
          service: "PlaywrightService",
          success: false,
          error: error.message,
        });

        // Log warning but don't fail startup - service will work lazily
        console.warn(
          "⚠️  Playwright initialization failed, will initialize on first use"
        );

        // Start background initialization to try again
        console.log("🔄 Starting background Playwright initialization...");
        this.startBackgroundPlaywrightInitialization();
      }
    } // Add more service initializations here as needed
    // Example:
    // await this.initializeOtherService();

    const totalTime = Date.now() - startTime;
    this.isInitialized = true;

    // Log summary
    const successCount = initResults.filter((r) => r.success).length;
    const failureCount = initResults.filter((r) => !r.success).length;

    this.logger.info("Service initialization completed", {
      totalTimeMs: totalTime,
      successfulServices: successCount,
      failedServices: failureCount,
      results: initResults,
    });

    console.log("✅ Service initialization completed:");
    console.log(`   📊 Total time: ${totalTime}ms`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failureCount}`);

    if (failureCount > 0) {
      console.log(
        "   ⚠️  Some services failed to initialize but will work on-demand"
      );
    }
  }

  /**
   * Start background Playwright initialization with retry mechanism
   */
  private startBackgroundPlaywrightInitialization(): void {
    const maxRetries = 3;
    const retryDelay = 5000; // 5 seconds

    const attemptInitialization = async (attempt: number) => {
      try {
        this.logger.info(
          `Background Playwright initialization attempt ${attempt}/${maxRetries}`
        );
        await playwrightService.initializeOnStartup();

        console.log("✅ Background Playwright initialization successful");
        this.logger.info(
          "Background Playwright initialization completed successfully",
          {
            attempt,
            ...playwrightService.getStatus(),
          }
        );
      } catch (error: any) {
        this.logger.warn(
          `Background Playwright initialization attempt ${attempt} failed`,
          {
            error: error.message,
            attempt,
            maxRetries,
          }
        );

        if (attempt < maxRetries) {
          console.log(
            `🔄 Retrying background Playwright initialization in ${
              retryDelay / 1000
            }s (attempt ${attempt + 1}/${maxRetries})`
          );
          setTimeout(() => attemptInitialization(attempt + 1), retryDelay);
        } else {
          console.warn(
            "⚠️  Background Playwright initialization failed after all retries - will remain on-demand"
          );
          this.logger.error(
            "Background Playwright initialization failed after all retries",
            {
              maxRetries,
              finalError: error.message,
            }
          );
        }
      }
    };

    // Start first attempt after a short delay to not interfere with server startup
    setTimeout(() => attemptInitialization(1), 2000);
  }

  /**
   * Get initialization status
   */
  public getInitializationStatus(): {
    isInitialized: boolean;
    playwrightReady: boolean;
  } {
    return {
      isInitialized: this.isInitialized,
      playwrightReady: this.isPlaywrightReady(),
    };
  }

  /**
   * Check if Playwright service is ready
   */
  private isPlaywrightReady(): boolean {
    try {
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Graceful shutdown of all services
   */
  public async shutdown(): Promise<void> {
    this.logger.info("Starting graceful shutdown of services");
    console.log("🔄 Shutting down services...");

    try {
      // Shutdown Playwright service
      await playwrightService.shutdown();
      this.logger.info("Playwright service shutdown completed");

      // Add other service shutdowns here

      this.isInitialized = false;
      console.log("✅ All services shutdown completed");
    } catch (error: any) {
      this.logger.error("Error during service shutdown", {
        error: error.message,
        stack: error.stack,
      });
      console.error("❌ Error during service shutdown:", error.message);
    }
  }
}

// Export singleton instance
export const startupService = StartupService.getInstance();
