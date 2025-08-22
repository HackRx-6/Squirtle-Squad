import { TextExtractionService } from "./text.extraction";
import { DocxExtractionService } from "./docx.extraction";
import { EmailExtractionService } from "./email.extraction";
import { OCRExtractionService } from "./ocr.extraction";
import { XlsxExtractionService } from "./xlsx.extraction";
import { PptxExtractionService } from "./pptx.extraction";
import { PythonPdfExtractionService } from "./pythonPdf.extraction";
import { AppConfigService } from "../../config/app.config";
import type { UnifiedExtractionResult } from "./types";

export * from "./types";

export class UnifiedTextExtractionService {
    private unpdfService: TextExtractionService;
    private pythonPdfService: PythonPdfExtractionService;
    private docxService: DocxExtractionService;
    private emailService: EmailExtractionService;
    private ocrService: OCRExtractionService;
    private xlsxService: XlsxExtractionService;
    private pptxService: PptxExtractionService;
    private configService: AppConfigService;

    constructor() {
        this.unpdfService = new TextExtractionService();
        this.pythonPdfService = new PythonPdfExtractionService();
        this.docxService = new DocxExtractionService();
        this.emailService = new EmailExtractionService();
        this.ocrService = new OCRExtractionService();
        this.xlsxService = new XlsxExtractionService();
        this.pptxService = new PptxExtractionService();
        this.configService = AppConfigService.getInstance();

        // Use app config to determine PDF extraction method
        const extractionConfig =
            this.configService.getQAConfig().textExtraction;

        console.log(`📄 PDF Extraction Configuration:`);
        console.log(`   Primary method: ${extractionConfig.pdfMethod}`);
        console.log(`   Fallback enabled: ${extractionConfig.fallbackEnabled}`);
        console.log(
            `   Python service URL: ${extractionConfig.pythonService.url}`
        );
        console.log(
            `   Service timeout: ${extractionConfig.pythonService.timeout}ms`
        );
    }

    /**
     * Extract text from any supported document type
     */
    async extractFromDocument(
        buffer: Buffer,
        filename: string,
        docType: "pdf" | "docx" | "email" | "image" | "xlsx" | "pptx"
    ): Promise<UnifiedExtractionResult> {
        switch (docType) {
            case "pdf":
                return this.extractFromPDF(buffer, filename);
            case "docx":
                return this.docxService.extractFromDocx(buffer, filename);
            case "email":
                return this.emailService.extractFromEmail(buffer, filename);
            case "image":
                return this.ocrService.extractFromImage(buffer, filename);
            case "xlsx":
                return this.xlsxService.extractFromXlsx(buffer, filename);
            case "pptx":
                return this.pptxService.extractFromPptx(buffer, filename);
            default:
                throw new Error(`Unsupported document type: ${docType}`);
        }
    }

