import { resolvePluginOptions } from "../core/options"
import type { PluginOptions, ResolvedOptions } from "../core/types"

/** The environment an MCP server reads its key and options from. */
export type Env = Readonly<Record<string, string | undefined>>

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

  putNumber(options, "count", env.DEEPSEEK_SEARCH_COUNT)
  putNumber(options, "maxResults", env.DEEPSEEK_SEARCH_MAX_RESULTS)
  putNumber(options, "minRerank", env.DEEPSEEK_SEARCH_MIN_RERANK)
  putNumber(options, "minAuthority", env.DEEPSEEK_SEARCH_MIN_AUTHORITY)
  putBoolean(options, "allowUnknownAuthority", env.DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY)
  putDomains(options, "blockedDomains", env.DEEPSEEK_SEARCH_BLOCKED_DOMAINS)
  putDomains(options, "includeDomains", env.DEEPSEEK_SEARCH_INCLUDE_DOMAINS)
  putText(options, "language", env.DEEPSEEK_SEARCH_LANGUAGE)
  putNumber(options, "maxSummaryChars", env.DEEPSEEK_SEARCH_MAX_SUMMARY_CHARS)
  putNumber(options, "searchTimeoutMs", env.DEEPSEEK_SEARCH_TIMEOUT_MS)

  putNumber(options, "fetchMaxChars", env.DEEPSEEK_FETCH_MAX_CHARS)
  putDomains(options, "fetchAllowedDomains", env.DEEPSEEK_FETCH_ALLOWED_DOMAINS)
  putDomains(options, "fetchBlockedDomains", env.DEEPSEEK_FETCH_BLOCKED_DOMAINS)
  putNumber(options, "fetchTimeoutMs", env.DEEPSEEK_FETCH_TIMEOUT_MS)
  // Shared default is true; only an explicit false value disables it.
  if (isFalseValue(env.DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS)) {
    options.fetchBlockPrivateHosts = false
  }

  putNumber(options, "maxRetries", env.DEEPSEEK_MAX_RETRIES)
  putNumber(options, "retryBaseDelayMs", env.DEEPSEEK_RETRY_BASE_DELAY_MS)

  return options
}

function putNumber(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value === undefined) return
  const trimmed = value.trim()
  if (!trimmed) return
  const parsed = Number(trimmed)
  if (Number.isFinite(parsed)) target[key] = parsed
}

function putText(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value === undefined) return
  const trimmed = value.trim()
  if (trimmed) target[key] = trimmed
}

function putBoolean(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (isTrueValue(value)) target[key] = true
}

function putDomains(target: Record<string, unknown>, key: string, value: string | undefined): void {
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
