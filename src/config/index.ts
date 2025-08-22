import { AIConfigService } from "./ai.config";
import { AppConfigService } from "./app.config";
import { LoggingConfigService } from "./logging.config";

export const Config = {
    ai: AIConfigService.getInstance(),
    app: AppConfigService.getInstance(),
    logging: LoggingConfigService.getInstance(),
};

export * from "./ai.config";
export * from "./app.config";
export * from "./logging.config";
export * from "./types";
