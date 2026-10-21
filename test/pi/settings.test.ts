import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readExtensionSettings, SETTINGS_NAMESPACE } from "../../src/pi/settings";

describe("pi extension settings namespace", () => {
  test("reads the namespace with project over global and ignores other files", () => {
    const home = mkdtempSync(join(tmpdir(), "dwr-pi-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "dwr-pi-cwd-"));
    mkdirSync(join(home, ".pi/agent"), { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(home, ".pi/agent/settings.json"),
      JSON.stringify({ packages: ["npm:x"], [SETTINGS_NAMESPACE]: { enableSearch: false } }),
    );
    writeFileSync(
      join(cwd, ".pi/settings.json"),
      JSON.stringify({ [SETTINGS_NAMESPACE]: { enableSearch: true, enableFetch: false } }),
    );

    // The project file wins where it speaks; its true is dropped (only false is meaningful).
    expect(readExtensionSettings(home, cwd)).toEqual({ enableFetch: false });
  });

  test("missing, unparseable, or wrong-shaped files contribute nothing", () => {
    const home = mkdtempSync(join(tmpdir(), "dwr-pi-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "dwr-pi-cwd-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi/settings.json"), "{ not json");
    expect(readExtensionSettings(home, cwd)).toEqual({});

    writeFileSync(join(cwd, ".pi/settings.json"), JSON.stringify([SETTINGS_NAMESPACE]));
    expect(readExtensionSettings(home, cwd)).toEqual({});

    writeFileSync(join(cwd, ".pi/settings.json"), JSON.stringify({ [SETTINGS_NAMESPACE]: "nope" }));
    expect(readExtensionSettings(home, cwd)).toEqual({});
  });

  test("only explicit false lands; true and other shapes are dropped", () => {
    const home = mkdtempSync(join(tmpdir(), "dwr-pi-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "dwr-pi-cwd-"));
    mkdirSync(join(home, ".pi/agent"), { recursive: true });
    writeFileSync(
      join(home, ".pi/agent/settings.json"),
      JSON.stringify({ [SETTINGS_NAMESPACE]: { enableSearch: true, enableFetch: false, extra: "x" } }),
    );
    expect(readExtensionSettings(home, cwd)).toEqual({ enableFetch: false });
  });
});
