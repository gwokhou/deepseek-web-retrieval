import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPlan } from "../../src/installer/apply";
import { writeConfig } from "../../src/installer/formats";
import { planForHost } from "../../src/installer/hosts";
import { withOperationLock } from "../../src/installer/operation-lock";
import {
  deleteRecord,
  listRecords,
  readingLegacyGlobalRecords,
  readRecord,
  statePathFor,
  writeRecord,
} from "../../src/installer/state";
import type { InstallerInput, InstallRecord } from "../../src/installer/types";
import { uninstall } from "../../src/installer/uninstall";

test("config replacement keeps the old bytes on failure before rename", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "dwr-atomic-"));
  const file = join(dir, "config.json");
  fs.writeFileSync(file, "old complete contents", { mode: 0o640 });
  const rename = spyOn(fs, "renameSync").mockImplementation(() => {
    throw new Error("injected rename failure");
  });
  try {
    expect(() => writeConfig(file, "new complete contents")).toThrow("injected rename failure");
    expect(fs.readFileSync(file, "utf8")).toBe("old complete contents");
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  } finally {
    rename.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("atomic replacement preserves permissions and follows an existing symlink", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "dwr-atomic-"));
  try {
    const target = join(dir, "target.json");
    const link = join(dir, "config.json");
    fs.writeFileSync(target, "old", { mode: 0o640 });
    fs.symlinkSync(target, link);
    writeConfig(link, "new");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(dir).sort()).toEqual(["config.json", "target.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("another process holding an operation lock excludes apply and uninstall, then permits retry", async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "dwr-lock-"));
  const input: InstallerInput = {
    host: "pi",
    scope: "project",
    search: "optional",
    fetch: "optional",
    packageRef: "deepseek-web-retrieval",
    home: root,
    cwd: root,
  };
  const plan = planForHost(input.host, input);
  const ready = join(root, "ready");
  const release = join(root, "release");
  const code = `import { withOperationLock } from ${JSON.stringify(join(import.meta.dir, "../../src/installer/operation-lock.ts"))};
    import { writeFileSync, existsSync } from "node:fs";
    withOperationLock([${JSON.stringify(statePathFor(input))}], () => {
      writeFileSync(${JSON.stringify(ready)}, "ready");
      const deadline = Date.now() + 10000;
      while (!existsSync(${JSON.stringify(release)}) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    });`;
  const child = Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe" });
  try {
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await Bun.sleep(10);
    expect(fs.existsSync(ready)).toBe(true);
    expect(() => applyPlan(plan, input)).toThrow("operation is locked");
    expect(() => uninstall(input)).toThrow("operation is locked");
    const edit = plan.edits[0];
    if (!edit) throw new Error("Expected a planned config edit");
    expect(fs.existsSync(edit.file)).toBe(false);
    fs.writeFileSync(release, "release");
    expect(await child.exited).toBe(0);
    expect(applyPlan(plan, input).lines.length).toBeGreaterThan(0);
    uninstall(input);
    expect(fs.existsSync(statePathFor(input))).toBe(false);
    expect(fs.existsSync(join(root, ".deepseek-web-retrieval"))).toBe(false);
  } finally {
    child.kill();
    await child.exited;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an interrupted temporary write never replaces config and cleans up its private temporary file", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "dwr-atomic-"));
  const file = join(dir, "config.json");
  fs.writeFileSync(file, "old bytes");
  const write = fs.writeFileSync;
  const writes = spyOn(fs, "writeFileSync").mockImplementation((target, data, options) => {
    if (typeof target === "number") {
      write(target, "partial");
      throw new Error("injected interrupted write");
    }
    return write(target, data, options);
  });
  try {
    expect(() => writeConfig(file, "complete new bytes")).toThrow("injected interrupted write");
    expect(fs.readFileSync(file, "utf8")).toBe("old bytes");
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  } finally {
    writes.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("install records remain private and keep their prior snapshot when replacement fails", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "dwr-record-"));
  const input: InstallerInput = {
    host: "pi",
    scope: "project",
    search: "optional",
    fetch: "optional",
    packageRef: "deepseek-web-retrieval",
    home: root,
    cwd: root,
  };
  try {
    applyPlan(planForHost(input.host, input), input);
    const record = readRecord(input);
    if (!record) throw new Error("Expected install record");
    const before = fs.readFileSync(statePathFor(input), "utf8");
    expect(fs.statSync(statePathFor(input)).mode & 0o777).toBe(0o600);
    const rename = spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("record rename failed");
    });
    try {
      expect(() => writeRecord(input, { ...record, createdAt: new Date().toISOString() })).toThrow(
        "record rename failed",
      );
      expect(fs.readFileSync(statePathFor(input), "utf8")).toBe(before);
      expect(fs.readdirSync(join(root, ".deepseek-web-retrieval"))).toEqual(["install.pi.json"]);
    } finally {
      rename.mockRestore();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a shared config operation lock excludes another project and symlink aliases", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "dwr-shared-lock-"));
  const input: InstallerInput = {
    host: "codex",
    scope: "project",
    search: "optional",
    fetch: "optional",
    packageRef: "deepseek-web-retrieval",
    home: root,
    cwd: join(root, "project"),
  };
  fs.mkdirSync(input.cwd);
  const config = join(root, ".codex/config.toml");
  fs.mkdirSync(join(root, ".codex"));
  fs.writeFileSync(config, 'model = "example"\n');
  const alias = join(root, "config-alias");
  fs.symlinkSync(config, alias);
  try {
    const plan = planForHost(input.host, input);
    withOperationLock([alias], () => {
      expect(() => applyPlan(plan, input)).toThrow("operation is locked");
      expect(fs.readFileSync(config, "utf8")).toBe('model = "example"\n');
      expect(readRecord(input)).toBeUndefined();
    });
    expect(applyPlan(plan, input).lines.length).toBeGreaterThan(0);
    withOperationLock([alias], () => {
      expect(() => uninstall(input)).toThrow("operation is locked");
      expect(readRecord(input)).toBeDefined();
    });
    uninstall(input);
    expect(fs.readFileSync(config, "utf8").trim()).toBe('model = "example"');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("win32 legacy global records", () => {
  /** A pre-%APPDATA% install (record under ~/.config) and its post-switch self. */
  function preAppdataInstall(): { legacy: InstallerInput; current: InstallerInput } {
    const home = fs.mkdtempSync(join(tmpdir(), "dwr-preappdata-"));
    const legacy: InstallerInput = {
      host: "pi",
      scope: "global",
      search: "optional",
      fetch: "optional",
      packageRef: "deepseek-web-retrieval",
      home,
      cwd: fs.mkdtempSync(join(tmpdir(), "dwr-preappdata-cwd-")),
    };
    const current: InstallerInput = {
      ...legacy,
      configHome: fs.mkdtempSync(join(tmpdir(), "dwr-preappdata-appdata-")),
      platform: "win32",
    };
    return { legacy, current };
  }

  function recordFor(input: InstallerInput, createdAt: string): InstallRecord {
    return {
      version: 1,
      host: input.host,
      scope: input.scope,
      tiers: { search: "optional", fetch: "optional" },
      createdAt,
      files: [],
    };
  }

  test("readRecord finds a legacy global record on win32, and only on win32", () => {
    const { legacy, current } = preAppdataInstall();
    try {
      writeRecord(legacy, recordFor(legacy, "2026-01-01T00:00:00.000Z"));
      expect(fs.existsSync(statePathFor(current))).toBe(false);
      expect(readRecord(current)?.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(readRecord({ ...current, platform: undefined })).toBeUndefined();
    } finally {
      fs.rmSync(legacy.home, { recursive: true, force: true });
      fs.rmSync(current.cwd, { recursive: true, force: true });
      fs.rmSync(current.configHome ?? "", { recursive: true, force: true });
    }
  });

  test("a canonical record wins once one exists; listRecords never double-lists", () => {
    const { legacy, current } = preAppdataInstall();
    try {
      writeRecord(legacy, recordFor(legacy, "2026-01-01T00:00:00.000Z"));
      expect(readingLegacyGlobalRecords(current)).toBe(true);
      expect(listRecords(current).map((record) => record.createdAt)).toEqual(["2026-01-01T00:00:00.000Z"]);

      writeRecord(current, recordFor(current, "2026-06-01T00:00:00.000Z"));
      expect(readingLegacyGlobalRecords(current)).toBe(false);
      expect(readRecord(current)?.createdAt).toBe("2026-06-01T00:00:00.000Z");
      expect(listRecords(current).map((record) => record.createdAt)).toEqual(["2026-06-01T00:00:00.000Z"]);
    } finally {
      fs.rmSync(legacy.home, { recursive: true, force: true });
      fs.rmSync(current.cwd, { recursive: true, force: true });
      fs.rmSync(current.configHome ?? "", { recursive: true, force: true });
    }
  });

  test("deleteRecord removes the legacy file a win32 read found", () => {
    const { legacy, current } = preAppdataInstall();
    try {
      writeRecord(legacy, recordFor(legacy, "2026-01-01T00:00:00.000Z"));
      expect(readRecord(current)).toBeDefined();
      deleteRecord(current);
      expect(fs.existsSync(statePathFor(legacy))).toBe(false);
      expect(fs.existsSync(statePathFor(current))).toBe(false);
    } finally {
      fs.rmSync(legacy.home, { recursive: true, force: true });
      fs.rmSync(current.cwd, { recursive: true, force: true });
      fs.rmSync(current.configHome ?? "", { recursive: true, force: true });
    }
  });

  test("project-scope records never fall back, on any platform", () => {
    const { legacy, current } = preAppdataInstall();
    try {
      writeRecord(legacy, recordFor(legacy, "2026-01-01T00:00:00.000Z"));
      const project: InstallerInput = {
        ...legacy,
        scope: "project",
        configHome: current.configHome,
        platform: "win32",
      };
      // The fallback is for reading global tracking, never a project record's own path.
      expect(readRecord(project)).toBeUndefined();
      expect(fs.existsSync(join(project.cwd, ".deepseek-web-retrieval"))).toBe(false);
    } finally {
      fs.rmSync(legacy.home, { recursive: true, force: true });
      fs.rmSync(legacy.cwd, { recursive: true, force: true });
      fs.rmSync(current.configHome ?? "", { recursive: true, force: true });
    }
  });

  test("non-win32 platforms never read the legacy location behind an explicit config home", () => {
    const { legacy, current } = preAppdataInstall();
    try {
      writeRecord(legacy, recordFor(legacy, "2026-01-01T00:00:00.000Z"));
      const rooted = { ...current, platform: undefined } as const;
      expect(readRecord(rooted)).toBeUndefined();
      expect(readingLegacyGlobalRecords(rooted)).toBe(false);
      expect(listRecords(rooted)).toEqual([]);
    } finally {
      fs.rmSync(legacy.home, { recursive: true, force: true });
      fs.rmSync(current.cwd, { recursive: true, force: true });
      fs.rmSync(current.configHome ?? "", { recursive: true, force: true });
    }
  });
});
