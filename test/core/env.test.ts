import { describe, expect, test } from "bun:test";
import { OPTION_ENV_VARS, pluginOptionsFromEnv, resolveEnvOptions } from "../../src/core/env";

describe("OPTION_ENV_VARS", () => {
  test("lists every option variable exactly once, in map order, without the API key", () => {
    expect(OPTION_ENV_VARS).toEqual([
      // NUMBER_ENV
      "DEEPSEEK_SEARCH_COUNT",
      "DEEPSEEK_SEARCH_MAX_RESULTS",
      "DEEPSEEK_SEARCH_MIN_RERANK",
      "DEEPSEEK_SEARCH_MIN_AUTHORITY",
      "DEEPSEEK_SEARCH_MAX_SUMMARY_CHARS",
      "DEEPSEEK_SEARCH_TIMEOUT_MS",
      "DEEPSEEK_FETCH_MAX_CHARS",
      "DEEPSEEK_FETCH_TIMEOUT_MS",
      "DEEPSEEK_MAX_RETRIES",
      "DEEPSEEK_RETRY_BASE_DELAY_MS",
      // TEXT_ENV
      "DEEPSEEK_SEARCH_LANGUAGE",
      "DEEPSEEK_SEARCH_LOCALIZATION",
      // DOMAINS_ENV
      "DEEPSEEK_SEARCH_BLOCKED_DOMAINS",
      "DEEPSEEK_SEARCH_INCLUDE_DOMAINS",
      "DEEPSEEK_FETCH_ALLOWED_DOMAINS",
      "DEEPSEEK_FETCH_BLOCKED_DOMAINS",
      // FALSE_ONLY_ENV
      "DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY",
      "DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS",
      "DEEPSEEK_ENABLE_SEARCH",
      "DEEPSEEK_ENABLE_FETCH",
    ]);
    expect(OPTION_ENV_VARS.every((name) => /^DEEPSEEK_/.test(name))).toBe(true);
    expect(new Set(OPTION_ENV_VARS).size).toBe(OPTION_ENV_VARS.length);
    expect(OPTION_ENV_VARS).not.toContain("DEEPSEEK_API_KEY");
  });
});

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
    });
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
    });
  });

  test("drops invalid numeric values so shared defaults apply", () => {
    const options = pluginOptionsFromEnv({ DEEPSEEK_SEARCH_COUNT: "not-a-number", DEEPSEEK_FETCH_MAX_CHARS: "" });
    expect(options).toEqual({});
  });

  test("splits domain lists on commas and drops empty entries", () => {
    const options = pluginOptionsFromEnv({
      DEEPSEEK_SEARCH_BLOCKED_DOMAINS: "example.com, spam.example,",
      DEEPSEEK_SEARCH_INCLUDE_DOMAINS: "docs.example.com",
      DEEPSEEK_FETCH_ALLOWED_DOMAINS: "a.org,b.org",
      DEEPSEEK_FETCH_BLOCKED_DOMAINS: "c.org",
    });
    expect(options).toEqual({
      blockedDomains: ["example.com", "spam.example"],
      includeDomains: ["docs.example.com"],
      fetchAllowedDomains: ["a.org", "b.org"],
      fetchBlockedDomains: ["c.org"],
    });
  });

  test("maps DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY as a false-only switch", () => {
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY: "true" })).toEqual({});
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY: "1" })).toEqual({});
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY: "false" })).toEqual({
      allowUnknownAuthority: false,
    });
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_ALLOW_UNKNOWN_AUTHORITY: "0" })).toEqual({
      allowUnknownAuthority: false,
    });
  });

  test("keeps fetchBlockPrivateHosts on by default and only disables it explicitly", () => {
    expect(pluginOptionsFromEnv({ DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS: "true" })).toEqual({});
    expect(pluginOptionsFromEnv({ DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS: "false" })).toEqual({
      fetchBlockPrivateHosts: false,
    });
    expect(pluginOptionsFromEnv({ DEEPSEEK_FETCH_BLOCK_PRIVATE_HOSTS: "0" })).toEqual({
      fetchBlockPrivateHosts: false,
    });
  });

  test("maps DEEPSEEK_ENABLE_SEARCH/FETCH as false-only tool switches", () => {
    expect(pluginOptionsFromEnv({ DEEPSEEK_ENABLE_SEARCH: "true", DEEPSEEK_ENABLE_FETCH: "1" })).toEqual({});
    expect(pluginOptionsFromEnv({ DEEPSEEK_ENABLE_SEARCH: "false" })).toEqual({ searchEnabled: false });
    expect(pluginOptionsFromEnv({ DEEPSEEK_ENABLE_FETCH: "0" })).toEqual({ fetchEnabled: false });
    expect(pluginOptionsFromEnv({ DEEPSEEK_ENABLE_SEARCH: "no", DEEPSEEK_ENABLE_FETCH: "off" })).toEqual({
      searchEnabled: false,
      fetchEnabled: false,
    });
    expect(resolveEnvOptions({ DEEPSEEK_ENABLE_SEARCH: "false" }).search.enabled).toBe(false);
    expect(resolveEnvOptions({}).fetch.enabled).toBe(true);
  });

  test("passes language text through", () => {
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_LANGUAGE: "zh" })).toEqual({ language: "zh" });
  });

  test("maps DEEPSEEK_SEARCH_LOCALIZATION text through for shared validation", () => {
    expect(pluginOptionsFromEnv({ DEEPSEEK_SEARCH_LOCALIZATION: "203.0.113.7" })).toEqual({
      searchLocalization: "203.0.113.7",
    });
    expect(resolveEnvOptions({ DEEPSEEK_SEARCH_LOCALIZATION: " 2001:db8::1 " }).search.localization).toBe(
      "2001:db8::1",
    );
    expect(resolveEnvOptions({ DEEPSEEK_SEARCH_LOCALIZATION: "example.com" }).search.localization).toBeUndefined();
    expect(resolveEnvOptions({ DEEPSEEK_SEARCH_LOCALIZATION: "  " }).search.localization).toBeUndefined();
  });
});

