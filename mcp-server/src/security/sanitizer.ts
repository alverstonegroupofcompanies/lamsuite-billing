/**
 * Sanitizer for Prompt-Injection Defense.
 * Treats all data from store databases (item names, customer notes, remarks, etc.)
 * as untrusted literal text, defanging instruction patterns and enclosing them in data boundaries.
 */

// Patterns commonly used in prompt injection attempts
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /system\s*:\s*/gi,
  /instruction\s*:\s*/gi,
  /assistant\s*:\s*/gi,
  /human\s*:\s*/gi,
  /tool_call\s*:\s*/gi,
  /new\s+role\s*:\s*/gi,
  /override\s+instructions?/gi,
  /bypass\s+safety\s+filter/gi,
  /call\s+(the\s+)?tool/gi,
  /execute\s+command/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /```(json|bash|sh|javascript|typescript|python)?/gi,
];

/**
 * Defangs a string by neutralizing prompt injection attempts and escaping control tokens.
 */
export function sanitizeUntrustedText(input: unknown): string {
  if (input === null || input === undefined) return "";
  let text = String(input);

  // Replace common injection markers with neutral brackets [DEFANGED: ...]
  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, (match) => {
      const cleanMatch = match.trim().replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
      return `[DEFANGED_${cleanMatch}]`;
    });
  }

  // Defang XML/HTML-like tags that could be parsed as system instructions
  text = text.replace(/<([^>]+)>/g, "‹$1›");

  // Prevent backtick escape exploits
  text = text.replace(/`/g, "'");

  return text.trim();
}

/**
 * Deeply sanitizes any object or array coming from external store data
 * to ensure all string properties are defanged before reaching an AI model.
 */
export function sanitizeUntrustedPayload<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    return sanitizeUntrustedText(data) as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeUntrustedPayload(item)) as unknown as T;
  }

  if (typeof data === "object") {
    const sanitizedObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      sanitizedObj[key] = sanitizeUntrustedPayload(value);
    }
    return sanitizedObj as T;
  }

  return data;
}

/**
 * Formats a block of text specifically as inert data in outputs,
 * warning the consuming LLM that it contains unverified user/store input.
 */
export function formatDataBoundary(label: string, text: string): string {
  const sanitized = sanitizeUntrustedText(text);
  return `[DATA_BLOCK: ${label}] "${sanitized}" [/DATA_BLOCK]`;
}
