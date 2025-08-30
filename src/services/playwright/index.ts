// Main service exports
export { PlaywrightService, playwrightService } from "./core.playwright";

// Component exports
export { BrowserManager } from "./browserManager.playwright";
export { ActionExecutor } from "./actionExecutor.playwright";
export { ContentExtractor } from "./contentExtractor.playwright";
export { SessionManager } from "./sessionManager.playwright";

// Generic browser automation utilities
export { elementFinder, ElementFinder } from './elementFinder.playwright';
export { inputFiller, InputFiller } from './inputFiller.playwright';
export { browserAutomation, BrowserAutomation } from './browserAutomation.playwright';

// Type exports
export * from "./types";

// Re-export specific interfaces for convenience
export type {
  ElementFindOptions,
  ElementFindStrategy,
  ElementFindResult,
} from './elementFinder.playwright';

export type {
  InputFillOptions,
  InputFillResult,
  FormFillData,
  FormFillOptions,
  FormFillResult,
} from './inputFiller.playwright';

export type {
  BrowserAutomationOptions,
  ClickOptions,
  NavigationOptions,
  WaitOptions,
} from './browserAutomation.playwright';
