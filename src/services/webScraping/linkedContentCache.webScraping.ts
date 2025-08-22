import type { ScrapedPage } from './types'

export class LinkedContentCacheService {
    private static instance: LinkedContentCacheService;
    private cache: Map<string, { page: ScrapedPage; expiresAt: number }> =
        new Map();

    public static getInstance(): LinkedContentCacheService {
        if (!LinkedContentCacheService.instance) {
            LinkedContentCacheService.instance =
                new LinkedContentCacheService();
        }
        return LinkedContentCacheService.instance;
    }

    public get(url: string): ScrapedPage | undefined {
        const entry = this.cache.get(url);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(url);
            return undefined;
        }
        return entry.page;
    }

    public set(url: string, page: ScrapedPage, ttlMs: number): void {
        this.cache.set(url, { page, expiresAt: Date.now() + ttlMs });
    }
}

export const linkedContentCache = LinkedContentCacheService.getInstance();
