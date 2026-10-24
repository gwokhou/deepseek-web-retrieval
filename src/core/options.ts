import { isIP } from "node:net";
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_API_KEY_SOURCE,
  DEFAULT_FETCH_MAX_CHARS,
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_SUMMARY_CHARS,
  DEFAULT_MIN_AUTHORITY,
  DEFAULT_MIN_RERANK,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_SEARCH_CONTENT_MAX_CHARS,
  DEFAULT_SEARCH_CONTENT_TIMEOUT_MS,
  DEFAULT_SEARCH_COUNT,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  MAX_RETRY_DELAY_MS,
  MAX_SEARCH_COUNT,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
} from "./constants";
import { normalizeDomains } from "./domains";
import type {
  ApiKeySource,
  AuthOptions,
  FetchOptions,
  PluginOptions,
  ResolvedOptions,
  RetryOptions,
  SearchOptions,
} from "./types";

export function resolvePluginOptions(input?: PluginOptions): ResolvedOptions {
  return {
    search: resolveSearchOptions(input),
    fetch: resolveFetchOptions(input),
    auth: resolveAuthOptions(input),
    retry: resolveRetryOptions(input),
    baseUrl: resolveBaseUrl(input?.baseUrl),
  };
}

/**
 * The both-disabled refusal both server surfaces share: undefined when a tool
 * stays enabled, otherwise one message naming why both are off.
 */
export function bothDisabledPrecheck(
  config: Pick<ResolvedOptions, "search" | "fetch">,
  reason: string,
): string | undefined {
  if (config.search.enabled || config.fetch.enabled) return undefined;
  return `Both tools are disabled (${reason}); at least one must stay enabled.`;
}

export function resolveSearchOptions(input?: PluginOptions): SearchOptions {
  const count = clampInt(input?.count, DEFAULT_SEARCH_COUNT, 1, 50);
  return {
    count,
    // Constraint: maxResults follows count only when the user left it alone —
    // an explicit maxResults still caps as before. count never follows
    // maxResults: fetching more than the cap returns wastes nothing visible,
    // while returning fewer than were fetched silently discards results.
    maxResults: clampInt(input?.maxResults, Number.isFinite(input?.count) ? count : DEFAULT_MAX_RESULTS, 0, 50),
    minRerank: finiteNumber(input?.minRerank, DEFAULT_MIN_RERANK),
    minAuthority: finiteNumber(input?.minAuthority, DEFAULT_MIN_AUTHORITY),
    allowUnknownAuthority: input?.allowUnknownAuthority !== false,
    blockedDomains: normalizeDomains(input?.blockedDomains),
    includeDomains: normalizeDomains(input?.includeDomains),
    language: optionalText(input?.language),
    localization: localizationValue(input?.searchLocalization),
    maxSummaryChars: clampInt(input?.maxSummaryChars, DEFAULT_MAX_SUMMARY_CHARS, 0, 1_000_000),
    contentMaxChars: clampInt(input?.searchContentMaxChars, DEFAULT_SEARCH_CONTENT_MAX_CHARS, 0, 1_000_000),
    contentTimeoutMs: clampInt(
      input?.searchContentTimeoutMs,
      DEFAULT_SEARCH_CONTENT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    timeoutMs: clampInt(input?.searchTimeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    enabled: input?.searchEnabled !== false,
  };
}

export function resolveFetchOptions(input?: PluginOptions): FetchOptions {
  return {
    maxChars: clampInt(input?.fetchMaxChars, DEFAULT_FETCH_MAX_CHARS, 0, 1_000_000),
    allowedDomains: normalizeDomains(input?.fetchAllowedDomains),
    blockedDomains: normalizeDomains(input?.fetchBlockedDomains),
    timeoutMs: clampInt(input?.fetchTimeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    blockPrivateHosts: input?.fetchBlockPrivateHosts !== false,
    enabled: input?.fetchEnabled !== false,
  };
}

export function resolveAuthOptions(input?: PluginOptions): AuthOptions {
  const value = input?.apiKeySource;
  return {
    source: value === "opencode" || value === "env" ? value : (DEFAULT_API_KEY_SOURCE as ApiKeySource),
  };
}

export function resolveRetryOptions(input?: PluginOptions): RetryOptions {
  return {
    maxRetries: clampInt(input?.maxRetries, DEFAULT_MAX_RETRIES, 0, MAX_RETRIES),
    baseDelayMs: clampInt(input?.retryBaseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS, 0, MAX_RETRY_DELAY_MS),
  };
}

/**
 * Constraint: only an http(s) URL with no fragment survives, trailing slashes
 * stripped so endpoint composition never doubles them. Anything else — a bare
 * hostname, a non-http scheme, an empty string — drops to the production
 * default, the same drop-and-default contract as every other invalid knob.
 */
export function resolveBaseUrl(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_API_BASE_URL;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_API_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return DEFAULT_API_BASE_URL;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return DEFAULT_API_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

/**
 * Applies a per-call result count to resolved search options. The count the
 * model asked for is what it wants to see, so it sets both the request count
 * and the post-filter cap for that call; the configured knobs stay the
 * default, not a ceiling.
 */
export function withPerCallCount(options: SearchOptions, count: number | undefined): SearchOptions {
  if (count === undefined || !Number.isFinite(count)) return options;
  const clamped = Math.min(MAX_SEARCH_COUNT, Math.max(1, Math.trunc(count)));
  return { ...options, count: clamped, maxResults: clamped };
}

/**
 * Resolves the per-call timeout from the plugin cap and the built-in tool's
 * `timeout` field (seconds). The shorter limit wins.
 */
export function resolveFetchTimeoutMs(configuredMs: number, inputSeconds?: unknown): number {
  if (typeof inputSeconds !== "number" || !Number.isFinite(inputSeconds) || inputSeconds <= 0) {
    return configuredMs;
  }
  const inputMs = Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.round(inputSeconds * 1000)));
  return Math.min(configuredMs, inputMs);
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Constraint: only a valid IPv4 dotted-quad (four 0-255 octets) or IPv6
 * address (including "::" compression) survives; anything else drops to
 * undefined so the request omits `localization` entirely. This is the
 * enforcement point no matter which config channel delivered the value.
 */
function localizationValue(value: unknown): string | undefined {
  const text = optionalText(value);
  // isIP is the platform's strict parser; its one lax spot is IPv6 zone IDs
  // ("%eth0"), which name a local link, not a geolocation — reject those.
  return text !== undefined && !text.includes("%") && isIP(text) !== 0 ? text : undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, number));
}
