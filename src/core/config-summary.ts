import { resolvePluginOptions } from "./options";
import type { ResolvedOptions } from "./types";

/**
 * Renders only the knobs whose effective value differs from the built-in
 * defaults, as space-separated `key=value` tokens in the config vocabulary.
 * Host-integration fields (the tool `enabled` flags, `apiKeySource`) are
 * excluded: tool visibility is the startup tools line's job and the key
 * source is host-native config. Empty diff means empty string.
 */
export function configDeviations(resolved: ResolvedOptions): string {
  const defaults = summaryValues(resolvePluginOptions({}));
  const effective = summaryValues(resolved);
  const tokens: string[] = [];
  for (const key of Object.keys(effective)) {
    const value = effective[key];
    if (sameValue(value, defaults[key])) continue;
    tokens.push(`${key}=${formatValue(value)}`);
  }
  return tokens.join(" ");
}

/** Flattens the diffable resolved fields onto their config-vocabulary names. */
function summaryValues(options: ResolvedOptions): Record<string, unknown> {
  return {
    count: options.search.count,
    maxResults: options.search.maxResults,
    minRerank: options.search.minRerank,
    minAuthority: options.search.minAuthority,
    allowUnknownAuthority: options.search.allowUnknownAuthority,
    blockedDomains: options.search.blockedDomains,
    includeDomains: options.search.includeDomains,
    language: options.search.language,
    searchLocalization: options.search.localization,
    maxSummaryChars: options.search.maxSummaryChars,
    searchTimeoutMs: options.search.timeoutMs,
    fetchMaxChars: options.fetch.maxChars,
    fetchAllowedDomains: options.fetch.allowedDomains,
    fetchBlockedDomains: options.fetch.blockedDomains,
    fetchTimeoutMs: options.fetch.timeoutMs,
    fetchBlockPrivateHosts: options.fetch.blockPrivateHosts,
    maxRetries: options.retry.maxRetries,
    retryBaseDelayMs: options.retry.baseDelayMs,
  };
}

function sameValue(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(value) && Array.isArray(fallback)) {
    return value.length === fallback.length && value.every((entry, index) => entry === fallback[index]);
  }
  return value === fallback;
}

/** Arrays render as their length; the entries themselves would swamp the line. */
function formatValue(value: unknown): string {
  return Array.isArray(value) ? String(value.length) : String(value);
}
