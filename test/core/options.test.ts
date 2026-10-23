import { describe, expect, test } from "bun:test";
import {
  resolveAuthOptions,
  resolveFetchOptions,
  resolveFetchTimeoutMs,
  resolvePluginOptions,
  resolveRetryOptions,
  resolveSearchOptions,
} from "../../src/core/options";

describe("resolve options", () => {
  test("uses documented defaults", () => {
    expect(resolvePluginOptions(undefined)).toEqual({
      search: {
        count: 10,
        maxResults: 10,
        minRerank: 0,
        minAuthority: 0,
        allowUnknownAuthority: true,
        blockedDomains: [],
        includeDomains: [],
        language: undefined,
        localization: undefined,
        maxSummaryChars: 1200,
        timeoutMs: 30000,
        enabled: true,
      },
      fetch: {
        maxChars: 16000,
        allowedDomains: [],
        blockedDomains: [],
        timeoutMs: 30000,
        blockPrivateHosts: true,
        enabled: true,
      },
      auth: { source: "auto" },
      retry: { maxRetries: 2, baseDelayMs: 250 },
    });
  });

  test("clamps numbers and ignores invalid types", () => {
    const options = resolveSearchOptions({
      count: 0,
      maxResults: 99,
      minRerank: "high",
      minAuthority: Number.NaN,
      maxSummaryChars: -1,
      searchTimeoutMs: 5,
      allowUnknownAuthority: "yes",
    });
    expect(options.count).toBe(1);
    expect(options.maxResults).toBe(50);
    expect(options.minRerank).toBe(0);
    expect(options.minAuthority).toBe(0);
    expect(options.maxSummaryChars).toBe(0);
    expect(options.timeoutMs).toBe(1000);
    expect(options.allowUnknownAuthority).toBe(true);
  });

  test("keeps unknown-authority results unless disabled explicitly", () => {
    expect(resolveSearchOptions({}).allowUnknownAuthority).toBe(true);
    expect(resolveSearchOptions({ allowUnknownAuthority: false }).allowUnknownAuthority).toBe(false);
  });

  test("maxResults defaults to the effective count when not explicitly set", () => {
    // Neither set: both built-in defaults.
    const neither = resolveSearchOptions({});
    expect(neither.count).toBe(10);
    expect(neither.maxResults).toBe(10);
    // Only count set: maxResults follows, so raising count alone returns more.
    const onlyCount = resolveSearchOptions({ count: 20 });
    expect(onlyCount.count).toBe(20);
    expect(onlyCount.maxResults).toBe(20);
    // Only maxResults set: count stays at its default — you cannot return
    // more than was fetched.
    const onlyMaxResults = resolveSearchOptions({ maxResults: 5 });
    expect(onlyMaxResults.count).toBe(10);
    expect(onlyMaxResults.maxResults).toBe(5);
    // Both set: both honored; results = min.
    const both = resolveSearchOptions({ count: 20, maxResults: 5 });
    expect(both.count).toBe(20);
    expect(both.maxResults).toBe(5);
  });

  test("maxResults follows the clamped count, not the raw value", () => {
    const options = resolveSearchOptions({ count: 99 });
    expect(options.count).toBe(50);
    expect(options.maxResults).toBe(50);
  });

  test("an unset maxResults follows count only when count itself was set", () => {
    // Invalid count falls back like an unset one, so maxResults keeps DEFAULT_MAX_RESULTS.
    const invalidCount = resolveSearchOptions({ count: "many" });
    expect(invalidCount.count).toBe(10);
    expect(invalidCount.maxResults).toBe(10);
    // An invalid maxResults falls back to the count-derived default.
    const invalidMaxResults = resolveSearchOptions({ count: 20, maxResults: "all" });
    expect(invalidMaxResults.maxResults).toBe(20);
  });

  test("normalizes domains and language", () => {
    const options = resolveSearchOptions({
      blockedDomains: ["https://Pinterest.com/path", 42],
      includeDomains: ["nodejs.org"],
      language: " zh,en ",
    });
    expect(options.blockedDomains).toEqual(["pinterest.com"]);
    expect(options.includeDomains).toEqual(["nodejs.org"]);
    expect(options.language).toBe("zh,en");
  });

  test("keeps only valid IPv4/IPv6 addresses as localization", () => {
    expect(resolveSearchOptions({ searchLocalization: "127.0.0.1" }).localization).toBe("127.0.0.1");
    expect(resolveSearchOptions({ searchLocalization: " 2001:db8::1 " }).localization).toBe("2001:db8::1");
    expect(resolveSearchOptions({ searchLocalization: "::1" }).localization).toBe("::1");
    expect(resolveSearchOptions({ searchLocalization: "::ffff:192.168.0.1" }).localization).toBe("::ffff:192.168.0.1");
    const invalid = ["foo", "", "   ", "example.com", "999.1.1.1", "1.2.3", "01.2.3.4", "1::2::3", "fe80::1%eth0", 42];
    for (const value of invalid) {
      expect(resolveSearchOptions({ searchLocalization: value }).localization).toBeUndefined();
    }
    expect(resolveSearchOptions({}).localization).toBeUndefined();
  });

  test("resolves fetch safety limits", () => {
    expect(resolveFetchOptions({ fetchBlockPrivateHosts: false }).blockPrivateHosts).toBe(false);
    expect(resolveFetchOptions({ fetchMaxChars: -1 }).maxChars).toBe(0);
    expect(resolveFetchOptions({ fetchTimeoutMs: 999_999 }).timeoutMs).toBe(120000);
  });

  test("keeps capabilities enabled by default and disables them explicitly", () => {
    expect(resolveSearchOptions({}).enabled).toBe(true);
    expect(resolveSearchOptions({ searchEnabled: false }).enabled).toBe(false);
    expect(resolveSearchOptions({ searchEnabled: "false" }).enabled).toBe(true);
    expect(resolveFetchOptions({}).enabled).toBe(true);
    expect(resolveFetchOptions({ fetchEnabled: false }).enabled).toBe(false);
  });

  test("validates auth source and retry settings", () => {
    expect(resolveAuthOptions({ apiKeySource: "env" }).source).toBe("env");
    expect(resolveAuthOptions({ apiKeySource: "opencode" }).source).toBe("opencode");
    expect(resolveAuthOptions({ apiKeySource: "nonsense" }).source).toBe("auto");
    expect(resolveRetryOptions({ maxRetries: 99 }).maxRetries).toBe(5);
    expect(resolveRetryOptions({ maxRetries: -1 }).maxRetries).toBe(0);
    expect(resolveRetryOptions({ retryBaseDelayMs: 1 }).baseDelayMs).toBe(1);
  });

  test("resolves the shorter of the plugin and per-call timeout", () => {
    expect(resolveFetchTimeoutMs(30000, 5)).toBe(5000);
    expect(resolveFetchTimeoutMs(30000, 60)).toBe(30000);
    expect(resolveFetchTimeoutMs(30000, 0.001)).toBe(1);
    expect(resolveFetchTimeoutMs(30000, 0)).toBe(30000);
    expect(resolveFetchTimeoutMs(30000, "5")).toBe(30000);
  });
});
