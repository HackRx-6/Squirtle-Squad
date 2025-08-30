import type { StructuredElementSelector } from "./elementFinder.playwright";

export interface SelectorValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Validates a structured element selector configuration
 * Provides helpful feedback for LLM-generated selectors
 */
export class StructuredSelectorValidator {
  /**
   * Validate a structured element selector
   */
  static validate(
    selector: StructuredElementSelector
  ): SelectorValidationResult {
    const result: SelectorValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
    };

    // Check required fields
    if (!selector.type || typeof selector.type !== "string") {
      result.errors.push(
        "Missing or invalid 'type' field - must be a string (e.g., 'button', 'input', 'link')"
      );
      result.isValid = false;
    }

    if (!selector.identifier || typeof selector.identifier !== "object") {
      result.errors.push(
        "Missing or invalid 'identifier' field - must be an object with at least one property"
      );
      result.isValid = false;
    }

    // Check identifier has at least one property
    const identifierKeys = selector.identifier
      ? Object.keys(selector.identifier)
      : [];
    if (identifierKeys.length === 0) {
      result.errors.push(
        "Identifier object is empty - must have at least one property (text, id, name, etc.)"
      );
      result.isValid = false;
    }

    // Validate identifier properties
    if (selector.identifier) {
      this.validateIdentifierProperties(selector.identifier, result);
    }

    // Validate fallbacks
    if (selector.fallbacks) {
      this.validateFallbacks(selector.fallbacks, result);
    }

    // Validate context
    if (selector.context) {
      this.validateContext(selector.context, result);
    }

    // Validate options
    if (selector.options) {
      this.validateOptions(selector.options, result);
    }

    // Provide suggestions
    this.addSuggestions(selector, result);

