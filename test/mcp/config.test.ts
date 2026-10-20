import { describe, expect, test } from "bun:test"
import { pluginOptionsFromEnv, resolveEnvOptions } from "../../src/mcp/config"

describe("pluginOptionsFromEnv", () => {
  test("maps numeric environment variables onto plugin option keys", () => {
    const options = pluginOptionsFromEnv({
      DEEPSEEK_SEARCH_COUNT: "20",
      DEEPSEEK_SEARCH_MAX_RESULTS: "3",
      DEEPSEEK_SEARCH_MIN_RERANK: "1.0",
      DEEPSEEK_SEARCH_MIN_AUTHORITY: "1",
      DEEPSEEK_SEARCH_MAX_SUMMARY_CHARS: "800",
      DEEPSEEK_SEARCH_TIMEOUT_MS: "15000",
      DEEPSEEK_FETCH_MAX_CHARS: "4000",
      DEEPSEEK_FETCH_TIMEOUT_MS: "10000",
      DEEPSEEK_MAX_RETRIES: "2",
      DEEPSEEK_RETRY_BASE_DELAY_MS: "500",
    })
    expect(options).toEqual({
      count: 20,
      maxResults: 3,
      minRerank: 1.0,
      minAuthority: 1,
      maxSummaryChars: 800,
      searchTimeoutMs: 15000,
      fetchMaxChars: 4000,
      fetchTimeoutMs: 10000,
      maxRetries: 2,
      retryBaseDelayMs: 500,
    })
  })

  test("drops invalid numeric values so shared defaults apply", () => {
    const options = pluginOptionsFromEnv({ DEEPSEEK_SEARCH_COUNT: "not-a-number", DEEPSEEK_FETCH_MAX_CHARS: "" })
    expect(options).toEqual({})
  })

  test("splits domain lists on commas and drops empty entries", () => {
    const options = pluginOptionsFromEnv({
      DEEPSEEK_SEARCH_BLOCKED_DOMAINS: "example.com, spam.example,",
      DEEPSEEK_SEARCH_INCLUDE_DOMAINS: "docs.example.com",
      DEEPSEEK_FETCH_ALLOWED_DOMAINS: "a.org,b.org",
      DEEPSEEK_FETCH_BLOCKED_DOMAINS: "c.org",
    })
    expect(options).toEqual({
      blockedDomains: ["example.com", "spam.example"],
      includeDomains: ["docs.example.com"],
      fetchAllowedDomains: ["a.org", "b.org"],
      fetchBlockedDomains: ["c.org"],
    })
  })

  test("parses booleans", () => {
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY: "true" })).toEqual({
      allowUnknownAuthority: true,
    })
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY: "1" })).toEqual({
      allowUnknownAuthority: true,
    })
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY: "no" })).toEqual({})
  })

  test("keeps fetchBlockPrivateHosts on by default and only disables it explicitly", () => {
    expect(pluginOptionsFromEnv({ DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS: "true" })).toEqual({})
    expect(pluginOptionsFromEnv({ DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS: "false" })).toEqual({
      fetchBlockPrivateHosts: false,
    })
    expect(pluginOptionsFromEnv({ DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS: "0" })).toEqual({
      fetchBlockPrivateHosts: false,
    })
  })

  test("maps DEEPSEEK_ENABLE_SEARCH/FETCH as false-only tool switches", () => {
    expect(pluginOptionsFromEnv({ DEEPSEEK_ENABLE_SEARCH: "true", DEEPSEEK_ENABLE_FETCH: "1" })).toEqual({})
    expect(pluginOptionsFromEnv({ DEEPSEEK_ENABLE_SEARCH: "false" })).toEqual({ searchEnabled: false })
    expect(pluginOptionsFromEnv({ DEEPSEEK_ENABLE_FETCH: "0" })).toEqual({ fetchEnabled: false })
    expect(pluginOptionsFromEnv({ DEEPSEEK_ENABLE_SEARCH: "no", DEEPSEEK_ENABLE_FETCH: "off" })).toEqual({
      searchEnabled: false,
      fetchEnabled: false,
    })
    expect(resolveEnvOptions({ DEEPSEEK_ENABLE_SEARCH: "false" }).search.enabled).toBe(false)
    expect(resolveEnvOptions({}).fetch.enabled).toBe(true)
  })

  test("passes language text through", () => {
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_LANGUAGE: "zh" })).toEqual({ language: "zh" })
  })
})

describe("resolveEnvOptions", () => {
  test("clamps values through the shared option pipeline", () => {
    const resolved = resolveEnvOptions({ DEEPSEEK_SEARCH_COUNT: "999", DEEPSEEK_SEARCH_MAX_RESULTS: "-3" })
    expect(resolved.search.count).toBe(50)
    expect(resolved.search.maxResults).toBe(0)
  })

  test("uses shared defaults for an empty environment", () => {
    const resolved = resolveEnvOptions({})
    expect(resolved.search.maxResults).toBe(5)
    expect(resolved.fetch.maxChars).toBe(16000)
    expect(resolved.retry.maxRetries).toBe(0)
  })
})
