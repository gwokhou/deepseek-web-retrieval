import { describe, expect, test } from "bun:test";
import { configDeviations } from "../../src/core/config-summary";
import { resolveEnvOptions } from "../../src/core/env";
import { resolvePluginOptions } from "../../src/core/options";

describe("configDeviations", () => {
  test("empty when the resolved config matches the built-in defaults", () => {
    expect(configDeviations(resolvePluginOptions({}))).toBe("");
    expect(configDeviations(resolveEnvOptions({}))).toBe("");
  });

  test("renders scalar deviations with config-vocabulary names", () => {
    const resolved = resolvePluginOptions({
      count: 20,
      language: "zh",
      searchLocalization: "203.0.113.7",
      retryBaseDelayMs: 500,
    });
    expect(configDeviations(resolved)).toBe("count=20 language=zh searchLocalization=203.0.113.7 retryBaseDelayMs=500");
  });

  test("renders booleans as key=false / key=true", () => {
    const resolved = resolvePluginOptions({ allowUnknownAuthority: false, fetchBlockPrivateHosts: false });
    expect(configDeviations(resolved)).toBe("allowUnknownAuthority=false fetchBlockPrivateHosts=false");
  });

  test("renders arrays as their length", () => {
    const resolved = resolvePluginOptions({ blockedDomains: ["pinterest.com", "x.com"], includeDomains: ["a.org"] });
    expect(configDeviations(resolved)).toBe("blockedDomains=2 includeDomains=1");
  });

  test("an empty array is not a deviation", () => {
    expect(configDeviations(resolvePluginOptions({ blockedDomains: [] }))).toBe("");
  });

  test("excludes host-integration fields: enabled flags and apiKeySource", () => {
    const resolved = resolvePluginOptions({ searchEnabled: false, fetchEnabled: false, apiKeySource: "opencode" });
    expect(configDeviations(resolved)).toBe("");
  });

  test("shows deviations produced by the environment layer", () => {
    expect(configDeviations(resolveEnvOptions({ DEEPSEEK_SEARCH_COUNT: "20" }))).toBe("count=20");
  });
});
