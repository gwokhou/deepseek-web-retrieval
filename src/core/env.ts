import { API_KEY_ENV, ENABLE_FETCH_ENV, ENABLE_SEARCH_ENV, SEARCH_LOCALIZATION_ENV } from "./constants";
import { normalizeDomain } from "./domains";
import { resolvePluginOptions } from "./options";
import type { PluginOptions, ResolvedOptions } from "./types";

/** The environment an adapter reads its key and options from. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Each supported option mapped onto its DEEPSEEK_* variable, grouped by value type. */
const NUMBER_ENV = {
  count: "DEEPSEEK_SEARCH_COUNT",
  maxResults: "DEEPSEEK_SEARCH_MAX_RESULTS",
  minRerank: "DEEPSEEK_SEARCH_MIN_RERANK",
  minAuthority: "DEEPSEEK_SEARCH_MIN_AUTHORITY",
  maxSummaryChars: "DEEPSEEK_SEARCH_MAX_SUMMARY_CHARS",
  searchTimeoutMs: "DEEPSEEK_SEARCH_TIMEOUT_MS",
  fetchMaxChars: "DEEPSEEK_FETCH_MAX_CHARS",
  fetchTimeoutMs: "DEEPSEEK_FETCH_TIMEOUT_MS",
  maxRetries: "DEEPSEEK_MAX_RETRIES",
  retryBaseDelayMs: "DEEPSEEK_RETRY_BASE_DELAY_MS",
} as const;

const TEXT_ENV = {
  language: "DEEPSEEK_SEARCH_LANGUAGE",
  searchLocalization: SEARCH_LOCALIZATION_ENV,
} as const;

const DOMAINS_ENV = {
  blockedDomains: "DEEPSEEK_SEARCH_BLOCKED_DOMAINS",
  includeDomains: "DEEPSEEK_SEARCH_INCLUDE_DOMAINS",
  fetchAllowedDomains: "DEEPSEEK_FETCH_ALLOWED_DOMAINS",
  fetchBlockedDomains: "DEEPSEEK_FETCH_BLOCKED_DOMAINS",
} as const;

/** Shared defaults are true; only an explicit false value disables them. */
const FALSE_ONLY_ENV = {
  allowUnknownAuthority: "DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY",
  fetchBlockPrivateHosts: "DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS",
  searchEnabled: ENABLE_SEARCH_ENV,
  fetchEnabled: ENABLE_FETCH_ENV,
} as const;

/**
 * Every option's `DEEPSEEK_*` variable name, in map order — the names a host that
 * isolates its children from the parent environment (Codex) must forward for
 * shell-set options to reach the server. `DEEPSEEK_API_KEY` is deliberately
 * absent: it is not an option variable, and installers compose it separately.
 */
export const OPTION_ENV_VARS: readonly string[] = [
  ...Object.values(NUMBER_ENV),
  ...Object.values(TEXT_ENV),
  ...Object.values(DOMAINS_ENV),
  ...Object.values(FALSE_ONLY_ENV),
];

/**
 * Maps `DEEPSEEK_*` environment variables onto the shared plugin option keys and
 * resolves them through the shared pipeline, so defaults and clamping stay
 * identical across every adapter. Invalid values are dropped and the shared
 * default applies; `envOptionsReport` is where those drops become visible.
 * `fileOptions` (the shared config file) layer beneath the environment: for
 * the same key the environment wins.
 */
export function resolveEnvOptions(env: Env = process.env, fileOptions?: PluginOptions): ResolvedOptions {
  return resolvePluginOptions({ ...fileOptions, ...pluginOptionsFromEnv(env) });
}

/**
 * What reading the `DEEPSEEK_*` environment produced, plus the problems as
 * structured data. Startup paths stay silent (they use pluginOptionsFromEnv);
 * surfaces whose job is visibility — the config command — replay these
 * warnings through their own channel.
 */
