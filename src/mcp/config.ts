import { resolvePluginOptions } from "../core/options"
import type { PluginOptions, ResolvedOptions } from "../core/types"

/** The environment an MCP server reads its key and options from. */
export type Env = Readonly<Record<string, string | undefined>>

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
} as const

const TEXT_ENV = {
  language: "DEEPSEEK_SEARCH_LANGUAGE",
} as const

const DOMAINS_ENV = {
  blockedDomains: "DEEPSEEK_SEARCH_BLOCKED_DOMAINS",
  includeDomains: "DEEPSEEK_SEARCH_INCLUDE_DOMAINS",
  fetchAllowedDomains: "DEEPSEEK_FETCH_ALLOWED_DOMAINS",
  fetchBlockedDomains: "DEEPSEEK_FETCH_BLOCKED_DOMAINS",
} as const

const FLAG_ENV = {
  allowUnknownAuthority: "DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY",
} as const

/** Shared defaults are true; only an explicit false value disables them. */
const FALSE_ONLY_ENV = {
  fetchBlockPrivateHosts: "DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS",
} as const

/**
 * Maps `DEEPSEEK_*` environment variables onto the shared plugin option keys and
 * resolves them through the same pipeline as the OpenCode adapter, so defaults
 * and clamping stay identical across hosts. Invalid values are dropped and the
 * shared default applies.
 */
export function resolveEnvOptions(env: Env = process.env): ResolvedOptions {
  return resolvePluginOptions(pluginOptionsFromEnv(env))
}

export function pluginOptionsFromEnv(env: Env): PluginOptions {
  const options: Record<string, unknown> = {}

  putNumber(options, "count", env)
  putNumber(options, "maxResults", env)
  putNumber(options, "minRerank", env)
  putNumber(options, "minAuthority", env)
  putBoolean(options, "allowUnknownAuthority", env)
  putDomains(options, "blockedDomains", env)
  putDomains(options, "includeDomains", env)
  putText(options, "language", env)
  putNumber(options, "maxSummaryChars", env)
  putNumber(options, "searchTimeoutMs", env)

  putNumber(options, "fetchMaxChars", env)
  putDomains(options, "fetchAllowedDomains", env)
  putDomains(options, "fetchBlockedDomains", env)
  putNumber(options, "fetchTimeoutMs", env)
  putFalseOnly(options, "fetchBlockPrivateHosts", env)

  putNumber(options, "maxRetries", env)
  putNumber(options, "retryBaseDelayMs", env)

  return options
}

function putNumber(target: Record<string, unknown>, key: keyof typeof NUMBER_ENV, env: Env): void {
  const value = env[NUMBER_ENV[key]]
  if (value === undefined) return
  const trimmed = value.trim()
  if (!trimmed) return
  const parsed = Number(trimmed)
  if (Number.isFinite(parsed)) target[key] = parsed
}

function putText(target: Record<string, unknown>, key: keyof typeof TEXT_ENV, env: Env): void {
  const value = env[TEXT_ENV[key]]
  if (value === undefined) return
  const trimmed = value.trim()
  if (trimmed) target[key] = trimmed
}

function putBoolean(target: Record<string, unknown>, key: keyof typeof FLAG_ENV, env: Env): void {
  if (isTrueValue(env[FLAG_ENV[key]])) target[key] = true
}

function putFalseOnly(target: Record<string, unknown>, key: keyof typeof FALSE_ONLY_ENV, env: Env): void {
  if (isFalseValue(env[FALSE_ONLY_ENV[key]])) target[key] = false
}

function putDomains(target: Record<string, unknown>, key: keyof typeof DOMAINS_ENV, env: Env): void {
  const value = env[DOMAINS_ENV[key]]
  if (value === undefined || !value.trim()) return
  const domains = value
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0)
  if (domains.length > 0) target[key] = domains
}

function isTrueValue(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase()
  return trimmed === "true" || trimmed === "1" || trimmed === "yes" || trimmed === "on"
}

function isFalseValue(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase()
  return trimmed === "false" || trimmed === "0" || trimmed === "no" || trimmed === "off"
}
