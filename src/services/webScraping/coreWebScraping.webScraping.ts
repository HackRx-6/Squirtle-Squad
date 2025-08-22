import { AppConfigService } from "../../config/app.config";
import { SimpleHTMLCleaningService } from "../cleaning/simpleHtml.cleaning";

export class CoreWebScrapingService {
  private static instance: CoreWebScrapingService;
  private configService: AppConfigService;

  private constructor() {
    this.configService = AppConfigService.getInstance();
  }

  public static getInstance(): CoreWebScrapingService {
    if (!CoreWebScrapingService.instance) {
      CoreWebScrapingService.instance = new CoreWebScrapingService();
    }
    return CoreWebScrapingService.instance;
  }

  public async fetchText(
    url: string,
    signal?: AbortSignal
  ): Promise<{
    url: string;
    normalizedUrl: string;
    title?: string;
    text: string;
    htmlLength: number;
    fetchedAt: string;
    status: number;
    contentType?: string;
  }> {
    const qa = this.configService.getQAConfig();
    const tc = qa.toolCalls!;
    this.assertSafeUrl(url, tc.advanced?.deniedDomains || []);
    const normalizedUrl = this.normalizeUrl(url);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      tc.advanced?.timeoutMs || 8000
    );
    const composedSignal = signal
      ? this.anySignal([signal, controller.signal])
      : controller.signal;
    try {
      const res = await fetch(normalizedUrl, {
        redirect: "follow",
        signal: composedSignal,
        headers: {
          "user-agent": "fantastic-robo/1.0 (+https://example.com)",
          accept: "text/html,text/plain,application/xhtml+xml",
        },
      });

      const status = res.status;
      const contentType = res.headers.get("content-type") || undefined;
      if (!res.ok) {
        return {
          url,
          normalizedUrl,
          title: undefined,
          text: "",
          htmlLength: 0,
          fetchedAt: new Date().toISOString(),
          status,
          contentType,
        };
      }

      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        // Manual streaming to enforce maxBytes
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.length;
            if (received > (tc.advanced?.maxBytes || 2000000)) break;
            chunks.push(value);
          }
        }
      }
      const decoder = new TextDecoder("utf-8");
      const html = decoder.decode(Buffer.concat(chunks as any));
      const text = this.htmlToText(html);
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      const title = titleMatch ? titleMatch[1]?.trim() : undefined;
      return {
        url,
        normalizedUrl,
        title,
        text,
        htmlLength: html.length,
        fetchedAt: new Date().toISOString(),
        status,
        contentType,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private htmlToText(html: string): string {
    // Use the simple HTML cleaning service for better content extraction
    return SimpleHTMLCleaningService.smartExtract(html);
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      u.hash = "";
      [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "gclid",
        "fbclid",
      ].forEach((p) => u.searchParams.delete(p));
      return u.toString();
    } catch {
      return url;
    }
  }

  private anySignal(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    for (const s of signals) {
      if (s.aborted) return controller.signal;
      s.addEventListener("abort", onAbort, { once: true });
    }
    return controller.signal;
  }

  private assertSafeUrl(url: string, denied: string[]): void {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (denied.some((d) => host === d || host.endsWith(`.${d}`))) {
        throw new Error("Denied host");
      }
      if (!/^https?:$/.test(u.protocol)) throw new Error("Invalid scheme");
    } catch (e) {
      throw new Error(`Unsafe URL: ${url}`);
    }
  }
}

export const coreWebScrapingService = CoreWebScrapingService.getInstance();