export interface EnvOptionsReport {
  readonly options: PluginOptions;
  /** One entry per set-but-unusable `DEEPSEEK_*` variable: unknown names and values that had to be dropped. */
  readonly warnings: readonly string[];
}

/** The options layer of the environment, with every drop reported instead of silent. */
export function envOptionsReport(env: Env = process.env): EnvOptionsReport {
  const options: Record<string, unknown> = {};
  const warnings: string[] = [];

  putNumber(options, "count", env, warnings);
  putNumber(options, "maxResults", env, warnings);
  putNumber(options, "minRerank", env, warnings);
  putNumber(options, "minAuthority", env, warnings);
  putFalseOnly(options, "allowUnknownAuthority", env, warnings);
  putDomains(options, "blockedDomains", env, warnings);
  putDomains(options, "includeDomains", env, warnings);
  putText(options, "language", env);
  putText(options, "searchLocalization", env);
  putNumber(options, "maxSummaryChars", env, warnings);
  putNumber(options, "searchTimeoutMs", env, warnings);

  putNumber(options, "fetchMaxChars", env, warnings);
  putDomains(options, "fetchAllowedDomains", env, warnings);
  putDomains(options, "fetchBlockedDomains", env, warnings);
  putNumber(options, "fetchTimeoutMs", env, warnings);
  putFalseOnly(options, "fetchBlockPrivateHosts", env, warnings);
  putFalseOnly(options, "searchEnabled", env, warnings);
  putFalseOnly(options, "fetchEnabled", env, warnings);

  putNumber(options, "maxRetries", env, warnings);
  putNumber(options, "retryBaseDelayMs", env, warnings);

  const known = new Set(OPTION_ENV_VARS);
  for (const key of Object.keys(env)) {
    if (!key.startsWith("DEEPSEEK_") || key === API_KEY_ENV || known.has(key)) continue;
    if (!(env[key] ?? "").trim()) continue;
    warnings.push(`unknown DEEPSEEK_* variable ${key} — ignored`);
  }
  return { options, warnings };
}

export function pluginOptionsFromEnv(env: Env): PluginOptions {
  return envOptionsReport(env).options;
}

function putNumber(target: Record<string, unknown>, key: keyof typeof NUMBER_ENV, env: Env, warnings: string[]): void {
  const value = env[NUMBER_ENV[key]];
  if (value === undefined) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) target[key] = parsed;
  else warnings.push(`${NUMBER_ENV[key]} is not a number ("${trimmed}") — ignored`);
}

function putText(target: Record<string, unknown>, key: keyof typeof TEXT_ENV, env: Env): void {
  const value = env[TEXT_ENV[key]];
  if (value === undefined) return;
  const trimmed = value.trim();
  if (trimmed) target[key] = trimmed;
}

function putFalseOnly(
  target: Record<string, unknown>,
  key: keyof typeof FALSE_ONLY_ENV,
  env: Env,
  warnings: string[],
): void {
  const name = FALSE_ONLY_ENV[key];
  const value = env[name];
  if (value === undefined || !value.trim()) return;
  if (isFalseValue(value)) {
    target[key] = false;
    return;
  }
  warnings.push(`${name}="${value.trim()}" changes nothing — only false/0/no/off turns the switch off`);
}

function putDomains(
  target: Record<string, unknown>,
  key: keyof typeof DOMAINS_ENV,
  env: Env,
  warnings: string[],
): void {
  const name = DOMAINS_ENV[key];
  const value = env[name];
  if (value === undefined || !value.trim()) return;
  const domains = value
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
  for (const domain of domains) {
    if (normalizeDomain(domain) === undefined) {
      warnings.push(`${name} entry "${domain}" is not a domain — ignored`);
    }
  }
  if (domains.length > 0) target[key] = domains;
  else warnings.push(`${name} contains no domains — ignored`);
}

function isFalseValue(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === "false" || trimmed === "0" || trimmed === "no" || trimmed === "off";
}
