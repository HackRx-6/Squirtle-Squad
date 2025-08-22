import { Elysia } from "elysia";
import { ApiError } from "./utils/ApiError";
import { setupRoutes } from "./routes";

// Create Elysia app instance
const app = new Elysia()
    .get("/", () => {
        // Log complete request body before sending response (root endpoint has no body)
        console.log("📤 Complete request body before sending response:", JSON.stringify({}, null, 2));
        
        return {
            success: true,
            message: "Welcome to Fantastic Robo API",
            status: 200
        };
    })
    .onError(({ error }) => {
        // Log complete request body before sending error response
        console.log("📤 Complete request body before sending error response:", JSON.stringify({}, null, 2));
        
        if (error instanceof ApiError) {
            return {
                success: false,
                message: error.message,
                errors: error.errors,
                data: error.data,
                status: error.statusCode,
            };
        }
        return {
            success: false,
            message: "Internal Server Error",
            status: 500,
        };
    })
    .options("*", () => {
        // Log complete request body before sending OPTIONS response
        console.log("📤 Complete request body before sending OPTIONS response:", JSON.stringify({}, null, 2));
        
        return new Response(null, { status: 204 });
    });

// Setup routes
setupRoutes(app);

// Export the app instance
export default app;