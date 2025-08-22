import { Config } from "../../config";
import { loggingService } from "../logging/core.logging";
import { type TimerContext } from "./types";

export class GlobalTimerService {
    private static instance: GlobalTimerService;
    private activeTimers: Map<string, TimerContext> = new Map();
    private logger: ReturnType<typeof loggingService.createComponentLogger>;

    private constructor() {
        this.logger =
            loggingService.createComponentLogger("GlobalTimerService");
    }

    public static getInstance(): GlobalTimerService {
        if (!GlobalTimerService.instance) {
            GlobalTimerService.instance = new GlobalTimerService();
        }
        return GlobalTimerService.instance;
    }

    /**
     * Start a new global timer for an API request
     */
    public startTimer(requestId?: string): TimerContext {
        const qaConfig = Config.app.getQAConfig();

        if (!qaConfig.globalTimer.enabled) {
            // Return a dummy context if timer is disabled
            return {
                id: requestId || "disabled",
                startTime: Date.now(),
                timeoutMs: Infinity,
                abortController: new AbortController(),
                isExpired: false,
                cleanupCallbacks: [],
            };
        }

        const id =
            requestId ||
            `timer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timeoutMs = qaConfig.globalTimer.timeoutSeconds * 1000;
        const abortController = new AbortController();

        const context: TimerContext = {
            id,
            startTime: Date.now(),
            timeoutMs,
            abortController,
            isExpired: false,
            cleanupCallbacks: [],
        };

        // Set up the timeout
        const timeoutHandle = setTimeout(() => {
            this.expireTimer(id);
        }, timeoutMs);

        // Add cleanup for the timeout handle
        context.cleanupCallbacks.push(() => {
            clearTimeout(timeoutHandle);
        });

        this.activeTimers.set(id, context);

        this.logger.info("Global timer started", {
            timerId: id,
            timeoutSeconds: qaConfig.globalTimer.timeoutSeconds,
            timeoutMs,
        });

        return context;
    }

    /**
     * Expire a timer and abort all associated operations
     */
    private expireTimer(timerId: string): void {
        const context = this.activeTimers.get(timerId);
        if (!context) return;

        context.isExpired = true;
        context.abortController.abort();

        this.logger.warn("Global timer expired", {
            timerId,
            elapsedMs: Date.now() - context.startTime,
            timeoutMs: context.timeoutMs,
        });

        // Run cleanup callbacks
        context.cleanupCallbacks.forEach((cleanup) => {
            try {
                cleanup();
            } catch (error) {
                this.logger.error("Error during timer cleanup", {
                    timerId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }
        });

        this.activeTimers.delete(timerId);
    }

    /**
     * Check if a timer is expired
     */
    public isExpired(timerId: string): boolean {
        const context = this.activeTimers.get(timerId);
        return context ? context.isExpired : true;
    }

    /**
     * Get timer context by ID
     */
    public getTimer(timerId: string): TimerContext | undefined {
        return this.activeTimers.get(timerId);
    }

    /**
     * Get remaining time in milliseconds
     */
    public getRemainingTime(timerId: string): number {
        const context = this.activeTimers.get(timerId);
        if (!context || context.isExpired) return 0;

        const elapsed = Date.now() - context.startTime;
        const remaining = context.timeoutMs - elapsed;
        return Math.max(0, remaining);
    }

    /**
     * Add a cleanup callback to a timer
     */
    public addCleanupCallback(timerId: string, callback: () => void): void {
        const context = this.activeTimers.get(timerId);
        if (context) {
            context.cleanupCallbacks.push(callback);
        }
    }

    /**
     * Manually complete a timer (before expiration)
     */
    public completeTimer(timerId: string): void {
        const context = this.activeTimers.get(timerId);
        if (!context) return;

        const elapsed = Date.now() - context.startTime;

        this.logger.info("Global timer completed", {
            timerId,
            elapsedMs: elapsed,
            timeoutMs: context.timeoutMs,
            completed: true,
        });

        // Run cleanup callbacks
        context.cleanupCallbacks.forEach((cleanup) => {
            try {
                cleanup();
            } catch (error) {
                this.logger.error("Error during timer completion cleanup", {
                    timerId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }
        });

        this.activeTimers.delete(timerId);
    }

    /**
     * Get statistics about active timers
     */
    public getStats(): {
        activeTimers: number;
        timers: Array<{
            id: string;
            elapsedMs: number;
            remainingMs: number;
            isExpired: boolean;
        }>;
    } {
        const now = Date.now();
        const timers = Array.from(this.activeTimers.values()).map(
            (context) => ({
                id: context.id,
                elapsedMs: now - context.startTime,
                remainingMs: Math.max(
                    0,
                    context.timeoutMs - (now - context.startTime)
                ),
                isExpired: context.isExpired,
            })
        );

        return {
            activeTimers: this.activeTimers.size,
            timers,
        };
    }

    /**
     * Cleanup all timers (for shutdown)
     */
    public cleanup(): void {
        this.logger.info("Cleaning up all active timers", {
            activeCount: this.activeTimers.size,
        });

        for (const [timerId] of this.activeTimers) {
            this.completeTimer(timerId);
        }
    }
}

export const globalTimerService = GlobalTimerService.getInstance();
