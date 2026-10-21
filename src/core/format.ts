import {
  FETCH_TRUNCATION_MARKER,
  MAX_ERROR_BODY_CHARS,
} from "./constants"
import type { FormattedFetchContent, SearchResult } from "./types"

/** Truncates by Unicode code points so emoji and surrogate pairs are not split. */
export function truncate(value: string, maxChars: number): string {
  if (maxChars <= 0) return ""
  if (value.length <= maxChars) return value
  return Array.from(value).slice(0, maxChars).join("")
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
  const document = withTitle(title, content)
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

function withTitle(title: string, content: string): string {
  const heading = title.trim()
  if (!heading) return content

  const body = content.trimStart()
  const lines = body.split(/\r?\n/)
  const firstHeading = lines[0]?.match(/^\\?#\s+(.+?)\s*$/)?.[1]
  if (firstHeading && normalizeHeading(firstHeading) === normalizeHeading(heading)) {
    // DeepSeek sometimes escapes the leading "#" as "\#"; normalize it so the
    // result is a real Markdown heading instead of a duplicated literal line.
    lines[0] = `# ${heading}`
    return lines.join("\n")
  }
  return `# ${heading}\n\n${content}`
}

function normalizeHeading(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+#+\s*$/, "")
    .toLowerCase()
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***")
}

export function formatApiError(operation: string, status: number, body: string): string {
  const detail = redactSecrets(body.trim())
  const detailChars = Array.from(detail)
  const text = detail
    ? detailChars.length > MAX_ERROR_BODY_CHARS
      ? `${detailChars.slice(0, MAX_ERROR_BODY_CHARS).join("")}…`
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

/**
 * Renders processed search results as Markdown for a text content block.
 * Hosts that ignore structured output read this text.
 */
export function formatSearchResults(results: readonly SearchResult[]): string {
  if (results.length === 0) return "No results found."

  return results
    .map((result, index) => {
      const title = result.title?.trim() || result.url
      const lines = [`${index + 1}. [${escapeBrackets(title)}](${result.url})`]
      if (result.content) {
        lines.push(`   ${result.content.replaceAll("\n", " ")}`)
      }
      if (result.published !== undefined) {
        lines.push(`   Published: ${formatPublished(result.published)}`)
      }
      return lines.join("\n")
    })
    .join("\n\n")
}

/**
 * Renders one search result as the structured mirror of its text form; hosts
 * that read structuredContent (every JSON-replacing client excepted) get this
 * shape from both adapters.
 */
export function toStructuredResult(result: SearchResult) {
  return {
    url: result.url,
    ...(result.title ? { title: result.title } : {}),
    ...(result.content ? { content: result.content } : {}),
    ...(result.published !== undefined ? { published: result.published } : {}),
  }
}

function escapeBrackets(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]")
}

function formatPublished(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}
