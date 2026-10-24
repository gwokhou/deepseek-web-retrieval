import { MAX_QUERY_CHARS } from "./constants";
import { normalizeDomains } from "./domains";
import { truncate } from "./format";
import type { DeepSeekSearchResult, SearchOptions, SearchResult } from "./types";
import { normalizeResultUrl } from "./url";

/** The fewest body characters a degraded query keeps before operators start dropping. */
const MIN_BODY_CHARS = 8;

function charCount(value: string): number {
  return Array.from(value).length;
}

/** The query string plus every adjustment made to fit it under the length limit. */
export interface ComposedQuery {
  readonly query: string;
  readonly notes: readonly string[];
}

interface OperatorParts {
  readonly blocked: readonly string[];
  readonly include?: string;
  readonly language?: string;
}

/**
 * Operators are official API surface, documented in the guide's search-syntax
 * section (搜索语法): site:, -site:, lang:, quoted phrases, after:/before:.
 */
function operatorParts(options: Pick<SearchOptions, "blockedDomains" | "includeDomains" | "language">): OperatorParts {
  const blocked = normalizeDomains(options.blockedDomains).map((domain) => `-site:${domain}`);
  const include = normalizeDomains(options.includeDomains).map((domain) => `site:${domain}`);
  const language = options.language?.trim().replace(/^lang:/i, "");
  return {
    blocked,
    include: include.length ? include.join(" OR ") : undefined,
    language: language ? `lang:${language}` : undefined,
  };
}

function assemble(body: string, parts: OperatorParts, withInclude: boolean, withLang: boolean): string {
  const segments = [body, ...parts.blocked];
  if (withInclude && parts.include) segments.push(parts.include);
  if (withLang && parts.language) segments.push(parts.language);
  return segments.filter((segment) => segment.length > 0).join(" ");
}

/** Characters left for the query body once the kept operators and separators are paid for. */
function bodyBudget(parts: OperatorParts, withInclude: boolean, withLang: boolean, maxChars: number): number {
  const fixed = [
    ...parts.blocked,
    ...(withInclude && parts.include ? [parts.include] : []),
    ...(withLang && parts.language ? [parts.language] : []),
  ].join(" ");
  return maxChars - (fixed ? charCount(fixed) + 1 : 0);
}

/**
 * Builds the wire query within the API's character budget, degrading instead of
 * failing when operators push it over: the query body is truncated first (user
 * configuration outranks model verbosity), the language filter drops next, the
 * include list last; blocked domains never drop. Only when the -site:
 * operators alone crowd out the body does the call fail. Every adjustment is
 * reported in `notes` so the model can be shown what was actually searched.
 */
export function composeSearchQuery(
  query: string,
  options: Pick<SearchOptions, "blockedDomains" | "includeDomains" | "language">,
  maxChars: number = MAX_QUERY_CHARS,
): ComposedQuery {
  const parts = operatorParts(options);
  const body = query.trim();
  const notes: string[] = [];

  const attempt = (withInclude: boolean, withLang: boolean): string | undefined => {
    const budget = bodyBudget(parts, withInclude, withLang, maxChars);
    if (charCount(body) <= budget) return assemble(body, parts, withInclude, withLang);
    if (budget >= MIN_BODY_CHARS) {
      notes.push(`query truncated to ${budget} characters (query length limit)`);
      return assemble(truncate(body, budget), parts, withInclude, withLang);
    }
    return undefined;
  };

  let assembled = attempt(true, true);
  if (assembled === undefined && parts.language) {
    notes.push("language filter dropped (query length limit)");
    assembled = attempt(true, false);
  }
  if (assembled === undefined && parts.include) {
    notes.push("includeDomains filter dropped (query length limit)");
    assembled = attempt(false, false);
  }
  if (assembled === undefined) {
    throw new Error(
      `DeepSeek search query cannot fit ${maxChars} characters: the blockedDomains -site: ` +
        `operators alone occupy ${charCount(parts.blocked.join(" "))} characters`,
    );
  }
  return { query: assembled, notes };
}

export function parsePublished(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * Filters and maps DeepSeek results into the neutral SearchResult shape.
 * A present rerank_score always compares against minRerank; a missing or
 * non-finite score passes only while no positive threshold is set, so the
 * default returns exactly what DeepSeek ranked. Authority -1/missing is
 * "unknown" and only passes when allowUnknownAuthority is enabled.
 */
export function processResults(raw: readonly DeepSeekSearchResult[], options: SearchOptions): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (results.length >= options.maxResults) break;
    if (!item || typeof item !== "object") continue;

    const url = normalizeResultUrl(item.url);
    if (!url || seen.has(url)) continue;

    const rerank = item.rerank_score;
    if (typeof rerank === "number" && Number.isFinite(rerank)) {
      if (rerank < options.minRerank) continue;
    } else if (options.minRerank > 0) {
      // A threshold was explicitly raised, so a result that cannot be scored
      // against it must not slip through.
      continue;
    }

    const authority = item.authority;
    const knownAuthority = typeof authority === "number" && Number.isFinite(authority) && authority >= 0;
    if (knownAuthority) {
      if (authority < options.minAuthority) continue;
    } else if (!options.allowUnknownAuthority) {
      continue;
    }

    seen.add(url);
    const rawContent = optionalText(item.summary) ?? optionalText(item.snippet) ?? "";
    const cutContent = truncate(rawContent, options.maxSummaryChars);
    // The ellipsis marks a summary the cap actually shortened; official
    // summaries are typically 600-800 characters, so the 1,200 default
    // rarely triggers it.
    const content = cutContent && charCount(rawContent) > options.maxSummaryChars ? `${cutContent}…` : cutContent;
    const published = parsePublished(item.date);
    const title = optionalText(item.title);
    const rerankScore = typeof rerank === "number" && Number.isFinite(rerank) ? rerank : undefined;
    const authorityScore = typeof authority === "number" && Number.isFinite(authority) ? authority : undefined;
    const siteName = optionalText(item.site_name);
    results.push({
      url,
      ...(title ? { title } : {}),
      ...(content ? { content } : {}),
      ...(published !== undefined ? { published } : {}),
      ...(rerankScore !== undefined ? { rerankScore } : {}),
      ...(authorityScore !== undefined ? { authority: authorityScore } : {}),
      ...(siteName ? { siteName } : {}),
    });
  }

  return results;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
