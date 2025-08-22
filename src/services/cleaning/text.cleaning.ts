import { PromptInjectionProtectionService } from "./promptInjection.protection";

export class TextCleaningService {
    // Pre-compiled regex patterns for better performance
    private static readonly REGEX_PATTERNS = {
        tabs: /\t/g,
        doubleNewlines: /\n\n+/g,
        // singleNewlines: /\n/g,
        multipleWhitespace: /\s+/g,
        garbledSymbols: /[§¶†‡•◦▪▫‣⁃ïîíìñòóôõöøùúûüýÿ]/g,
        // emailSpacing: /([a-zA-Z0-9])\s*@\s*([a-zA-Z0-9])/g,
        punctuationSpacing: /\s+([,.!?;:])/g,
        punctuationAfter: /([,.!?;:])\s{2,}/g,
        colonSpacing: /\s*:\s*/g,
        dotLeaders: /\.{3,}/g,
        // Additional token-saving patterns
        extraSpacesAroundParens: /\s*\(\s*|\s*\)\s*/g,
        extraSpacesAroundBrackets: /\s*\[\s*|\s*\]\s*/g,
        multipleCommas: /,{2,}/g,
        multiplePeriods: /\.{2,}/g,
        hyphenation: /(\w)-\s*\n\s*(\w)/g,
        // Excel-specific patterns (basic cleaning only)
        excessiveTabs: /\t{3,}/g,
        excelErrors: /#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!)/gi,
    };

    /**
     * Clean a single text string with all optimizations and prompt injection protection
     * @param text - The input text string to clean
     * @param options - Configuration options for cleaning
     * @returns The cleaned and sanitized text string
     */
    public static cleanText(
        text: string,
        options: {
            enablePromptInjectionProtection?: boolean;
            strictSanitization?: boolean;
        } = {}
    ): string {
        if (!text || text.length === 0) {
            return text;
        }

        const {
            enablePromptInjectionProtection = PromptInjectionProtectionService.isEnabled(),
            strictSanitization = false,
        } = options;

        // Step 1: Apply prompt injection protection if enabled
        let cleanedText = text;
        if (enablePromptInjectionProtection) {
            const riskAssessment =
                PromptInjectionProtectionService.calculateRiskScore(text);

            // Log high-risk content
            if (
                riskAssessment.risk === "high" ||
                riskAssessment.risk === "critical"
            ) {
                console.warn(
                    `🚨 High-risk content detected (${riskAssessment.risk}):`,
                    {
                        score: riskAssessment.score,
                        patterns: riskAssessment.detectedPatterns,
                        keywords: riskAssessment.dangerousKeywords.slice(0, 5),
                    }
                );
            }

            cleanedText = PromptInjectionProtectionService.sanitizeText(text, {
                strictMode:
                    strictSanitization || riskAssessment.risk === "critical",
                preserveFormatting: true,
                logSuspiciousContent: riskAssessment.risk !== "low",
            });
        }

        // Step 2: Apply traditional text cleaning
        return (
            cleanedText
                // Fix hyphenation first (before removing newlines)
                .replace(this.REGEX_PATTERNS.hyphenation, "$1$2")
                // Remove Excel errors
                .replace(this.REGEX_PATTERNS.excelErrors, "[ERROR]")
                // Remove garbled symbols
                .replace(this.REGEX_PATTERNS.garbledSymbols, "")
                // Replace tabs with spaces
                .replace(this.REGEX_PATTERNS.tabs, " ")
                // Clean up excessive tabs (common in Excel)
                .replace(this.REGEX_PATTERNS.excessiveTabs, " ")
                // Replace multiple newlines with single newline
                .replace(this.REGEX_PATTERNS.doubleNewlines, "\n")
                // Replace single newlines with spaces
                // .replace(this.REGEX_PATTERNS.singleNewlines, " ")
                // Fix email spacing
                // .replace(this.REGEX_PATTERNS.emailSpacing, "$1@$2")
                // Fix punctuation spacing
                .replace(this.REGEX_PATTERNS.punctuationSpacing, "$1")
                .replace(this.REGEX_PATTERNS.punctuationAfter, "$1 ")
                // Normalize colons
                .replace(this.REGEX_PATTERNS.colonSpacing, ": ")
                // Remove dot leaders
                .replace(this.REGEX_PATTERNS.dotLeaders, " ")
                // Additional token optimizations
                // .replace(this.REGEX_PATTERNS.extraSpacesAroundParens, (match) =>
                //     match.includes("(") ? "(" : ")"
                // )
                // .replace(
                //     this.REGEX_PATTERNS.extraSpacesAroundBrackets,
                //     (match) => (match.includes("[") ? "[" : "]")
                // )
                .replace(this.REGEX_PATTERNS.multipleCommas, ",")
                .replace(this.REGEX_PATTERNS.multiplePeriods, ".")
                // Normalize all whitespace (final step - CRITICAL for token reduction)
                .replace(this.REGEX_PATTERNS.multipleWhitespace, " ")
                .trim()
        );
    }

