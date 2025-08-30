/**
 * Simple session tracker for web automation sessions
 */
export class WebAutomationSessionTracker {
  private static instance: WebAutomationSessionTracker;
  private currentSessionId: string | null = null;
  private sessionStartTime: number = 0;
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  public static getInstance(): WebAutomationSessionTracker {
    if (!WebAutomationSessionTracker.instance) {
      WebAutomationSessionTracker.instance = new WebAutomationSessionTracker();
    }
    return WebAutomationSessionTracker.instance;
  }

  public getOrCreateSessionId(): string {
    const now = Date.now();

    // Check if current session is still valid
    if (
      this.currentSessionId &&
      now - this.sessionStartTime < this.SESSION_TIMEOUT_MS
    ) {
      console.log(
        `🎭 [SessionTracker] Reusing session: ${this.currentSessionId}`
      );
      return this.currentSessionId;
    }

    // Create new session
    this.currentSessionId = `llm_persistent_${now}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    this.sessionStartTime = now;

    console.log(
      `🎭 [SessionTracker] Created new session: ${this.currentSessionId}`
    );
    return this.currentSessionId;
  }

  public invalidateSession(): void {
    if (this.currentSessionId) {
      console.log(
        `🎭 [SessionTracker] Invalidating session: ${this.currentSessionId}`
      );
      this.currentSessionId = null;
      this.sessionStartTime = 0;
    }
  }
}
