import {
  FETCH_TRUNCATION_MARKER,
  MAX_ERROR_BODY_CHARS,
} from "./constants"
import type { FormattedFetchContent } from "./types"

/** Truncates by Unicode code points so emoji and surrogate pairs are not split. */
export function truncate(value: string, maxChars: number): string {
  if (maxChars <= 0) return ""
  if (value.length <= maxChars) return value
  return Array.from(value).slice(0, maxChars).join("")
}

export function formatFetchContent(title: string, content: string, maxChars: number): string {
  return truncate(title ? `# ${title}\n\n${content}` : content, maxChars)
}

/**
 * Builds the model-facing document and reports whether it was cut. The
 * truncation marker counts toward `maxChars`, so the returned content never
 * exceeds the configured budget.
 */
export function formatFetchedContent(
  title: string,
  content: string,
  maxChars: number,
): FormattedFetchContent {
  const document = title ? `# ${title}\n\n${content}` : content
  const length = Array.from(document).length
  if (maxChars <= 0) return { content: "", truncated: length > 0 }
  if (length <= maxChars) return { content: document, truncated: false }

  const markerLength = Array.from(FETCH_TRUNCATION_MARKER).length
  if (maxChars <= markerLength) {
    return { content: truncate(document, maxChars), truncated: true }
  }
  return {
    content: `${truncate(document, maxChars - markerLength)}${FETCH_TRUNCATION_MARKER}`,
    truncated: true,
  }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***")
}

export function formatApiError(operation: string, status: number, body: string): string {
  const detail = redactSecrets(body.trim())
  const text = detail
    ? detail.length > MAX_ERROR_BODY_CHARS
      ? `${detail.slice(0, MAX_ERROR_BODY_CHARS)}…`
      : detail
    : "empty response body"
  const hint =
    status === 401
      ? "invalid API key"
      : status === 402
        ? "insufficient balance"
        : status === 403
          ? "permission denied"
          : status === 429
            ? "rate limited"
            : undefined
  const label = hint ? `${operation} failed (HTTP ${status}, ${hint})` : `${operation} failed (HTTP ${status})`
  return `${label}: ${text}`
}

export function formatTimeoutError(operation: string, timeoutMs: number): string {
  return `${operation} timed out after ${timeoutMs} ms`
}
