import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configFilePath,
  readFileOptions,
  SHARED_CONFIG_KEYS,
  sharedFileOptions,
  userConfigDir,
  userConfigHome,
} from "../../src/core/config-file";

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

describe("userConfigHome", () => {
  test("a non-empty XDG_CONFIG_HOME wins on every platform, win32 included", () => {
    expect(userConfigHome({ XDG_CONFIG_HOME: "/custom/xdg" }, "/home/u")).toBe("/custom/xdg");
    expect(userConfigHome({ XDG_CONFIG_HOME: "C:\\custom\\xdg" }, "C:\\Users\\u", "win32")).toBe("C:\\custom\\xdg");
  });

  test("win32: %APPDATA% applies when XDG_CONFIG_HOME is unset or empty", () => {
    const appdata = "C:\\Users\\u\\AppData\\Roaming";
    expect(userConfigHome({ APPDATA: appdata }, "C:\\Users\\u", "win32")).toBe(appdata);
    expect(userConfigHome({ XDG_CONFIG_HOME: "", APPDATA: appdata }, "C:\\Users\\u", "win32")).toBe(appdata);
  });

  test("win32: unset or empty %APPDATA% falls back to <home>\\AppData\\Roaming", () => {
    const expected = "C:\\Users\\u\\AppData\\Roaming";
    expect(userConfigHome({}, "C:\\Users\\u", "win32")).toBe(expected);
    expect(userConfigHome({ APPDATA: "" }, "C:\\Users\\u", "win32")).toBe(expected);
  });

  test("other platforms keep the XDG default <home>/.config", () => {
    expect(userConfigHome({}, "/home/u", "linux")).toBe(join("/home/u", ".config"));
    expect(userConfigHome({}, "/home/u", "darwin")).toBe(join("/home/u", ".config"));
    // %APPDATA% is not a convention outside win32; it must not leak in.
    expect(userConfigHome({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "/home/u", "linux")).toBe(
      join("/home/u", ".config"),
    );
  });
});

describe("configFilePath", () => {
  test("posix: unchanged — XDG honored, default <home>/.config", () => {
    expect(configFilePath({ XDG_CONFIG_HOME: "/custom/xdg" }, "/home/u")).toBe(
      join("/custom/xdg", "deepseek-web-retrieval", "config.json"),
    );
    const expected = join("/home/u", ".config", "deepseek-web-retrieval", "config.json");
    expect(configFilePath({ XDG_CONFIG_HOME: "" }, "/home/u")).toBe(expected);
    expect(configFilePath({}, "/home/u")).toBe(expected);
    expect(configFilePath({ XDG_CONFIG_HOME: "/custom/xdg" }, "/home/u", "linux")).toBe(
      join("/custom/xdg", "deepseek-web-retrieval", "config.json"),
    );
  });

  test("win32: config.json under %APPDATA% with backslash separators", () => {
    expect(configFilePath({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "C:\\Users\\u", "win32")).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\deepseek-web-retrieval\\config.json",
    );
  });

  test("win32: a pinned XDG_CONFIG_HOME wins over %APPDATA%", () => {
    expect(
      configFilePath(
        { XDG_CONFIG_HOME: "D:\\xdg", APPDATA: "C:\\Users\\u\\AppData\\Roaming" },
        "C:\\Users\\u",
        "win32",
      ),
    ).toBe("D:\\xdg\\deepseek-web-retrieval\\config.json");
  });

  test("win32: without %APPDATA%, <home>\\AppData\\Roaming applies", () => {
    expect(configFilePath({}, "C:\\Users\\u", "win32")).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\deepseek-web-retrieval\\config.json",
    );
  });

  test("userConfigDir is the shared-file directory under the same root", () => {
    expect(userConfigDir({}, "/home/u")).toBe(join("/home/u", ".config", "deepseek-web-retrieval"));
    expect(userConfigDir({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "C:\\Users\\u", "win32")).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\deepseek-web-retrieval",
    );
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