    async extractFromPDF(
        pdfBuffer: Buffer,
        filename: string
    ): Promise<UnifiedExtractionResult> {
        const config = this.configService.getQAConfig().textExtraction;
        const startTime = Date.now();

        // Log extraction attempt with current configuration
        console.log(
            `📄 Starting PDF extraction for ${filename} using ${config.pdfMethod}`
        );

        try {
            if (config.pdfMethod === "python-pymupdf") {
                // Use Python PyMuPDF service as primary method
                console.log(`🐍 Using Python PyMuPDF service for ${filename}`);

                const result = await this.pythonPdfService.extractTextFromPdf(
                    pdfBuffer,
                    filename
                );

                const totalTime = result.processingTime / 1000; // Convert to seconds
                const pageTexts = result.pages.map((page) => page.text);

                const performance = {
                    pages_per_second: result.metadata.totalPages / totalTime,
                    characters_extracted: result.metadata.totalCharacters,
                    average_chars_per_page:
                        result.metadata.totalCharacters /
                        result.metadata.totalPages,
                };

                if (config.performanceLogging) {
                    console.log(
                        `� PyMuPDF Performance: ${performance.pages_per_second.toFixed(
                            1
                        )} pages/sec, ${
                            performance.characters_extracted
                        } chars, avg ${
                            performance.average_chars_per_page
                        } chars/page`
                    );
                }

                return {
                    fullText: result.text,
                    pageTexts: pageTexts,
                    totalPages: result.metadata.totalPages,
                    extractionTime: totalTime,
                    library: "PyMuPDF",
                    method: "python-pymupdf",
                    performance,
                };
            } else {
                // Use unpdf as primary method
                console.log(`📦 Using unpdf for ${filename}`);

                const result = await this.unpdfService.extractFromPDF(
                    pdfBuffer,
                    filename
                );
                const totalTime = (Date.now() - startTime) / 1000;

                const performance = {
                    pages_per_second: result.totalPages / totalTime,
                    characters_extracted: result.fullText.length,
                    average_chars_per_page:
                        result.fullText.length / result.totalPages,
                };

                if (config.performanceLogging) {
                    console.log(
                        `� unpdf Performance: ${performance.pages_per_second.toFixed(
                            1
                        )} pages/sec, ${
                            performance.characters_extracted
                        } chars, avg ${
                            performance.average_chars_per_page
                        } chars/page`
                    );
                }

                return {
                    fullText: result.fullText,
                    pageTexts: result.pageTexts,
                    totalPages: result.totalPages,
                    extractionTime: totalTime,
                    library: "unpdf",
                    method: "unpdf",
                    performance,
                };
            }
        } catch (error) {
            console.error(
                `❌ PDF extraction failed with ${config.pdfMethod}:`,
                error
            );

            // Only attempt fallback if it's enabled and we have an alternative method
            if (config.fallbackEnabled) {
                console.log(
                    `🔄 Attempting fallback extraction for ${filename}...`
                );

                try {
                    if (config.pdfMethod === "python-pymupdf") {
                        // Fallback from Python to unpdf
                        console.log(`📦 Falling back to unpdf for ${filename}`);

                        const result = await this.unpdfService.extractFromPDF(
                            pdfBuffer,
                            filename
                        );
                        const totalTime = (Date.now() - startTime) / 1000;

                        const performance = {
                            pages_per_second: result.totalPages / totalTime,
                            characters_extracted: result.fullText.length,
                            average_chars_per_page:
                                result.fullText.length / result.totalPages,
                        };

                        console.log(
                            `✅ Fallback successful: unpdf extracted ${performance.characters_extracted} chars`
                        );

                        return {
                            fullText: result.fullText,
                            pageTexts: result.pageTexts,
                            totalPages: result.totalPages,
                            extractionTime: totalTime,
                            library: "unpdf (fallback)",
                            method: "unpdf",
                            performance,
                        };
                    } else {
                        // Fallback from unpdf to Python (if available)
                        console.log(
                            `🐍 Falling back to Python PyMuPDF for ${filename}`
                        );

                        const result =
                            await this.pythonPdfService.extractTextFromPdf(
                                pdfBuffer,
                                filename
                            );

                        const totalTime = result.processingTime / 1000; // Convert to seconds
                        const pageTexts = result.pages.map((page) => page.text);

                        const performance = {
                            pages_per_second:
                                result.metadata.totalPages / totalTime,
                            characters_extracted:
                                result.metadata.totalCharacters,
                            average_chars_per_page:
                                result.metadata.totalCharacters /
                                result.metadata.totalPages,
                        };

                        console.log(
                            `✅ Fallback successful: PyMuPDF extracted ${performance.characters_extracted} chars`
                        );

                        return {
                            fullText: result.text,
                            pageTexts: pageTexts,
                            totalPages: result.metadata.totalPages,
                            extractionTime: totalTime,
                            library: "PyMuPDF (fallback)",
                            method: "python-pymupdf",
                            performance,
                        };
                    }
                } catch (fallbackError) {
                    console.error(
                        `❌ Fallback extraction also failed:`,
                        fallbackError
                    );
                    throw new Error(
                        `PDF extraction failed with both ${
                            config.pdfMethod
                        } and fallback method: ${
                            error instanceof Error
                                ? error.message
                                : "Unknown error"
                        }`
                    );
                }
            } else {
                console.log(
                    `⚠️ Fallback is disabled. PDF extraction failed for ${filename}`
                );
                throw error;
            }
        }
    }

    /**
     * Get current extraction configuration
     */
    public getExtractionConfig() {
        return this.configService.getQAConfig().textExtraction;
    }

    /**
     * Check health of all extraction services
     */
    public async checkServicesHealth() {
        const config = this.configService.getQAConfig().textExtraction;
        const isPythonPdfEnabled = config.pdfMethod === "python-pymupdf";
        const pythonPdfHealth = isPythonPdfEnabled
            ? await this.pythonPdfService.checkHealth()
            : null;

        return {
            current: {
                primaryMethod: config.pdfMethod,
                fallbackEnabled: config.fallbackEnabled,
            },
            pythonPdf: {
                enabled: isPythonPdfEnabled,
                healthy: pythonPdfHealth,
                url: this.pythonPdfService.getServiceInfo().url,
                timeout: config.pythonService.timeout,
            },
            unpdf: {
                enabled: true,
                healthy: true, // unpdf is always available as it's built-in
            },
        };
    }
}
