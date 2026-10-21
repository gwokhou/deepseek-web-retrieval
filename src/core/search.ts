import { normalizeDomains } from "./domains"
import { truncate } from "./format"
import type { DeepSeekSearchResult, SearchOptions, SearchResult } from "./types"
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
 * Filters and maps DeepSeek results into the neutral SearchResult shape.
 * A present rerank_score always compares against minRerank; a missing or
 * non-finite score passes only while no positive threshold is set, so the
 * default returns exactly what DeepSeek ranked. Authority -1/missing is
 * "unknown" and only passes when allowUnknownAuthority is enabled.
 */
export function processResults(
  raw: readonly DeepSeekSearchResult[],
  options: SearchOptions,
): SearchResult[] {
  const results: SearchResult[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (results.length >= options.maxResults) break
    if (!item || typeof item !== "object") continue

    const url = normalizeResultUrl(item.url)
    if (!url || seen.has(url)) continue

    const rerank = item.rerank_score
    if (typeof rerank === "number" && Number.isFinite(rerank)) {
      if (rerank < options.minRerank) continue
    } else if (options.minRerank > 0) {
      // A threshold was explicitly raised, so a result that cannot be scored
      // against it must not slip through.
      continue
    }

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
    const published = parsePublished(item.date)
    const title = optionalText(item.title)
    results.push({
      url,
      ...(title ? { title } : {}),
      ...(content ? { content } : {}),
      ...(published !== undefined ? { published } : {}),
    })
  }

  return results
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
