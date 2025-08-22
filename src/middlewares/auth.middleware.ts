import type { Context } from "elysia";
import { AppConfigService } from "../config/app.config.js";

const appConfig = AppConfigService.getInstance();

/**
 * Get the HackRX authentication token from environment variables
 */
const getHackRXAuthToken = (): string => {
    const token = appConfig.getAuthConfig().hackrxAuthToken;
    if (!token) {
        throw new Error("HACKRX_AUTH_TOKEN environment variable is not set");
    }
    return token;
};

/**
 * Authentication middleware for HackRX endpoints
 * Checks for Bearer token in Authorization header
 */
export const authMiddleware = (context: Context) => {
    const authHeader = context.request.headers.get("Authorization");

    if (!authHeader) {
        return new Response(null, { status: 401 });
    }

    // Check if it's a Bearer token
    if (!authHeader.startsWith("Bearer ")) {
        return new Response(null, { status: 401 });
    }

    // Extract token
    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Validate token
    if (token !== getHackRXAuthToken()) {
        return new Response(null, { status: 401 });
    }

    // Token is valid, continue to next handler
    return undefined;
};

/**
 * Helper function to extract and validate auth token
 */
export const validateAuthToken = (request: Request): boolean => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return false;
    }

    const token = authHeader.substring(7);
    return token === getHackRXAuthToken();
};
