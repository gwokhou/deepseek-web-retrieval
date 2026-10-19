import { normalizeDomains } from "./domains"
import { truncate } from "./format"
import type { DeepSeekSearchResult, SearchOptions, WebSearchResult } from "./types"
import { normalizeResultUrl } from "./url"

/**
 * Appends DeepSeek search operators:
 *   blocked: -site:example.com (space separated for multiple)
 *   include: site:a.com OR site:b.com
 *   language: lang:zh or lang:zh,en
 */
export function buildQuery(
  query: string,
  options: Pick<SearchOptions, "blockedDomains" | "includeDomains" | "language">,
): string {
  const parts = [query.trim()]
  for (const domain of normalizeDomains(options.blockedDomains)) parts.push(`-site:${domain}`)
  const include = normalizeDomains(options.includeDomains)
  if (include.length) parts.push(include.map((domain) => `site:${domain}`).join(" OR "))
  const language = options.language?.trim().replace(/^lang:/i, "")
  if (language) parts.push(`lang:${language}`)
  return parts.filter((part) => part.length > 0).join(" ")
}

export function parsePublished(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

/**
 * Filters and maps DeepSeek results to OpenCode's WebSearch.Result shape.
 * Missing/non-finite rerank_score never passes. Authority -1/missing is
 * "unknown" and only passes when allowUnknownAuthority is enabled.
 */
export function processResults(
  raw: readonly DeepSeekSearchResult[],
  options: SearchOptions,
): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (results.length >= options.maxResults) break
    if (!item || typeof item !== "object") continue

    const url = normalizeResultUrl(item.url)
    if (!url || seen.has(url)) continue

    const rerank = item.rerank_score
    if (typeof rerank !== "number" || !Number.isFinite(rerank) || rerank < options.minRerank) continue

    const authority = item.authority
    const knownAuthority =
      typeof authority === "number" && Number.isFinite(authority) && authority >= 0
    if (knownAuthority) {
      if (authority < options.minAuthority) continue
    } else if (!options.allowUnknownAuthority) {
      continue
    }

    seen.add(url)
    const content = truncate(
      optionalText(item.summary) ?? optionalText(item.snippet) ?? "",
      options.maxSummaryChars,
    )
    const time: { published?: number } = {}
    const published = parsePublished(item.date)
    if (published !== undefined) time.published = published
    const title = optionalText(item.title)
    results.push({
      url,
      ...(title ? { title } : {}),
      ...(content ? { content } : {}),
      time,
    })
  }

  return results
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
