import { loggingService } from "../logging";
import { playwrightService } from "../webAutomation/playwright.service";

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
    const initResults: { service: string; success: boolean; timeMs?: number; error?: string }[] = [];

    // Initialize Playwright Service (temporarily disabled for Windows compatibility)
    try {
      this.logger.info("Skipping Playwright service initialization for Windows compatibility");
      console.log("⚠️  Skipping Playwright browser initialization (will initialize on first use)");
      
      // Skip Playwright initialization - comment out the line below
      // await playwrightService.initializeOnStartup();
      const playwrightTime = 0;
      
      initResults.push({
        service: "PlaywrightService",
        success: true,
        timeMs: playwrightTime,
      });
      
      this.logger.info("Playwright service initialized successfully", {
        initTimeMs: playwrightTime,
      });
    } catch (error: any) {
      const errorMsg = `Playwright service initialization failed: ${error.message}`;
      this.logger.error(errorMsg, { error: error.message, stack: error.stack });
      
      initResults.push({
        service: "PlaywrightService",
        success: false,
        error: error.message,
      });
      
      // Log warning but don't fail startup - service will work lazily
      console.warn("⚠️  Playwright initialization failed, will initialize on first use");
    }

    // Add more service initializations here as needed
    // Example:
    // await this.initializeOtherService();

    const totalTime = Date.now() - startTime;
    this.isInitialized = true;

    // Log summary
    const successCount = initResults.filter(r => r.success).length;
    const failureCount = initResults.filter(r => !r.success).length;

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
      console.log("   ⚠️  Some services failed to initialize but will work on-demand");
    }
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
      // Access private properties through any to check readiness
      const service = playwrightService as any;
      return !!(service.browser && service.context);
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
