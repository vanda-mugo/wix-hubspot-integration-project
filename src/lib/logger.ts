/**
 * Safe Logger
 *
 * Logs messages while redacting sensitive data (tokens, PII, secrets).
 * Never logs access tokens, refresh tokens, API keys, or email addresses.
 */

const SENSITIVE_PATTERNS = [
  // OAuth tokens (Bearer, access_token, refresh_token patterns)
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /access_token["']?\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]+/gi,
  /refresh_token["']?\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]+/gi,
  // API keys and secrets
  /api_?key["']?\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]+/gi,
  /secret["']?\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]+/gi,
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
];

function redact(input: string): string {
  let result = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return redact(arg);
      if (typeof arg === "object" && arg !== null) {
        try {
          return redact(JSON.stringify(arg, null, 2));
        } catch {
          return "[Unserializable Object]";
        }
      }
      return String(arg);
    })
    .join(" ");
}

export const logger = {
  info: (...args: unknown[]) => {
    console.log(`[INFO] ${new Date().toISOString()}`, formatArgs(args));
  },
  warn: (...args: unknown[]) => {
    console.warn(`[WARN] ${new Date().toISOString()}`, formatArgs(args));
  },
  error: (...args: unknown[]) => {
    console.error(`[ERROR] ${new Date().toISOString()}`, formatArgs(args));
  },
  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV === "development") {
      console.debug(`[DEBUG] ${new Date().toISOString()}`, formatArgs(args));
    }
  },
};

export default logger;
