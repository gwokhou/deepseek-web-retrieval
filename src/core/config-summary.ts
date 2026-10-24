import { resolvePluginOptions } from "./options";
import type { ResolvedOptions } from "./types";

/**
 * The ordered config vocabulary: every diffable knob's config key and where it
 * lives in ResolvedOptions. The single source three surfaces share — the
 * startup deviation line's key order (via configSummaryValues), the config
 * command's listing, and the shared file's accepted keys (SHARED_CONFIG_KEYS
 * derives from it) — so adding a knob is one edit here.
 */
const VOCABULARY = [
  { key: "count", read: (o: ResolvedOptions) => o.search.count },
  { key: "maxResults", read: (o: ResolvedOptions) => o.search.maxResults },
  { key: "minRerank", read: (o: ResolvedOptions) => o.search.minRerank },
  { key: "minAuthority", read: (o: ResolvedOptions) => o.search.minAuthority },
  { key: "allowUnknownAuthority", read: (o: ResolvedOptions) => o.search.allowUnknownAuthority },
  { key: "blockedDomains", read: (o: ResolvedOptions) => o.search.blockedDomains },
  { key: "includeDomains", read: (o: ResolvedOptions) => o.search.includeDomains },
  { key: "language", read: (o: ResolvedOptions) => o.search.language },
  { key: "searchLocalization", read: (o: ResolvedOptions) => o.search.localization },
  { key: "maxSummaryChars", read: (o: ResolvedOptions) => o.search.maxSummaryChars },
  { key: "searchContentMaxChars", read: (o: ResolvedOptions) => o.search.contentMaxChars },
  { key: "searchContentTimeoutMs", read: (o: ResolvedOptions) => o.search.contentTimeoutMs },
  { key: "searchTimeoutMs", read: (o: ResolvedOptions) => o.search.timeoutMs },
  { key: "fetchMaxChars", read: (o: ResolvedOptions) => o.fetch.maxChars },
  { key: "fetchAllowedDomains", read: (o: ResolvedOptions) => o.fetch.allowedDomains },
  { key: "fetchBlockedDomains", read: (o: ResolvedOptions) => o.fetch.blockedDomains },
  { key: "fetchTimeoutMs", read: (o: ResolvedOptions) => o.fetch.timeoutMs },
  { key: "fetchBlockPrivateHosts", read: (o: ResolvedOptions) => o.fetch.blockPrivateHosts },
  { key: "maxRetries", read: (o: ResolvedOptions) => o.retry.maxRetries },
  { key: "retryBaseDelayMs", read: (o: ResolvedOptions) => o.retry.baseDelayMs },
  { key: "baseUrl", read: (o: ResolvedOptions) => o.baseUrl },
] as const;

/** The config keys in vocabulary order; the shared config file accepts exactly these. */
export const CONFIG_KEYS: readonly string[] = VOCABULARY.map((entry) => entry.key);

/**
 * Renders only the knobs whose effective value differs from the built-in
 * defaults, as space-separated `key=value` tokens in the config vocabulary.
 * Host-integration fields (the tool `enabled` flags, `apiKeySource`) are
 * excluded — they are not in the vocabulary; tool visibility is the startup
 * tools line's job and the key source is host-native config. Empty diff means
 * empty string.
 */
export function configDeviations(resolved: ResolvedOptions): string {
  const defaults = configSummaryValues(resolvePluginOptions({}));
  const effective = configSummaryValues(resolved);
  const tokens: string[] = [];
  for (const key of Object.keys(effective)) {
    const value = effective[key];
    if (sameValue(value, defaults[key])) continue;
    tokens.push(`${key}=${formatConfigValue(value, "length")}`);
  }
  return tokens.join(" ");
}

/**
 * Flattens the diffable resolved fields onto their config-vocabulary names,
 * in vocabulary order (Object key insertion order preserves it).
 */
export function configSummaryValues(options: ResolvedOptions): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const entry of VOCABULARY) values[entry.key] = entry.read(options);
  return values;
}

/** How arrays render: lengths for the noise-constrained startup line, entries for the human CLI. */
export type ConfigArrayStyle = "length" | "join";

/** One value renderer for both surfaces; `undefined` renders as "unset". */
export function formatConfigValue(value: unknown, arrays: ConfigArrayStyle): string {
  if (Array.isArray(value)) {
    if (arrays === "length") return String(value.length);
    return value.length > 0 ? value.join(", ") : "[]";
  }
  return value === undefined ? "unset" : String(value);
}

function sameValue(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(value) && Array.isArray(fallback)) {
    return value.length === fallback.length && value.every((entry, index) => entry === fallback[index]);
  }
  return value === fallback;
}
