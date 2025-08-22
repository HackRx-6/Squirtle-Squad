import { ApiResponse } from "../utils/ApiResponse";
import { sentryMonitoringService } from "../services/monitoring";
import { loggingService } from "../services/logging";
import { UnifiedTextExtractionService } from "../services/extraction";

export const healthcheckController = {
    handle: async () => {
        const monitoringStats = sentryMonitoringService.getStats();
        const loggingStats = loggingService.getStats();

        // Check PDF extraction services health
        const textExtractionService = new UnifiedTextExtractionService();
        const extractionHealth =
            await textExtractionService.checkServicesHealth();

        const response = new ApiResponse({
            statusCode: 200,
            data: {
                status: "ok",
                services: {
                    pdfExtraction: extractionHealth,
                },
                monitoring: {
                    enabled: monitoringStats.enabled,
                    activeSpans: monitoringStats.activeSpans,
                    environment: monitoringStats.environment,
                    sentry_config: {
                        dsn_configured: monitoringStats.sentryDsn,
                        environment:
                            process.env.SENTRY_ENVIRONMENT || "development",
                        traces_sample_rate:
                            process.env.SENTRY_TRACES_SAMPLE_RATE || "1.0",
                        release: process.env.SENTRY_RELEASE || "unknown",
                    },
                },
                logging: {
                    enabled: loggingStats.enabled,
                    directory: loggingStats.logsDirectory,
                    totalFiles: loggingStats.totalLogFiles,
                    estimatedSize: loggingStats.estimatedLogSize,
                    recentFiles: loggingStats.logFiles.slice(-5), // Show last 5 files
                },
            },
            message:
                "Welcome to the project of SQUIRTLE SQUAD this is a team from MAIT, this project is so good that it will make you squirt!",
        });

        // Log complete request body before sending response (healthcheck has no body, so log empty object)
        console.log(
            "📤 Complete request body before sending response:",
            JSON.stringify({}, null, 2)
        );

        return response.toJSON();
    },
};
