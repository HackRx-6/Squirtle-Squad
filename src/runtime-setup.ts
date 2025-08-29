/**
 * Runtime setup and polyfills for production environment
 * This handles differences between Bun and Node.js runtime environments
 */

// Polyfill global objects that might be missing in different runtimes
const globalAny = globalThis as any;

// Only apply polyfills if we're in a bundled environment (production)
const isBundled =
  process.env.NODE_ENV === "production" || process.env.DOCKER_ENV === "true";

if (isBundled) {
  if (typeof globalAny.DOMMatrix === "undefined") {
    // Simple DOMMatrix polyfill for environments that don't have it
    globalAny.DOMMatrix = class DOMMatrix {
      constructor() {
        // Silent polyfill to avoid console spam
      }
    };
  }

  if (typeof globalAny.ImageData === "undefined") {
    globalAny.ImageData = class ImageData {
      constructor() {
        // Silent polyfill to avoid console spam
      }
    };
  }

  if (typeof globalAny.Path2D === "undefined") {
    globalAny.Path2D = class Path2D {
      constructor() {
        // Silent polyfill to avoid console spam
      }
    };
  }

  // Ensure process object exists with required methods
  if (
    typeof process !== "undefined" &&
    typeof (process as any).getBuiltinModule === "undefined"
  ) {
    // Add a fallback for getBuiltinModule if it doesn't exist
    (process as any).getBuiltinModule = function (name: string) {
      try {
        return require(name);
      } catch (e) {
        // Silent fallback to avoid console spam
        return null;
      }
    };
  }

  console.log("✅ Runtime polyfills applied for production environment");
} else {
  console.log("ℹ️ Development environment - skipping runtime polyfills");
}
