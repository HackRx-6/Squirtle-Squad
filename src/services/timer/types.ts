export interface TimerContext {
    id: string;
    startTime: number;
    timeoutMs: number;
    abortController: AbortController;
    isExpired: boolean;
    cleanupCallbacks: (() => void)[];
}