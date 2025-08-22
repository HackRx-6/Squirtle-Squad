import { Elysia } from "elysia";
import { healthcheckRoute } from "./healthcheck.route";
import { pdfRoute } from "./pdf.route";
import { toolsRoute } from "./tools.route";

export const setupRoutes = (app: Elysia) => {
  healthcheckRoute(app);
  pdfRoute(app);
  toolsRoute(app);
  return app;
};
