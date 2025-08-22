export interface UnifiedExtractionResult {
    fullText: string;
    pageTexts: string[];
    totalPages: number;
    extractionTime: number;
    library: string;
    method:
        | "unpdf"
        | "python-pymupdf"
        | "docx"
        | "email"
        | "ocr"
        | "xlsx"
        | "pptx";
    performance?: ExtractionPerformance;
}

export interface ExtractionPerformance {
    pages_per_second: number;
    characters_extracted: number;
    average_chars_per_page: number;
}

export interface ExtractionConfig {
    pdfMethod: string;
    fallbackEnabled: boolean;
    performanceLogging: boolean;
    pythonService: {
        url: string;
        timeout: number;
    };
}

export interface ExtractionMetrics {
    startTime: number;
    endTime: number;
    processingTime: number;
    characterCount: number;
    pageCount: number;
    method: string;
    success: boolean;
    error?: string;
}

export interface DocumentType {
    extension: string;
    mimeType: string;
    category: "pdf" | "docx" | "email" | "image" | "xlsx" | "pptx";
}

export interface ExtractionOptions {
    enableOCR?: boolean;
    preserveFormatting?: boolean;
    extractImages?: boolean;
    timeout?: number;
    fallbackMethods?: string[];
}

export interface SemanticChunkingOptions {
    maxTokensPerChunk: number;
    minTokensPerChunk: number;
    overlapSentences: number;
}

export interface PptxPythonResponse {
    success: boolean;
    filename: string;
    pages: Array<{
        page_number: number;
        text: string;
        char_count: number;
    }>;
    metadata: {
        total_pages: number;
        total_characters: number;
        pdf_conversion_time?: number;
        ocr_processing_time?: number;
        source_type: string;
    };
    processing_time_seconds: number;
    extraction_method: string;
}

export interface PdfExtractionResult {
    success: boolean;
    filename: string;
    pages: Array<{
        page_number: number;
        text: string;
        char_count: number;
    }>;
    metadata: {
        total_pages: number;
        total_characters: number;
        title: string;
        author: string;
        subject: string;
        creator: string;
        producer: string;
        creation_date: string;
        modification_date: string;
    };
    processing_time_seconds: number;
    extraction_method: string;
}

export interface TextExtractionResult {
    fullText: string;
    pageTexts: string[];
    totalPages: number;
}