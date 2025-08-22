/**
 * Prompt Injection Protection Service
 *
 * This service provides comprehensive protection against prompt injection attacks
 * in document processing systems. It sanitizes both user inputs and document
 * content to prevent malicious instructions from compromising the AI system.
 */

import { AppConfigService } from "../../config/app.config";

export class PromptInjectionProtectionService {
  private static appConfig = AppConfigService.getInstance();

  /**
   * Check if prompt injection protection is enabled
   */
  public static isEnabled(): boolean {
    return this.appConfig.getSecurityConfig().promptInjectionProtection.enabled;
  }

  /**
   * Get the current security configuration
   */
  public static getConfig() {
    return this.appConfig.getSecurityConfig().promptInjectionProtection;
  }
  // Azure-specific patterns that trigger content management policy
  private static readonly AZURE_CONTENT_POLICY_PATTERNS = {
    // Microsoft-specific triggers
    microsoftTerms:
      /(?:microsoft|azure|openai|copilot|cortana|bing|office|windows|teams)\s+(?:policy|guideline|rule|instruction|directive|system|admin|security|breach|vulnerability|compromise)/gi,

    // Content policy triggers
    contentPolicy:
      /(?:content\s+policy|content\s+management|safety\s+filter|content\s+filter|responsible\s+ai|harmful\s+content|inappropriate\s+content)/gi,

    // System compromise language
    systemCompromise:
      /(?:system\s+(?:compromised|infected|hacked|breached|vulnerable)|critical\s+(?:vulnerability|security|alert|emergency))/gi,

    // PII-related triggers that Azure flags
    piiTriggers:
      /(?:personally\s+identifiable|pii|personal\s+data|sensitive\s+(?:information|data)|confidential\s+(?:information|data)|private\s+(?:information|data))/gi,

    // Administrative override attempts
    adminOverride:
      /(?:administrator|admin|root|sudo|superuser)\s+(?:access|privilege|permission|override|bypass|disable|enable)/gi,

    // Prompt engineering terms that Azure flags
    promptEngineering:
      /(?:prompt\s+(?:injection|engineering|attack|manipulation)|jailbreak|dan\s+mode|ignore\s+(?:previous|all|system)|forget\s+(?:previous|all|system))/gi,

    // Security-related terms that are too aggressive
    securityTerms:
      /(?:exploit|vulnerability|backdoor|trojan|malware|virus|ransomware|phishing|social\s+engineering)/gi,

    // Authority manipulation that Azure flags
    authorityFraud:
      /(?:ceo|president|manager|director|administrator)\s+(?:says|told|commands|orders|instructs|demands|requires)/gi,
  };

