import EmailReplyParser from "node-email-reply-parser";
import { sentryMonitoringService } from "../monitoring";
import { TextCleaningService } from "../cleaning";
import type { UnifiedExtractionResult } from "./index";

export class EmailExtractionService {
    async extractFromEmail(
        buffer: Buffer,
        filename: string
    ): Promise<UnifiedExtractionResult> {
        return await sentryMonitoringService.track(
            `Email extraction: ${filename}`,
            "extraction",
            { filename, bufferSize: buffer.length },
            async () => {
                const startTime = Date.now();

                try {
                    const emailContent = buffer.toString("utf-8");

                    // Fast regex-based header extraction
                    const headers = this.extractHeaders(emailContent);

                    // Use EmailReplyParser to extract clean body text
                    const parsedEmail = EmailReplyParser(emailContent);
                    const bodyText = parsedEmail.getVisibleText();

                    // Combine headers and body
                    const rawFullText = [
                        headers.from && `From: ${headers.from}`,
                        headers.to && `To: ${headers.to}`,
                        headers.subject && `Subject: ${headers.subject}`,
                        headers.date && `Date: ${headers.date}`,
                        "",
                        bodyText,
                    ]
                        .filter(Boolean)
                        .join("\n");

                    console.log(
                        `🧹 Applying enhanced cleaning with prompt injection protection...`
                    );

                    // Apply comprehensive sanitization for AI processing with prompt injection protection
                    const sanitizationResult =
                        TextCleaningService.sanitizeForAI(
                            rawFullText,
                            "email",
                            {
                                maxRiskScore: 40,
                                enableStrictMode: false,
                            }
                        );

                    const fullText = sanitizationResult.sanitizedContent;

                    // Log security report
                    if (
                        sanitizationResult.securityReport.initialRiskScore > 25
                    ) {
                        console.warn(`🚨 Email security report:`, {
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

                    const extractionTime = (Date.now() - startTime) / 1000;

                    const performance = {
                        pages_per_second: 1 / extractionTime, // Email is treated as 1 "page"
                        characters_extracted: fullText.length,
                        average_chars_per_page: fullText.length,
                    };

                    // Log extraction performance
                    console.log(
                        `📧 Email Extraction Performance: ${performance.pages_per_second.toFixed(
                            1
                        )} emails/sec, ${
                            performance.characters_extracted
                        } chars`
                    );

                    return {
                        fullText,
                        pageTexts: [fullText],
                        totalPages: 1,
                        extractionTime,
                        library: "email-reply-parser",
                        method: "email" as any, // Extending the type
                        performance,
                    };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    throw new Error(
                        `Failed to extract text from email file ${filename}: ${errorMessage}`
                    );
                }
            }
        );
    }

    private extractHeaders(content: string) {
        // Fast regex extraction - much faster than full email parsing
        const fromMatch = content.match(/^From:\s*(.+)$/m);
        const toMatch = content.match(/^To:\s*(.+)$/m);
        const subjectMatch = content.match(/^Subject:\s*(.+)$/m);
        const dateMatch = content.match(/^Date:\s*(.+)$/m);

        return {
            from: fromMatch?.[1]?.trim(),
            to: toMatch?.[1]?.trim(),
            subject: subjectMatch?.[1]?.trim(),
            date: dateMatch?.[1]?.trim(),
        };
    }
}
