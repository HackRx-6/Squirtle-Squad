import { PageWiseChunkingStrategy } from "./pageWise.chunking";
import { CharacterWiseChunkingStrategy } from "./characterWise.chunking";
import { RecursiveTextChunkingStrategy } from "./recursiveText.chunking";
import { sentryMonitoringService } from "../monitoring";
import { Config } from "../../config";
import type { DocumentChunk } from "../../types/document.types";

export class ChunkingService {
    private pageWiseStrategy: PageWiseChunkingStrategy;
    private characterWiseStrategy: CharacterWiseChunkingStrategy;
    private recursiveStrategy: RecursiveTextChunkingStrategy;

    constructor() {
        const chunkingConfig = Config.app.getChunkingConfig();

        this.pageWiseStrategy = new PageWiseChunkingStrategy({
            pagesPerChunk: chunkingConfig.pageWise.pagesPerChunk,
        });

        this.characterWiseStrategy = new CharacterWiseChunkingStrategy({
            chunkSize: chunkingConfig.characterWise.chunkSize,
            overlap: chunkingConfig.characterWise.overlap,
            minChunkSizeRatio: chunkingConfig.characterWise.minChunkSizeRatio,
        });

        this.recursiveStrategy = new RecursiveTextChunkingStrategy({
            chunkSize: chunkingConfig.recursive.chunkSize,
            chunkOverlap: chunkingConfig.recursive.chunkOverlap,
            separators: chunkingConfig.recursive.separators,
            keepSeparator: chunkingConfig.recursive.keepSeparator,
        });
    }

    public async createChunks(
        pageTexts: string[],
        fullText: string,
        filename: string
    ): Promise<DocumentChunk[]> {
        return await sentryMonitoringService.track(
            `Document chunking: ${filename}`,
            "chunking",
            {
                filename,
                pageCount: pageTexts.length,
                textLength: fullText.length,
            },
            async () => {
                const chunkingConfig = Config.app.getChunkingConfig();

                // Priority order: recursive > character-wise > page-wise (default)
                if (chunkingConfig.recursive.enabled) {
                    console.log("🔄 Using recursive text chunking strategy");
                    return await this.recursiveStrategy.chunk(
                        fullText,
                        filename
                    );
                }

                // Use character-wise chunking
                if (chunkingConfig.characterWise.enabled) {
                    console.log("🔤 Using character-wise chunking strategy");
                    return this.characterWiseStrategy.chunk(fullText, filename);
                }

                // Default to page-wise chunking
                console.log("📄 Using page-wise chunking strategy (default)");
                return this.pageWiseStrategy.chunk(pageTexts, filename);
            },
            {
                strategy: this.getCurrentStrategy(),
                chunkingConfig: Config.app.getChunkingConfig(),
            }
        );
    }

    /**
     * Update chunking strategy at runtime
     */
    public updateChunkingStrategy(
        strategy: "pageWise" | "characterWise" | "recursive"
    ): void {
        const chunkingConfig = Config.app.getChunkingConfig();

        // Reset all strategies
        chunkingConfig.pageWise.enabled = false;
        chunkingConfig.characterWise.enabled = false;
        chunkingConfig.recursive.enabled = false;

        // Enable selected strategy
        chunkingConfig[strategy].enabled = true;

        console.log(`🔄 Switched to ${strategy} chunking strategy`);
    }

    /**
     * Get current active chunking strategy
     */
    public getCurrentStrategy(): string {
        const chunkingConfig = Config.app.getChunkingConfig();

        if (chunkingConfig.recursive.enabled) return "recursive";
        if (chunkingConfig.characterWise.enabled) return "characterWise";
        return "pageWise";
    }
}

export * from "./base.chunking";
export * from "./pageWise.chunking";
export * from "./characterWise.chunking";
export * from "./recursiveText.chunking";