    return result;
  }

  private static validateIdentifierProperties(
    identifier: any,
    result: SelectorValidationResult
  ) {
    // Check for common mistakes
    if (identifier.text && identifier.textContains) {
      result.warnings.push(
        "Both 'text' and 'textContains' specified - 'text' will take precedence"
      );
    }

    if (identifier.className && identifier.classContains) {
      result.warnings.push(
        "Both 'className' and 'classContains' specified - 'className' will take precedence"
      );
    }

    // Validate specific properties
    if (identifier.attributes && typeof identifier.attributes !== "object") {
      result.errors.push("'attributes' must be an object with key-value pairs");
      result.isValid = false;
    }

    // Check for empty strings
    const stringProps = [
      "text",
      "textContains",
      "id",
      "name",
      "placeholder",
      "ariaLabel",
      "testId",
      "className",
      "classContains",
      "role",
      "href",
      "alt",
    ];
    stringProps.forEach((prop) => {
      if (
        identifier[prop] !== undefined &&
        (typeof identifier[prop] !== "string" || identifier[prop].trim() === "")
      ) {
        result.errors.push(`'${prop}' must be a non-empty string`);
        result.isValid = false;
      }
    });
  }

  private static validateFallbacks(
    fallbacks: any[],
    result: SelectorValidationResult
  ) {
    if (!Array.isArray(fallbacks)) {
      result.errors.push("'fallbacks' must be an array");
      result.isValid = false;
      return;
    }

    if (fallbacks.length === 0) {
      result.warnings.push(
        "Empty fallbacks array - consider adding fallback strategies for better reliability"
      );
    }

    fallbacks.forEach((fallback, index) => {
      if (!fallback || typeof fallback !== "object") {
        result.errors.push(`Fallback ${index + 1} must be an object`);
        result.isValid = false;
        return;
      }

      const fallbackKeys = Object.keys(fallback);
      if (fallbackKeys.length === 0) {
        result.warnings.push(
          `Fallback ${index + 1} is empty - should have at least one property`
        );
      }
    });
  }

  private static validateContext(
    context: any,
    result: SelectorValidationResult
  ) {
    if (typeof context !== "object") {
      result.errors.push("'context' must be an object");
      result.isValid = false;
      return;
    }

    if (
      context.index !== undefined &&
      (typeof context.index !== "number" || context.index < 0)
    ) {
      result.errors.push("'context.index' must be a non-negative number");
      result.isValid = false;
    }

    const validPositions = ["header", "footer", "sidebar", "main"];
    if (context.position && !validPositions.includes(context.position)) {
      result.warnings.push(
        `'context.position' should be one of: ${validPositions.join(", ")}`
      );
    }
  }

  private static validateOptions(
    options: any,
    result: SelectorValidationResult
  ) {
    if (typeof options !== "object") {
      result.errors.push("'options' must be an object");
      result.isValid = false;
      return;
    }

    if (
      options.timeout !== undefined &&
      (typeof options.timeout !== "number" || options.timeout <= 0)
    ) {
      result.errors.push("'options.timeout' must be a positive number");
      result.isValid = false;
    }

    const booleanProps = ["visible", "enabled", "exact", "caseSensitive"];
    booleanProps.forEach((prop) => {
      if (options[prop] !== undefined && typeof options[prop] !== "boolean") {
        result.errors.push(`'options.${prop}' must be a boolean`);
        result.isValid = false;
      }
    });
  }

  private static addSuggestions(
    selector: StructuredElementSelector,
    result: SelectorValidationResult
  ) {
    // Suggest testId if not present
    if (!selector.identifier.testId && !selector.identifier.id) {
      result.suggestions.push(
        "Consider using 'testId' or 'id' for more reliable element selection"
      );
    }

    // Suggest fallbacks if not present
    if (!selector.fallbacks || selector.fallbacks.length === 0) {
      result.suggestions.push(
        "Consider adding fallback strategies for better reliability"
      );
    }

    // Suggest context for common ambiguous elements
    const ambiguousTypes = ["button", "input", "div", "span"];
    if (ambiguousTypes.includes(selector.type) && !selector.context) {
      result.suggestions.push(
        "Consider adding context (parent, position) for more precise targeting of common elements"
      );
    }

    // Suggest improvements based on element type
    if (
      selector.type === "input" &&
      !selector.identifier.name &&
      !selector.identifier.placeholder
    ) {
      result.suggestions.push(
        "For input elements, consider using 'name' or 'placeholder' attributes"
      );
    }

    if (
      selector.type === "button" &&
      !selector.identifier.text &&
      !selector.identifier.textContains
    ) {
      result.suggestions.push(
        "For button elements, consider using 'text' or 'textContains' for text-based selection"
      );
    }

    if (
      selector.type === "link" &&
      !selector.identifier.text &&
      !selector.identifier.href
    ) {
      result.suggestions.push(
        "For link elements, consider using 'text' or 'href' attributes"
      );
    }
  }

  /**
   * Get a human-readable validation report
   */
  static getValidationReport(selector: StructuredElementSelector): string {
    const validation = this.validate(selector);

    let report = `Structured Element Selector Validation:\n`;
    report += `Status: ${validation.isValid ? "✅ Valid" : "❌ Invalid"}\n\n`;

    if (validation.errors.length > 0) {
      report += `Errors (${validation.errors.length}):\n`;
      validation.errors.forEach((error, i) => {
        report += `  ${i + 1}. ❌ ${error}\n`;
      });
      report += "\n";
    }

    if (validation.warnings.length > 0) {
      report += `Warnings (${validation.warnings.length}):\n`;
      validation.warnings.forEach((warning, i) => {
        report += `  ${i + 1}. ⚠️  ${warning}\n`;
      });
      report += "\n";
    }

    if (validation.suggestions.length > 0) {
      report += `Suggestions (${validation.suggestions.length}):\n`;
      validation.suggestions.forEach((suggestion, i) => {
        report += `  ${i + 1}. 💡 ${suggestion}\n`;
      });
    }

    return report;
  }

  /**
   * Quick validation check for LLMs
   */
  static isValidSelector(selector: any): boolean {
    try {
      const validation = this.validate(selector);
      return validation.isValid;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Helper function to create a basic structured selector
 */
export function createStructuredSelector(
  type: string,
  identifier: Record<string, any>,
  options?: {
    fallbacks?: Array<Record<string, any>>;
    context?: Record<string, any>;
    selectorOptions?: Record<string, any>;
  }
): StructuredElementSelector {
  const selector: StructuredElementSelector = {
    type,
    identifier,
  };

  if (options?.fallbacks) {
    selector.fallbacks = options.fallbacks;
  }

  if (options?.context) {
    selector.context = options.context;
  }

  if (options?.selectorOptions) {
    selector.options = options.selectorOptions;
  }

  return selector;
}

/**
 * Common selector templates for quick generation
 */
export const SelectorTemplates = {
  button: (text: string) =>
    createStructuredSelector(
      "button",
      { text },
      {
        fallbacks: [{ textContains: text }, { role: "button" }],
      }
    ),

  submitButton: () =>
    createStructuredSelector(
      "button",
      { attributes: { type: "submit" } },
      {
        fallbacks: [{ text: "Submit" }, { textContains: "Submit" }],
      }
    ),

  inputByName: (name: string) =>
    createStructuredSelector(
      "input",
      { name },
      {
        fallbacks: [{ placeholder: name }, { ariaLabel: name }],
      }
    ),

  inputByPlaceholder: (placeholder: string) =>
    createStructuredSelector(
      "input",
      { placeholder },
      {
        fallbacks: [
          { name: placeholder.toLowerCase() },
          { ariaLabel: placeholder },
        ],
      }
    ),

  linkByText: (text: string) =>
    createStructuredSelector(
      "link",
      { text },
      {
        fallbacks: [
          { textContains: text },
          { href: text.toLowerCase().replace(" ", "-") },
        ],
      }
    ),

  elementById: (id: string, type: string = "any") =>
    createStructuredSelector(type, { id }),

  elementByTestId: (testId: string, type: string = "any") =>
    createStructuredSelector(type, { testId }),
};
