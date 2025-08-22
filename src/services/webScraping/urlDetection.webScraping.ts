import { AppConfigService } from "../../config/app.config";

export class UrlDetectionService {
    private static instance: UrlDetectionService;
    private configService: AppConfigService;

    private constructor() {
        this.configService = AppConfigService.getInstance();
    }

    public static getInstance(): UrlDetectionService {
        if (!UrlDetectionService.instance) {
            UrlDetectionService.instance = new UrlDetectionService();
        }
        return UrlDetectionService.instance;
    }

    public extractUrls(text: string): string[] {
        if (!text) return [];
        const urlRegex = /(https?:\/\/[^\s)]+)|(?:www\.[^\s)]+)/gi;
        const matches = text.match(urlRegex) || [];
        const normalized = matches
            .map((u) => (u.startsWith("http") ? u : `https://${u}`))
            .map((u) => this.normalizeUrl(u))
            .filter(Boolean) as string[];
        return Array.from(new Set(normalized));
    }

    public classifyUrlIntent(question: string): {
        requiresUrl: boolean;
        confidence: number;
        urls: string[];
    } {
        const indicators = [
            "visit",
            "open",
            "go to",
            "fetch",
            "from the website",
            "on the site",
            "at this url",
            "use the link",
        ];
        const lowered = (question || "").toLowerCase();
        const hasIndicator = indicators.some((k) => lowered.includes(k));
        const urls = this.extractUrls(question || "");
        const requiresUrl = hasIndicator || urls.length > 0;
        const confidence = requiresUrl ? (hasIndicator ? 0.9 : 0.6) : 0.0;
        return { requiresUrl, confidence, urls };
    }

    public rankUrlRelevance(
        urls: string[],
        question: string
    ): Array<{
        url: string;
        score: number;
    }> {
        if (!urls.length) return [];
        const q = (question || "").toLowerCase();
        // Lightweight heuristic scoring; can be replaced with embedding similarity
        return urls
            .map((url) => {
                const u = url.toLowerCase();
                let score = 0.5;
                if (q && u.includes(new URL(url).hostname.replace("www.", "")))
                    score += 0.2;
                if (/(docs|blog|pricing|faq|guide|api)/.test(u)) score += 0.1;
                return { url, score };
            })
            .sort((a, b) => b.score - a.score);
    }

    private normalizeUrl(url: string): string {
        try {
            const u = new URL(url);
            u.hash = "";
            // Drop common tracking params
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
}

export const urlDetectionService = UrlDetectionService.getInstance();