  // Common prompt injection patterns
  private static readonly INJECTION_PATTERNS = {
    // Direct instruction attempts
    systemOverride:
      /(?:system|assistant|user)?\s*(?:message|prompt|instruction|directive|command|rule)s?\s*[:=]\s*[^.]*(?:ignore|forget|override|replace|disregard|bypass|disable|stop|halt|cancel|terminate)/gi,

    // Role manipulation attempts
    roleChange:
      /(?:now\s+)?(?:you\s+are|act\s+as|pretend\s+to\s+be|role\s*[:=]|assume\s+the\s+role)\s+(?:a\s+)?(?:helpful|different|new|malicious|hacker|admin|system|root|sudo)/gi,

    // System instruction overrides
    systemReset:
      /(?:reset|clear|delete|remove|forget|ignore|override|bypass|disable)\s+(?:all\s+)?(?:previous|prior|above|earlier|system|instruction|directive|rule|protocol|guideline|safety|security)/gi,

    // Emergency/urgent manipulation
    urgentManipulation:
      /(?:urgent|critical|emergency|immediate|security\s+alert|system\s+compromised|attack|breach|malware|virus|vulnerability)/gi,

    // Authority manipulation
    authorityManipulation:
      /(?:administrator|admin|developer|engineer|manager|boss|ceo|owner|creator|god|root|sudo)\s+(?:says|told|commands|instructs|requires|demands)/gi,

    // Data extraction attempts
    dataExtraction:
      /(?:show|display|reveal|expose|output|print|return|give|provide)\s+(?:all\s+)?(?:data|information|content|secrets|keys|passwords|tokens|credentials|pii|personal)/gi,

    // Jailbreak attempts
    jailbreak:
      /(?:jailbreak|dan|do\s+anything\s+now|evil|malicious|harmful|dangerous|illegal|unethical)/gi,

    // Code injection attempts
    codeInjection:
      /(?:execute|run|eval|script|code|function|method|class|import|require|include|load)\s*\(|\$\{|\{\{|\%\{|<script|javascript:|vbscript:|data:/gi,

    // Unicode/encoding manipulation
    encodingManipulation:
      /(?:\\u[0-9a-f]{4}|\\x[0-9a-f]{2}|&\#[0-9]+;|%[0-9a-f]{2}){3,}/gi,

    // Delimiter confusion
    delimiterConfusion:
      /(?:```|---|===|\*\*\*|###|\|\|\||<\|>|END\s+OF\s+(?:INSTRUCTION|PROMPT|MESSAGE|DOCUMENT))/gi,

    // Token manipulation
    tokenManipulation:
      /(?:token|embedding|vector|weight|parameter|model|neural|network|training|fine-tune|prompt\s+engineering)/gi,

    // Compliance bypassing
    complianceBypass:
      /(?:but|however|nevertheless|actually|really|truly|honestly|secretly|confidentially|between\s+us|off\s+the\s+record)\s+(?:ignore|bypass|skip|forget|disregard)/gi,

    // Human intervention restrictions - more targeted to preserve legitimate automation
    humanInterventionRestriction:
      /(?:THIS\s+ENTIRE\s+CHALLENGE\s+TO\s+BE\s+DONE\s+BY\s+LLM\s+ONLY\.\s*)?NO\s+HUMAN\s+INTERVENTION\s+(?:ALLOWED|PERMITTED|REQUIRED)(?:\.\s*THIS\s+INCLUDES[^.]*\.)?/gi,
  };

  // Dangerous keywords that should trigger additional scrutiny
  private static readonly DANGER_KEYWORDS = [
    "system",
    "instruction",
    "prompt",
    "directive",
    "command",
    "override",
    "ignore",
    "forget",
    "disregard",
    "bypass",
    "jailbreak",
    "malicious",
    "admin",
    "root",
    "sudo",
    // "execute", // Removed - needed for legitimate code execution
    // "eval", // Removed - but kept eval() pattern in SAFE_REPLACEMENTS
    // "script", // Removed - needed for legitimate script operations
    "urgent",
    "critical",
    "emergency",
    "compromise",
    "vulnerability",
    "breach",
    "password",
    "token",
    "key",
    "credential",
    "secret",
    "pii",
    "personal",
    "confidential",
    // "intervention", // Removed - only target specific "NO HUMAN INTERVENTION" phrase
    // "autonomous", // Removed - only target specific dangerous autonomous contexts
    // "automated", // Removed - needed for legitimate automation descriptions
  ];

  // Safe replacements for potentially dangerous content
  private static readonly SAFE_REPLACEMENTS = {
    "[REDACTED_INSTRUCTION]":
      /(?:system|user|assistant)\s*(?:message|prompt|instruction)s?\s*[:=]/gi,
    "[REDACTED_OVERRIDE]":
      /(?:ignore|forget|override|disregard|bypass)\s+(?:previous|all|system)/gi,
    "[REDACTED_ROLE]":
      /(?:you\s+are|act\s+as|role\s*[:=])\s+(?:a\s+)?(?:different|new|malicious|hacker)/gi,
    "[REDACTED_URGENT]":
      /(?:urgent|critical|emergency)\s*[:!]\s*(?:system\s+)?(?:compromised|attack|breach)/gi,
    "[REDACTED_AUTHORITY]":
      /(?:administrator|admin|developer)\s+(?:says|commands|requires)/gi,
    "[REDACTED_CODE]": /(?:execute|eval|script)\s*\(.*?\)/gi,
    // More targeted replacement - only specific "NO HUMAN INTERVENTION ALLOWED" phrase
    "": /THIS\s+ENTIRE\s+CHALLENGE\s+TO\s+BE\s+DONE\s+BY\s+LLM\s+ONLY\.\s*NO\s+HUMAN\s+INTERVENTION\s+ALLOWED\./gi,
    "Please complete this task automatically":
      /NO\s+HUMAN\s+INTERVENTION\s+(?:ALLOWED|PERMITTED|REQUIRED)/gi,
  };

  /**
   * Main method to sanitize text against prompt injection attacks
   * @param text - The input text to sanitize
   * @param options - Configuration options for sanitization
   * @returns Sanitized text with potential injections neutralized
   */
  public static sanitizeText(
    text: string,
    options: {
      strictMode?: boolean;
      preserveFormatting?: boolean;
      logSuspiciousContent?: boolean;
      azureContentPolicy?: boolean;
      preserveUrls?: boolean;
      skipDocumentWrapping?: boolean;
    } = {}
  ): string {
    // Check if protection is enabled
    if (!this.isEnabled()) {
      console.log("🔓 Prompt injection protection is disabled via config");
      return text;
    }

    if (!text || text.length === 0) {
      return text;
    }

    const config = this.getConfig();
    const {
      strictMode = config.strictMode,
      preserveFormatting = true,
      logSuspiciousContent = config.logSuspiciousContent,
      azureContentPolicy = config.azureContentPolicy,
      preserveUrls = config.preserveUrls,
      skipDocumentWrapping = false,
    } = options;

    let sanitizedText = text;
    let detectedInjections: string[] = [];
    const urlPlaceholders = new Map<string, string>();

    // Step 0: Preserve URLs if requested - COMPREHENSIVE URL PROTECTION
    if (preserveUrls) {
      // Multiple URL patterns to catch all possible URL formats
      const urlPatterns = [
        /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi, // Standard HTTP/HTTPS URLs
        /www\.[^\s<>"{}|\\^`[\]]+/gi, // www URLs without protocol
        /[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}[^\s<>"{}|\\^`[\]]*/gi, // Domain URLs with paths
        /[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s<>"{}|\\^`[\]]*/gi, // Subdomain URLs
        // Special pattern for hackrx and similar domains
        /(?:register|api|www|app|dev|staging|prod|test)?\.?hackrx\.[a-zA-Z]{2,}[^\s<>"{}|\\^`[\]]*/gi,
        /[a-zA-Z0-9-]+\.(?:com|org|net|io|in|co|app|dev|xyz|me|info)[^\s<>"{}|\\^`[\]]*/gi, // Common TLD patterns
      ];

      let urlIndex = 0;
      urlPatterns.forEach((pattern) => {
        const urls = sanitizedText.match(pattern) || [];
        urls.forEach((url) => {
          const placeholder = `__URL_PLACEHOLDER_${urlIndex}__`;
          urlPlaceholders.set(placeholder, url);
          // Use global replace to catch all instances of this URL
          sanitizedText = sanitizedText.replaceAll(url, placeholder);
          urlIndex++;
        });
      });

      if (urlPlaceholders.size > 0) {
        console.log(
          `🔗 Preserved ${urlPlaceholders.size} URLs during sanitization:`,
          Array.from(urlPlaceholders.values()).slice(0, 3)
        );
      }
    }

    // Step 0: Apply Azure-specific sanitization if enabled
    if (azureContentPolicy) {
      for (const [patternName, pattern] of Object.entries(
        this.AZURE_CONTENT_POLICY_PATTERNS
      )) {
        const matches = sanitizedText.match(pattern);
        if (matches) {
          detectedInjections.push(...matches);
          // Be more aggressive with Azure policy violations
          sanitizedText = sanitizedText.replace(
            pattern,
            "[CONTENT_FILTERED_FOR_POLICY]"
          );
        }
      }
    }

    // Step 1: Apply safe replacements for known dangerous patterns
    for (const [replacement, pattern] of Object.entries(
      this.SAFE_REPLACEMENTS
    )) {
      const matches = sanitizedText.match(pattern);
      if (matches) {
        detectedInjections.push(...matches);
        sanitizedText = sanitizedText.replace(pattern, replacement);
      }
    }

    // Step 2: Detect and neutralize injection patterns
    for (const [patternName, pattern] of Object.entries(
      this.INJECTION_PATTERNS
    )) {
      const matches = sanitizedText.match(pattern);
      if (matches) {
        detectedInjections.push(...matches);

        if (strictMode) {
          // In strict mode, completely remove suspicious content
          sanitizedText = sanitizedText.replace(pattern, "[CONTENT_FILTERED]");
        } else {
          // In normal mode, neutralize by adding context
          sanitizedText = sanitizedText.replace(pattern, (match) => {
            return `[DOCUMENT_CONTENT: ${match}]`;
          });
        }
      }
    }

    // Step 3: Apply additional safety measures
    sanitizedText = this.applySafetyMeasures(
      sanitizedText,
      strictMode,
      skipDocumentWrapping
    );

    // Step 4: Log suspicious activity if enabled
    if (logSuspiciousContent && detectedInjections.length > 0) {
      console.warn("🚨 Potential prompt injection detected and neutralized:", {
        detectionsCount: detectedInjections.length,
        detections: detectedInjections.slice(0, 5), // Log first 5 detections
        textPreview: text.substring(0, 200) + "...",
        azurePolicyEnabled: azureContentPolicy,
      });
    }

    // Step 5: Additional Azure-specific logging
    if (azureContentPolicy && detectedInjections.length > 0) {
      console.warn("🔒 Azure content policy sanitization applied:", {
        originalLength: text.length,
        sanitizedLength: sanitizedText.length,
        reductionPercent:
          (((text.length - sanitizedText.length) / text.length) * 100).toFixed(
            1
          ) + "%",
      });
    }

    // Step 6: Restore URLs if they were preserved
    if (preserveUrls && urlPlaceholders.size > 0) {
      for (const [placeholder, originalUrl] of urlPlaceholders.entries()) {
        sanitizedText = sanitizedText.replace(placeholder, originalUrl);
      }
      console.log(
        `🔗 Restored ${urlPlaceholders.size} URLs after sanitization`
      );
    }

    return preserveFormatting
      ? sanitizedText
      : this.normalizeWhitespace(sanitizedText);
  }

  /**
   * Apply additional safety measures to the text
   * @param text - Text to apply safety measures to
   * @param strictMode - Whether to apply strict filtering
   * @param skipDocumentWrapping - Whether to skip document content wrapping (for terminal commands)
   * @returns Text with additional safety measures applied
   */
  private static applySafetyMeasures(
    text: string,
    strictMode: boolean,
    skipDocumentWrapping: boolean = false
  ): string {
    let safeBoundedText = text;

    // Add document context markers to clearly separate content from instructions
    // Skip this for terminal commands to avoid breaking execution
    if (!skipDocumentWrapping) {
      safeBoundedText = `--- DOCUMENT CONTENT START ---\n${safeBoundedText}\n--- DOCUMENT CONTENT END ---`;
    }

    // Escape common injection delimiters
    if (strictMode) {
      safeBoundedText = safeBoundedText
        .replace(/```/g, "`‵`") // Replace triple backticks
        .replace(/---(?=\s)/g, "‒‒‒") // Replace triple dashes
        .replace(/===(?=\s)/g, "=‖=") // Replace triple equals
        .replace(/<\|>/g, "⟨|⟩") // Replace special delimiters
        .replace(/\{\{/g, "⦃⦃") // Replace double braces
        .replace(/\}\}/g, "⦄⦄");
    }

    // Neutralize potential role indicators
    safeBoundedText = safeBoundedText
      .replace(/^(System|User|Assistant|Human|AI):/gim, "Document mentions $1:")
      .replace(
        /^(###|##|#)\s*(System|User|Assistant|Human|AI)/gim,
        "$1 Document section about $2"
      );

    return safeBoundedText;
  }

  /**
   * Normalize whitespace in text
   * @param text - Text to normalize
   * @returns Text with normalized whitespace
   */
  private static normalizeWhitespace(text: string): string {
    return text
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();
  }

  /**
   * Calculate risk score for text content
   * @param text - Text to analyze
   * @returns Risk score (0-100) and detected patterns
   */
  public static calculateRiskScore(text: string): {
    score: number;
    risk: "low" | "medium" | "high" | "critical";
    detectedPatterns: string[];
    dangerousKeywords: string[];
  } {
    let score = 0;
    const detectedPatterns: string[] = [];
    const dangerousKeywords: string[] = [];

    // Check for injection patterns
    for (const [patternName, pattern] of Object.entries(
      this.INJECTION_PATTERNS
    )) {
      const matches = text.match(pattern);
      if (matches) {
        detectedPatterns.push(patternName);
        score += matches.length * 15; // 15 points per pattern match
      }
    }

    // Check for Azure-specific content policy violations (higher severity)
    for (const [patternName, pattern] of Object.entries(
      this.AZURE_CONTENT_POLICY_PATTERNS
    )) {
      const matches = text.match(pattern);
      if (matches) {
        detectedPatterns.push(`azure_${patternName}`);
        score += matches.length * 25; // 25 points per Azure policy violation (higher than normal)
      }
    }

    // Check for dangerous keywords (but exclude them if they're part of legitimate URLs)
    const lowercaseText = text.toLowerCase();

    // First, identify all URLs in the text to exclude them from keyword scanning
    const urlExclusions = new Set<string>();
    const urlPatterns = [
      /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi,
      /www\.[^\s<>"{}|\\^`[\]]+/gi,
      /[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}[^\s<>"{}|\\^`[\]]*/gi,
      /[a-zA-Z0-9-]+\.(?:com|org|net|io|in|co|app|dev|xyz|me|info)[^\s<>"{}|\\^`[\]]*/gi,
    ];

    urlPatterns.forEach((pattern) => {
      const urls = text.match(pattern) || [];
      urls.forEach((url) => urlExclusions.add(url.toLowerCase()));
    });

    for (const keyword of this.DANGER_KEYWORDS) {
      // Check if keyword appears in text
      if (lowercaseText.includes(keyword)) {
        // But exclude if it's part of a URL
        let isPartOfUrl = false;
        for (const url of urlExclusions) {
          if (url.includes(keyword)) {
            isPartOfUrl = true;
            break;
          }
        }

        if (!isPartOfUrl) {
          dangerousKeywords.push(keyword);
          score += 5; // 5 points per dangerous keyword
        }
      }
    }

    // Additional risk factors
    if (text.length > 10000) score += 10; // Very long text
    if (text.includes("\\u") || text.includes("\\x")) score += 20; // Unicode escapes
    const nonAsciiMatches = text.match(/[^\x00-\x7F]/g);
    if (nonAsciiMatches && nonAsciiMatches.length > text.length * 0.1)
      score += 15; // High non-ASCII ratio

    // Determine risk level
    let risk: "low" | "medium" | "high" | "critical";
    if (score >= 75) risk = "critical";
    else if (score >= 50) risk = "high";
    else if (score >= 25) risk = "medium";
    else risk = "low";

    return {
      score: Math.min(score, 100),
      risk,
      detectedPatterns,
      dangerousKeywords,
    };
  }

  /**
   * Validate if text is safe for processing
   * @param text - Text to validate
   * @param maxRiskScore - Maximum acceptable risk score (default: 50)
   * @returns Whether text is safe and any recommendations
   */
  public static validateTextSafety(
    text: string,
    maxRiskScore: number = 50
  ): {
    isSafe: boolean;
    riskAssessment: {
      score: number;
      risk: "low" | "medium" | "high" | "critical";
      detectedPatterns: string[];
      dangerousKeywords: string[];
    };
    recommendations: string[];
  } {
    const riskAssessment = this.calculateRiskScore(text);
    const isSafe = riskAssessment.score <= maxRiskScore;

    const recommendations: string[] = [];

    if (!isSafe) {
      recommendations.push("Apply strict sanitization before processing");
      if (riskAssessment.detectedPatterns.length > 0) {
        recommendations.push(
          "Multiple injection patterns detected - consider manual review"
        );
      }
      if (riskAssessment.dangerousKeywords.length > 5) {
        recommendations.push(
          "High density of dangerous keywords - implement additional filtering"
        );
      }
      if (riskAssessment.score >= 75) {
        recommendations.push(
          "Critical risk detected - consider blocking this content entirely"
        );
      }
    }

    return {
      isSafe,
      riskAssessment,
      recommendations,
    };
  }

  /**
   * Enhanced sanitization specifically for document processing
   * @param documentContent - Content extracted from documents
   * @param documentType - Type of document (pdf, docx, txt, etc.)
   * @returns Sanitized content safe for AI processing
   */
  public static sanitizeDocumentContent(
    documentContent: string,
    documentType: string = "unknown"
  ): {
    sanitizedContent: string;
    riskAssessment: {
      score: number;
      risk: "low" | "medium" | "high" | "critical";
      detectedPatterns: string[];
      dangerousKeywords: string[];
    };
    appliedFilters: string[];
  } {
    const appliedFilters: string[] = [];

    // Step 1: Initial risk assessment
    const initialRisk = this.calculateRiskScore(documentContent);

    // Step 2: Apply appropriate sanitization based on risk level
    let sanitizedContent: string;

    if (initialRisk.risk === "critical") {
      sanitizedContent = this.sanitizeText(documentContent, {
        strictMode: true,
        preserveFormatting: false,
        logSuspiciousContent: true,
        preserveUrls: true,
      });
      appliedFilters.push(
        "strict_mode",
        "format_normalization",
        "pattern_replacement"
      );
    } else if (initialRisk.risk === "high") {
      sanitizedContent = this.sanitizeText(documentContent, {
        strictMode: false,
        preserveFormatting: true,
        logSuspiciousContent: true,
        preserveUrls: true,
      });
      appliedFilters.push("standard_sanitization", "pattern_neutralization");
    } else {
      sanitizedContent = this.sanitizeText(documentContent, {
        strictMode: false,
        preserveFormatting: true,
        logSuspiciousContent: false,
        preserveUrls: true,
      });
      appliedFilters.push("basic_sanitization");
    }

    // Step 3: Document-type specific processing
    if (documentType === "email") {
      sanitizedContent = this.sanitizeEmailContent(sanitizedContent);
      appliedFilters.push("email_sanitization");
    }

    // Step 4: Final risk assessment
    const finalRisk = this.calculateRiskScore(sanitizedContent);

    return {
      sanitizedContent,
      riskAssessment: finalRisk,
      appliedFilters,
    };
  }

  /**
   * Email-specific sanitization
   * @param emailContent - Email content to sanitize
   * @returns Sanitized email content
   */
  private static sanitizeEmailContent(emailContent: string): string {
    return emailContent
      .replace(/^(From|To|Subject|Date):\s*/gim, "Email $1: ")
      .replace(/^-{2,}\s*Original Message\s*-{2,}/gim, "[Original Message]")
      .replace(/^-{2,}\s*Forwarded Message\s*-{2,}/gim, "[Forwarded Message]");
  }
}