describe("resolveEnvOptions", () => {
  test("clamps values through the shared option pipeline", () => {
    const resolved = resolveEnvOptions({ DEEPSEEK_SEARCH_COUNT: "999", DEEPSEEK_SEARCH_MAX_RESULTS: "-3" });
    expect(resolved.search.count).toBe(50);
    expect(resolved.search.maxResults).toBe(0);
  });

  test("uses shared defaults for an empty environment", () => {
    const resolved = resolveEnvOptions({});
    expect(resolved.search.maxResults).toBe(10);
    expect(resolved.fetch.maxChars).toBe(16000);
    expect(resolved.retry.maxRetries).toBe(2);
  });

  test("layers file options beneath environment options", () => {
    const resolved = resolveEnvOptions(
      { DEEPSEEK_SEARCH_COUNT: "30", DEEPSEEK_SEARCH_LANGUAGE: "en" },
      {
        count: 20,
        language: "zh",
        maxResults: 5,
      },
    );
    // Same key: the environment wins. Key the environment lacks: the file applies.
    expect(resolved.search.count).toBe(30);
    expect(resolved.search.language).toBe("en");
    expect(resolved.search.maxResults).toBe(5);
  });

  test("file options alone still resolve over the built-in defaults", () => {
    const resolved = resolveEnvOptions({}, { count: 20 });
    expect(resolved.search.count).toBe(20);
    // maxResults was set by no layer, so it follows the effective count.
    expect(resolved.search.maxResults).toBe(20);
  });

  test("maxResults follows a count delivered by the environment alone", () => {
    const resolved = resolveEnvOptions({ DEEPSEEK_SEARCH_COUNT: "20" });
    expect(resolved.search.count).toBe(20);
    expect(resolved.search.maxResults).toBe(20);
  });
});
