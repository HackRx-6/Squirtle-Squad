// Initialize Sentry monitoring early
import "./services/monitoring";

// Initialize logging service early to capture all console logs
import "./services/logging";

import { Config } from "./config";
import app from "./app";

const serverConfig = Config.app.getServerConfig();

console.log(`🚀 Starting server on port ${serverConfig.port}...`);
console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);

try {
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
} catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
}
