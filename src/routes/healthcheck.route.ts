import { Elysia } from "elysia";
import { healthcheckController } from "../controllers/healthcheck.controller";

export const healthcheckRoute = (app: Elysia) =>
    app
        .get("/healthcheck", () => healthcheckController.handle())
        .get("/health", () => healthcheckController.handle()); // Add alias for /health
