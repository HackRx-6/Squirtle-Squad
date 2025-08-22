// Initialize Sentry monitoring early
import "./services/monitoring";

// Initialize logging service early to capture all console logs
import "./services/logging";

import { Config } from "./config";
import app from "./app";
import { startupService } from "./services/startup";

const serverConfig = Config.app.getServerConfig();

console.log(`🚀 Starting server on port ${serverConfig.port}...`);
console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);

async function startServer() {
    try {
        // Initialize services before starting the server
        console.log("🔧 Initializing services...");
        await startupService.initializeServices();
        
        // Start the server
        Bun.serve({
            fetch: app.fetch,
            port: serverConfig.port,
            error(error) {
                console.error("❌ Server error:", error);
                return new Response("Internal Server Error", { status: 500 });
            },
        });

        console.log(
            `✅ Server successfully running on http://localhost:${serverConfig.port}`
        );
        console.log(
            `🏥 Health check available at: http://localhost:${serverConfig.port}/healthcheck`
        );
        
        // Log service status
        const status = startupService.getInitializationStatus();
        console.log("📋 Service Status:");
        console.log(`   🎭 Playwright: ${status.playwrightReady ? "✅ Ready" : "⚠️  On-demand"}`);
        
    } catch (error) {
        console.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
    console.log("\n🔄 Received SIGINT, starting graceful shutdown...");
    await startupService.shutdown();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("\n🔄 Received SIGTERM, starting graceful shutdown...");
    await startupService.shutdown();
    process.exit(0);
});

// Start the server
startServer();
