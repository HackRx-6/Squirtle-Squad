import { extractText } from "unpdf";
import { sentryMonitoringService } from "../monitoring";
import { TextCleaningService } from "../cleaning";
import type { TextExtractionResult } from "./types";

export class TextExtractionService {
    async extractFromPDF(
        pdfBuffer: Buffer,
        filename: string
    ): Promise<TextExtractionResult> {
        return await sentryMonitoringService.track(
            "pdf_text_extraction",
            "extraction",
            {
                filename,
                file_size_bytes: pdfBuffer.length,
                file_size_mb: (pdfBuffer.length / 1024 / 1024).toFixed(2),
            },
            async () => {
                try {
                    console.log(`📄 Extracting text from PDF: ${filename}`);

                    const startTime = Date.now();
                    const uint8Array = new Uint8Array(pdfBuffer);
                    const result = await extractText(uint8Array);
                    const extractionTime = Date.now() - startTime;

                    const pageTexts = Array.isArray(result.text)
                        ? result.text
                        : [result.text];

                    const rawFullText = pageTexts.join("\n---\n");

                    if (!rawFullText) {
                        throw new Error("No text content extracted from PDF");
                    }

                    console.log(
                        `🧹 Applying enhanced cleaning with prompt injection protection...`
                    );

                    // Apply comprehensive sanitization for AI processing with prompt injection protection
                    const sanitizationResult =
                        TextCleaningService.sanitizeForAI(rawFullText, "pdf", {
                            maxRiskScore: 40,
                            enableStrictMode: false,
                        });

                    const fullText = sanitizationResult.sanitizedContent;

                    // Also sanitize individual page texts
                    const sanitizedPageTexts = pageTexts.map((pageText) =>
                        TextCleaningService.cleanText(pageText, {
                            enablePromptInjectionProtection: true,
                            strictSanitization: false,
                        })
                    );

                    // Log security report
                    if (
                        sanitizationResult.securityReport.initialRiskScore > 25
                    ) {
                        console.warn(`🚨 PDF security report:`, {
                            filename,
                            initialRisk:
                                sanitizationResult.securityReport
                                    .initialRiskScore,
                            finalRisk:
                                sanitizationResult.securityReport
                                    .finalRiskScore,
                            riskReduction: `${sanitizationResult.securityReport.riskReduction.toFixed(
                                1
                            )}%`,
                            isSafe: sanitizationResult.securityReport.isSafe,
                            appliedFilters:
                                sanitizationResult.securityReport
                                    .appliedFilters,
                        });
                    }

                    // Calculate performance metrics
                    const totalPages = pageTexts.length;
                    const totalChars = fullText.length;
                    const pagesPerSecond =
                        extractionTime > 0
                            ? (totalPages / extractionTime) * 1000
                            : 0;
                    const avgCharsPerPage =
                        totalPages > 0 ? totalChars / totalPages : 0;

                    // Log performance in the same format as PyMuPDF
                    console.log(
                        `📦 unpdf Performance: ${pagesPerSecond.toFixed(
                            1
                        )} pages/sec, ${totalChars} chars, avg ${avgCharsPerPage.toFixed(
                            1
                        )} chars/page`
                    );

                    console.log(
                        `✅ Extracted ${fullText.length} characters from ${filename} (${pageTexts.length} pages)`
                    );

                    return {
                        fullText,
                        pageTexts: sanitizedPageTexts,
                        totalPages: sanitizedPageTexts.length,
                    };
                } catch (error) {
                    console.error(
                        `❌ Error extracting text from PDF ${filename}:`,
                        error
                    );
                    throw new Error(
                        `Failed to extract text from PDF: ${
                            error instanceof Error
                                ? error.message
                                : "Unknown error"
                        }`
                    );
                }
            },
            {
                component: "pdf_processing",
                version: "1.0.0",
                provider: "unpdf",
            }
        );
    }
}