    /**
     * Clean multiple text strings in parallel for better performance with prompt injection protection
     * @param texts - Array of text strings to clean
     * @param options - Configuration options for cleaning
     * @returns Array of cleaned text strings
     */
    public static cleanTexts(
        texts: string[],
        options: {
            enablePromptInjectionProtection?: boolean;
            strictSanitization?: boolean;
        } = {}
    ): string[] {
        // For small arrays, direct processing is faster than Promise.all overhead
        if (texts.length < 10) {
            return texts.map((text) => this.cleanText(text, options));
        }

        // For larger arrays, use chunked parallel processing
        const chunkSize = Math.ceil(texts.length / 4); // Process in 4 chunks
        const chunks: string[][] = [];

        for (let i = 0; i < texts.length; i += chunkSize) {
            chunks.push(texts.slice(i, i + chunkSize));
        }

        // Process chunks in parallel
        const results: string[] = [];
        chunks.forEach((chunk) => {
            results.push(...chunk.map((text) => this.cleanText(text, options)));
        });

        return results;
    }

    /**
     * Clean page texts from PDF extraction with enhanced security
     * @param pageTexts - Array of page text strings
     * @param options - Configuration options for cleaning
     * @returns Array of cleaned page text strings
     */
    public static cleanPageTexts(
        pageTexts: string[],
        options: {
            enablePromptInjectionProtection?: boolean;
            strictSanitization?: boolean;
        } = {}
    ): string[] {
        console.log(`🧹 Cleaning ${pageTexts.length} pages of text...`);

        const startTime = Date.now();
        const cleanedTexts = this.cleanTexts(pageTexts, options);
        const endTime = Date.now();

        console.log(`✅ Text cleaning completed in ${endTime - startTime}ms`);

        return cleanedTexts;
    }

    /**
     * Clean full document text with enhanced security
     * @param fullText - The complete document text
     * @param options - Configuration options for cleaning
     * @returns Cleaned full document text
     */
    public static cleanFullText(
        fullText: string,
        options: {
            enablePromptInjectionProtection?: boolean;
            strictSanitization?: boolean;
        } = {}
    ): string {
        console.log(
            `🧹 Cleaning full document text (${fullText.length} characters)...`
        );

        const startTime = Date.now();
        const cleanedText = this.cleanText(fullText, options);
        const endTime = Date.now();

        console.log(
            `✅ Full text cleaning completed in ${endTime - startTime}ms`
        );

        return cleanedText;
    }

    /**
     * Comprehensive document sanitization for AI processing
     * @param documentContent - Raw document content
     * @param documentType - Type of document (pdf, docx, email, etc.)
     * @param options - Configuration options
     * @returns Sanitized content with security report
     */
    public static sanitizeForAI(
        documentContent: string,
        documentType: string = "unknown",
        options: {
            maxRiskScore?: number;
            enableStrictMode?: boolean;
        } = {}
    ): {
        sanitizedContent: string;
        securityReport: {
            initialRiskScore: number;
            finalRiskScore: number;
            riskReduction: number;
            appliedFilters: string[];
            recommendations: string[];
            isSafe: boolean;
        };
    } {
        const { maxRiskScore = 50, enableStrictMode = false } = options;

        console.log(
            `🛡️ Sanitizing ${documentType} document for AI processing...`
        );
        const startTime = Date.now();

        // Step 1: Initial risk assessment
        const initialRisk =
            PromptInjectionProtectionService.calculateRiskScore(
                documentContent
            );

        // Step 2: Apply document-specific sanitization
        const sanitizationResult =
            PromptInjectionProtectionService.sanitizeDocumentContent(
                documentContent,
                documentType
            );

        // Step 3: Apply traditional text cleaning with appropriate security level
        const shouldUseStrictMode =
            enableStrictMode ||
            sanitizationResult.riskAssessment.risk === "critical" ||
            sanitizationResult.riskAssessment.score > maxRiskScore;

        const finalSanitizedContent = this.cleanText(
            sanitizationResult.sanitizedContent,
            {
                enablePromptInjectionProtection: false, // Already applied
                strictSanitization: shouldUseStrictMode,
            }
        );

        // Step 4: Final risk assessment
        const finalRisk = PromptInjectionProtectionService.calculateRiskScore(
            finalSanitizedContent
        );
        const safety = PromptInjectionProtectionService.validateTextSafety(
            finalSanitizedContent,
            maxRiskScore
        );

        const endTime = Date.now();
        const riskReduction =
            ((initialRisk.score - finalRisk.score) / initialRisk.score) * 100;

        console.log(
            `✅ Document sanitization completed in ${endTime - startTime}ms`,
            {
                initialRisk: initialRisk.risk,
                finalRisk: finalRisk.risk,
                riskReduction: `${riskReduction.toFixed(1)}%`,
                isSafe: safety.isSafe,
            }
        );

        return {
            sanitizedContent: finalSanitizedContent,
            securityReport: {
                initialRiskScore: initialRisk.score,
                finalRiskScore: finalRisk.score,
                riskReduction: riskReduction,
                appliedFilters: [
                    ...sanitizationResult.appliedFilters,
                    "traditional_cleaning",
                    ...(shouldUseStrictMode ? ["strict_mode"] : []),
                ],
                recommendations: safety.recommendations,
                isSafe: safety.isSafe,
            },
        };
    }

    /**
     * Get cleaning statistics for monitoring
     * @param originalText - Original text before cleaning
     * @param cleanedText - Text after cleaning
     * @returns Cleaning statistics
     */
    public static getCleaningStats(originalText: string, cleanedText: string) {
        const originalLength = originalText.length;
        const cleanedLength = cleanedText.length;
        const reductionPercent = (
            ((originalLength - cleanedLength) / originalLength) *
            100
        ).toFixed(1);

        return {
            originalLength,
            cleanedLength,
            charactersRemoved: originalLength - cleanedLength,
            reductionPercent: `${reductionPercent}%`,
        };
    }
}
