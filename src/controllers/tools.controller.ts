import { ApiError } from "../utils/ApiError";
import { ApiResponse } from "../utils/ApiResponse";
import { sentryMonitoringService } from "../services/monitoring";

import { PromptInjectionProtectionService } from "../services/cleaning";
import { globalTimerService } from "../services/timer";
import { webQAService } from "../services/webScraping";
import { hackrxService } from "../services/webAutomation";

export const toolsController = {
  async runHackRX(request: Request): Promise<Response> {
    // Start global timer immediately when API is hit
    const timerContext = globalTimerService.startTimer(
      `tools_hackrx_${Date.now()}`
    );

    return await sentryMonitoringService.track(
      "tools_hackrx_endpoint",
      "pdf_processing",
      {
        endpoint: "/tools/hackrx/run",
        method: "POST",
        timer_enabled: timerContext.timeoutMs !== Infinity,
        timeout_seconds: timerContext.timeoutMs / 1000,
      },
      async () => {
        let body: any = {};
        try {
          // Check timer at the start of processing
          if (timerContext.isExpired) {
            console.warn("⏰ Request already timed out at start");
            return new Response(
              JSON.stringify({
                answers: [
                  "I apologize, but the request timed out before processing could begin. Please try again.",
                ],
                timeout: true,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: 200, // Return 200 but indicate timeout
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Parse request body
          body = await request.json();
          console.log(
            "📝 Tools HackRX Request Body:",
            JSON.stringify(body, null, 2)
          );

          // Basic input validation
          if (!body || typeof body !== "object") {
            throw new ApiError(
              400,
              "Invalid request body. Expected JSON object."
            );
          }

          // Validate required fields
          const { url, questions } = body;

          if (!url) {
            throw new ApiError(400, "Missing required field: url");
          }

          if (!questions || !Array.isArray(questions)) {
            throw new ApiError(
              400,
              "Missing required field: questions (must be an array)"
            );
          }

          if (questions.length === 0) {
            throw new ApiError(400, "Questions array cannot be empty");
          }

          // Validate each question is a string
          for (let i = 0; i < questions.length; i++) {
            if (typeof questions[i] !== "string") {
              throw new ApiError(400, `Question ${i + 1} must be a string`);
            }
          }

          // Check for prompt injection in questions
          for (let i = 0; i < questions.length; i++) {
            const question = questions[i];
            const riskAssessment =
              PromptInjectionProtectionService.calculateRiskScore(question);
            if (
              riskAssessment.risk === "high" ||
              riskAssessment.risk === "critical"
            ) {
              throw new ApiError(
                400,
                `Potential prompt injection detected in question ${i + 1}`
              );
            }
          }

          // Check timer before processing
          if (timerContext.isExpired) {
            console.warn("⏰ Request timed out during validation");
            return new Response(
              JSON.stringify({
                answers: [
                  "Request timed out during validation. Please try again.",
                ],
                timeout: true,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          console.log("🚀 Starting HackRX processing with web automation");

          // Use the dedicated HackRX service with LLM and web automation tools
          const result = await hackrxService.processHackRX(
            { url, questions },
            timerContext
          );

          if (!result.success) {
            const error = result.error!;
            console.error("❌ HackRX processing failed:", error);

            // Determine HTTP status based on error type
            let status = 500;
            if (error.errorType === "validation") status = 400;
            else if (error.errorType === "timeout") status = 408;
            else if (error.errorType === "automation") status = 400;

            return new Response(
              JSON.stringify({
                answers: [error.error],
                error_type: error.errorType,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
                details: error.details,
              }),
              {
                status,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          console.log("✅ Tools HackRX Processing completed successfully");

          return new Response(JSON.stringify(result.data), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          console.error("❌ Tools HackRX Error:", error);

          // Handle different types of errors
          if (error instanceof ApiError) {
            return new Response(
              JSON.stringify({
                answers: [error.message],
                error_type: "api_error",
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: error.statusCode,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Generic error handling
          return new Response(
            JSON.stringify({
              answers: [
                "An unexpected error occurred while processing the tools request",
              ],
              error_type: "internal_error",
              elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }
    );
  },

  async runWebQA(request: Request): Promise<Response> {
    // Start global timer immediately when API is hit
    const timerContext = globalTimerService.startTimer(
      `tools_web_qa_${Date.now()}`
    );

    return await sentryMonitoringService.track(
      "tools_web_qa_endpoint",
      "qa_pipeline",
      {
        endpoint: "/tools/web-qa",
        method: "POST",
        timer_enabled: timerContext.timeoutMs !== Infinity,
        timeout_seconds: timerContext.timeoutMs / 1000,
      },
      async () => {
        let body: any = {};
        try {
          // Check timer at the start of processing
          if (timerContext.isExpired) {
            console.warn("⏰ Request already timed out at start");
            return new Response(
              JSON.stringify({
                answers: [
                  "I apologize, but the request timed out before processing could begin. Please try again.",
                ],
                timeout: true,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: 200, // Return 200 but indicate timeout
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Parse request body
          body = await request.json();
          console.log(
            "📝 Tools Web Q&A Request Body:",
            JSON.stringify(body, null, 2)
          );

          // Basic input validation
          if (!body || typeof body !== "object") {
            throw new ApiError(
              400,
              "Invalid request body. Expected JSON object."
            );
          }

          // Validate required fields
          const { url, questions } = body;

          if (!url) {
            throw new ApiError(400, "Missing required field: url");
          }

          if (!questions || !Array.isArray(questions)) {
            throw new ApiError(
              400,
              "Missing required field: questions (must be an array)"
            );
          }

          if (questions.length === 0) {
            throw new ApiError(400, "Questions array cannot be empty");
          }

          // Validate each question is a string
          for (let i = 0; i < questions.length; i++) {
            if (typeof questions[i] !== "string") {
              throw new ApiError(400, `Question ${i + 1} must be a string`);
            }
          }

          // Check for prompt injection in questions
          for (let i = 0; i < questions.length; i++) {
            const question = questions[i];
            const riskAssessment =
              PromptInjectionProtectionService.calculateRiskScore(question);
            if (
              riskAssessment.risk === "high" ||
              riskAssessment.risk === "critical"
            ) {
              throw new ApiError(
                400,
                `Potential prompt injection detected in question ${i + 1}`
              );
            }
          }

          // Check timer before processing
          if (timerContext.isExpired) {
            console.warn("⏰ Request timed out during validation");
            return new Response(
              JSON.stringify({
                answers: [
                  "Request timed out during validation. Please try again.",
                ],
                timeout: true,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          console.log("🌐 Starting web Q&A processing");

          // Use the dedicated web Q&A service
          const result = await webQAService.processWebQA(body, timerContext);

          if (!result.success) {
            const error = result.error!;
            console.error("❌ Web Q&A processing failed:", error);

            // Determine HTTP status based on error type
            let status = 500;
            if (error.errorType === "validation") status = 400;
            else if (error.errorType === "timeout") status = 408;
            else if (error.errorType === "scraping") status = 400;

            return new Response(
              JSON.stringify({
                answers: [error.error],
                error_type: error.errorType,
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
                details: error.details,
              }),
              {
                status,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          console.log("✅ Tools Web Q&A Processing completed successfully");

          return new Response(JSON.stringify(result.data), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          console.error("❌ Tools Web Q&A Error:", error);

          // Handle different types of errors
          if (error instanceof ApiError) {
            return new Response(
              JSON.stringify({
                answers: [error.message],
                error_type: "api_error",
                elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
              }),
              {
                status: error.statusCode,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Generic error handling
          return new Response(
            JSON.stringify({
              answers: [
                "An unexpected error occurred while processing the web Q&A request",
              ],
              error_type: "internal_error",
              elapsed_seconds: (Date.now() - timerContext.startTime) / 1000,
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }
    );
  },
};
