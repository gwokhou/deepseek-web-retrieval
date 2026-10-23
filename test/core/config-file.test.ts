import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFilePath, readFileOptions, SHARED_CONFIG_KEYS, sharedFileOptions } from "../../src/core/config-file";

/** Captures console.error lines so warnings are asserted, not just tolerated. */
function captureErrors<T>(run: () => T): { lines: string[]; result: T } {
  const lines: string[] = [];
  const originalError = console.error;
  console.error = (line: string) => lines.push(line);
  try {
    return { lines, result: run() };
  } finally {
    console.error = originalError;
  }
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "dwr-config-"));
}

describe("configFilePath", () => {
  test("honors a non-empty XDG_CONFIG_HOME", () => {
    expect(configFilePath({ XDG_CONFIG_HOME: "/custom/xdg" }, "/home/u")).toBe(
      join("/custom/xdg", "deepseek-web-retrieval", "config.json"),
    );
  });

  test("falls back to <home>/.config when XDG_CONFIG_HOME is empty or unset", () => {
    const expected = join("/home/u", ".config", "deepseek-web-retrieval", "config.json");
    expect(configFilePath({ XDG_CONFIG_HOME: "" }, "/home/u")).toBe(expected);
    expect(configFilePath({}, "/home/u")).toBe(expected);
  });
});

describe("readFileOptions", () => {
  test("a missing file is normal: silent and empty", () => {
    const { lines, result } = captureErrors(() => readFileOptions(join(tempDir(), "config.json")));
    expect(result).toEqual({});
    expect(lines).toEqual([]);
  });

  test("an unparseable file warns once, naming the file, and contributes nothing", () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(file, "{ not json");
    const { lines, result } = captureErrors(() => readFileOptions(file));
    expect(result).toEqual({});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(file);
    expect(lines[0]).toContain("not valid JSON");
  });

  test("a non-object root warns once and contributes nothing", () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify(["count"]));
    const { lines, result } = captureErrors(() => readFileOptions(file));
    expect(result).toEqual({});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(file);
    expect(lines[0]).toContain("not a JSON object");
  });

  test("an unknown key warns once and is dropped", () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ retries: 3, count: 20 }));
    const { lines, result } = captureErrors(() => readFileOptions(file));
    expect(result).toEqual({ count: 20 });
    expect(lines).toEqual(['deepseek-web-retrieval config: unknown key "retries" — ignored']);
  });

  test("each host-integration key warns and is rejected", () => {
    const hostIntegration = {
      searchEnabled: false,
      fetchEnabled: false,
      setDefaultWebsearch: true,
      fetchOverrideWebfetch: true,
      fetchRegisterTool: true,
      apiKeySource: "opencode",
    };
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ ...hostIntegration, count: 20 }));
    const { lines, result } = captureErrors(() => readFileOptions(file));
    expect(result).toEqual({ count: 20 });
    expect(lines).toHaveLength(Object.keys(hostIntegration).length);
    for (const key of Object.keys(hostIntegration)) {
      const line = lines.find((entry) => entry.includes(`"${key}"`));
      expect(line).toContain("host-integration key (host config only)");
    }
  });

  test("accepted keys pass through raw, without validation", () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ count: "not-a-number-yet", language: "zh" }));
    const { lines, result } = captureErrors(() => readFileOptions(file));
    expect(result).toEqual({ count: "not-a-number-yet", language: "zh" });
    expect(lines).toEqual([]);
  });

  test("the full accepted-key list round-trips", () => {
    const accepted = {
      count: 20,
      maxResults: 5,
      minRerank: 1.5,
      minAuthority: 2,
      allowUnknownAuthority: false,
      blockedDomains: ["pinterest.com"],
      includeDomains: ["docs.example.com"],
      language: "zh",
      searchLocalization: "203.0.113.7",
      maxSummaryChars: 800,
      searchTimeoutMs: 15000,
      fetchMaxChars: 4000,
      fetchAllowedDomains: ["a.org"],
      fetchBlockedDomains: ["b.org"],
      fetchTimeoutMs: 10000,
      fetchBlockPrivateHosts: false,
      maxRetries: 2,
      retryBaseDelayMs: 500,
    };
    // The constant and the vocabulary it promises stay in lockstep.
    const listed: string[] = [...SHARED_CONFIG_KEYS].sort();
    expect(listed).toEqual(Object.keys(accepted).sort());

    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify(accepted));
    const { lines, result } = captureErrors(() => readFileOptions(file));
    expect(result).toEqual(accepted);
    expect(lines).toEqual([]);
  });
});

describe("sharedFileOptions", () => {
  test("computes the path for the given environment and reads it", () => {
    const xdg = tempDir();
    mkdirSync(join(xdg, "deepseek-web-retrieval"), { recursive: true });
    writeFileSync(join(xdg, "deepseek-web-retrieval", "config.json"), JSON.stringify({ count: 20 }));
    const { lines, result } = captureErrors(() => sharedFileOptions({ XDG_CONFIG_HOME: xdg }, "/home/u"));
    expect(result).toEqual({ count: 20 });
    expect(lines).toEqual([]);
  });

  test("a missing file in the computed location stays silent", () => {
    const { lines, result } = captureErrors(() => sharedFileOptions({ XDG_CONFIG_HOME: tempDir() }, "/home/u"));
    expect(result).toEqual({});
    expect(lines).toEqual([]);
  });
});
