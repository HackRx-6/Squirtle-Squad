export interface ToolCall {
    type: "url_scrape";
    url: string;
    trigger: "question" | "document";
    sourceDocId?: string;
    sourceChunkIndex?: number;
    confidence: number; // 0..1
    reason?: string;
}

export interface WebChunkMetadata {
    source: "web";
    url: string;
    title?: string;
    fetchedAt: string;
    sourceChunkIndex?: number;
}
