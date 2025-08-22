import { Mistral } from "@mistralai/mistralai";
import { sentryMonitoringService } from "../monitoring";
import type { UnifiedExtractionResult } from "./index";

export class OCRExtractionService {
    private readonly MISTRAL_OCR_MODEL = "mistral-ocr-latest";
    private readonly MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
    private client: Mistral | null = null;

    constructor() {
        if (!this.MISTRAL_API_KEY) {
            console.warn(
                "⚠️ MISTRAL_API_KEY not found in environment variables. OCR functionality will be limited."
            );
        } else {
            this.client = new Mistral({ apiKey: this.MISTRAL_API_KEY });
        }
    }

    async extractFromImage(
        buffer: Buffer,
        filename: string
    ): Promise<UnifiedExtractionResult> {
        return await sentryMonitoringService.track(
            `OCR extraction: ${filename}`,
            "extraction",
            { filename, bufferSize: buffer.length },
            async () => {
                const startTime = Date.now();

                try {
                    console.log(
                        `🖼️ Starting OCR extraction for ${filename} (${buffer.length} bytes)`
                    );

                    if (!this.client) {
                        throw new Error(
                            "MISTRAL_API_KEY is required for OCR processing"
                        );
                    }

                    // Convert buffer to base64 for Mistral API
                    const base64Image = buffer.toString("base64");
                    const mimeType = this.detectImageMimeType(buffer, filename);
                    const dataUri = `data:${mimeType};base64,${base64Image}`;

                    // Call Mistral OCR API
                    const ocrText = await this.callMistralOCR(
                        dataUri,
                        filename
                    );
                    const extractionTime = (Date.now() - startTime) / 1000;

                    console.log(
                        `📊 OCR result - Extracted ${ocrText.length} characters from ${filename}`
                    );

                    const performance = {
                        pages_per_second: 1 / extractionTime, // Image is treated as 1 "page"
                        characters_extracted: ocrText.length,
                        average_chars_per_page: ocrText.length,
                    };

                    // Log extraction performance
                    console.log(
                        `🖼️ OCR Extraction Performance: ${performance.pages_per_second.toFixed(
                            1
                        )} images/sec, ${
                            performance.characters_extracted
                        } chars`
                    );

                    return {
                        fullText: ocrText,
                        pageTexts: [ocrText], // Single "page" for an image
                        totalPages: 1,
                        extractionTime,
                        library: "mistral-ocr",
                        method: "ocr" as any, // Extending the type
                        performance,
                    };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    console.error(
                        `❌ OCR extraction failed for ${filename}:`,
                        errorMessage
                    );

                    // Try fallback extraction method or return empty result
                    console.log(
                        `🔄 Attempting fallback extraction for ${filename}...`
                    );

                    try {
                        // Fallback: Return minimal structure with error indication
                        const fallbackText = `[OCR extraction failed: ${errorMessage}. Image may be corrupted, unsupported format, or Mistral API unavailable.]`;

                        return {
                            fullText: fallbackText,
                            pageTexts: [fallbackText],
                            totalPages: 1,
                            extractionTime: (Date.now() - startTime) / 1000,
                            library: "mistral-ocr (fallback)",
                            method: "ocr" as any,
                            performance: {
                                pages_per_second: 0,
                                characters_extracted: fallbackText.length,
                                average_chars_per_page: fallbackText.length,
                            },
                        };
                    } catch (fallbackError) {
                        throw new Error(
                            `Failed to extract text from image file ${filename}: ${errorMessage}`
                        );
                    }
                }
            }
        );
    }

    /**
     * Call Mistral OCR API to extract text from image using the official SDK
     */
    private async callMistralOCR(
        dataUri: string,
        filename: string
    ): Promise<string> {
        try {
            if (!this.client) {
                throw new Error("Mistral client not initialized");
            }

            console.log(
                `🔍 Starting OCR processing for ${filename} using Mistral OCR...`
            );

            const ocrResponse = await this.client.ocr.process({
                model: this.MISTRAL_OCR_MODEL,
                document: {
                    type: "image_url",
                    imageUrl: dataUri,
                },
                includeImageBase64: false, // We don't need the image back
            });

            // Log the response structure to understand it better
            console.log(
                `📊 OCR Response structure:`,
                JSON.stringify(ocrResponse, null, 2)
            );

            // Extract text from the response - handle Mistral OCR pages structure
            let extractedText = "";
            const response = ocrResponse as any; // Cast to any to access unknown properties

            // Handle the standard Mistral OCR response structure with pages
            if (response.pages && Array.isArray(response.pages)) {
                extractedText = response.pages
                    .map((page: any) => page.markdown || "")
                    .join("\n\n")
                    .trim();
                console.log(
                    `✅ Extracted text from ${response.pages.length} page(s)`
                );
            }
            // Fallback to other possible response structures
            else if (response.text) {
                extractedText = response.text;
            } else if (response.content) {
                extractedText = response.content;
            } else if (response.result) {
                extractedText = response.result;
            } else if (response.data?.text) {
                extractedText = response.data.text;
            } else {
                console.warn(
                    `⚠️ Unexpected OCR response structure for ${filename}:`,
                    ocrResponse
                );
                return `[Unable to extract text from OCR response for image: ${filename}]`;
            }

            if (!extractedText || typeof extractedText !== "string") {
                console.warn(
                    `⚠️ No valid text extracted from image: ${filename}`
                );
                return `[No text content found in image: ${filename}]`;
            }

            const cleanedText = extractedText.trim();

            if (!cleanedText) {
                console.warn(`⚠️ Empty text extracted from image: ${filename}`);
                return `[No readable text content found in image: ${filename}]`;
            }

            console.log(
                `✅ OCR successful: extracted ${cleanedText.length} characters from ${filename}`
            );
            return cleanedText;
        } catch (error) {
            console.error("❌ Error calling Mistral OCR API:", error);

            // More specific error handling
            if (error instanceof Error) {
                if (
                    error.message.includes("401") ||
                    error.message.includes("unauthorized")
                ) {
                    throw new Error(
                        `Mistral API authentication failed. Please check your MISTRAL_API_KEY.`
                    );
                } else if (
                    error.message.includes("400") ||
                    error.message.includes("bad request")
                ) {
                    throw new Error(
                        `Invalid image format or request. Supported formats: PNG, JPG, JPEG.`
                    );
                } else if (
                    error.message.includes("429") ||
                    error.message.includes("rate limit")
                ) {
                    throw new Error(
                        `Mistral API rate limit exceeded. Please try again later.`
                    );
                }
            }

            throw error;
        }
    }

    /**
     * Detect image MIME type from buffer and filename
     */
    private detectImageMimeType(buffer: Buffer, filename: string): string {
        // Check file signatures (magic numbers)
        const header = buffer.subarray(0, 8);

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (
            header[0] === 0x89 &&
            header[1] === 0x50 &&
            header[2] === 0x4e &&
            header[3] === 0x47
        ) {
            return "image/png";
        }

        // JPEG: FF D8 FF
        if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
            return "image/jpeg";
        }

        // Fallback to filename extension
        const ext = filename.toLowerCase();
        if (ext.endsWith(".png")) return "image/png";
        if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) return "image/jpeg";

        // Default fallback
        return "image/jpeg";
    }
}
