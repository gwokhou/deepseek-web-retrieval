import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  readFileSync as fsReadFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseJsonc } from "../../src/core/jsonc";
import { applyPlan } from "../../src/installer/apply";
import { runInstallerCli } from "../../src/installer/cli";
import { codecFor } from "../../src/installer/formats";
import { applyJsonOps, revertJsonOps } from "../../src/installer/formats/json";
import { buildRulesBlock, hasBlock, removeBlock, upsertBlock } from "../../src/installer/formats/rules";
import { hasTomlComment } from "../../src/installer/formats/toml";
import { planForHost } from "../../src/installer/hosts";
import { parseCodexVersion, planCodex } from "../../src/installer/hosts/codex";
import { planOpenCode } from "../../src/installer/hosts/opencode";
import { planPi } from "../../src/installer/hosts/pi";
import { renderPlan } from "../../src/installer/render";
import { claimedByOtherScope, listRecords, readRecord, writeRecord } from "../../src/installer/state";
import type { ConfigOp, InstallerInput, JsonEdit, RecordedFile, RulesEdit, TomlEdit } from "../../src/installer/types";
import { uninstall } from "../../src/installer/uninstall";

const homes: string[] = [];
const cwds: string[] = [];

afterEach(() => {
  // Temp dirs are left for the OS cleaner; nothing to restore process-wide.
  homes.length = 0;
  cwds.length = 0;
});

function makeInput(
  host: InstallerInput["host"],
  scope: InstallerInput["scope"],
  search: InstallerInput["search"],
  fetch: InstallerInput["fetch"],
  path?: "extension" | "mcp",
): InstallerInput {
  const home = mkdtempSync(join(tmpdir(), "dwr-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "dwr-cwd-"));
  homes.push(home);
  cwds.push(cwd);
  return {
    host,
    scope,
    search,
    fetch,
    packageRef: "deepseek-web-retrieval",
    home,
    cwd,
    ...(path !== undefined ? { path } : {}),
  };
}

describe("json config editing", () => {
  test("applyJsonOps preserves comments and is idempotent", () => {
    const text = `{\n  // keep me\n  "a": 1,\n}\n`;
    const ops = [
      { op: "append-array", path: ["plugins"], entries: [{ package: "x" }] },
      { op: "set", path: ["websearch", "provider"], value: "deepseek" },
    ] as const;
    const first = applyJsonOps(text, [...ops]);
    expect(first.text).toContain("// keep me");
    const second = applyJsonOps(first.text, [...ops]);
    expect(second.recorded[0]?.applied).toEqual([]);
    expect(second.text).toBe(first.text);
  });

  test("revertJsonOps restores snapshots and leaves user-modified values untouched", () => {
    const text = `{\n  "websearch": { "provider": "tavily" },\n  "permissions": [{ "action": "bash" }],\n}\n`;
    const applied = applyJsonOps(text, [
      { op: "set", path: ["websearch", "provider"], value: "deepseek" },
      { op: "append-array", path: ["permissions"], entries: [{ action: "websearch" }] },
    ]);
    // The user changes the provider again after the install.
    const userEdited = applyJsonOps(applied.text, [{ op: "set", path: ["websearch", "provider"], value: "exa" }]);
    const reverted = revertJsonOps(userEdited.text, applied.recorded, applied.createdParents);
    const value = parseJsonc(reverted.text) as { websearch: { provider: string }; permissions: { action: string }[] };
    expect(value.websearch.provider).toBe("exa"); // user edit wins
    expect(value.permissions).toEqual([{ action: "bash" }]); // our entry still removed
    expect(reverted.notes.join(" ")).toContain("left untouched");
  });
});

describe("rules blocks", () => {
  const block = buildRulesBlock("pi", ["line one", "line two"]);

  test("upsert appends to a new file and replaces an existing block without duplicating", () => {
    expect(upsertBlock("pi", "", block)).toBe(`${block}\n`);
    const once = upsertBlock("pi", "# project rules\n", block);
    expect(hasBlock("pi", once)).toBe(true);
    expect(once).toContain("# project rules");
    const twice = upsertBlock("pi", once, buildRulesBlock("pi", ["changed"]));
    expect(twice.match(/deepseek-web-retrieval:pi:rules:begin/g)?.length).toBe(1);
    expect(twice).toContain("changed");
    expect(removeBlock("pi", twice)).toBe("# project rules\n");
  });

  test("removing a block between content keeps exactly one blank separator line", () => {
    const text = `# top\n\n${block}\n\n# bottom\n`;
    expect(removeBlock("pi", text)).toBe("# top\n\n# bottom\n");
  });
});

describe("plans", () => {
  test("pi: registers with direct exposure, notes other servers, and adds rules for preferred", () => {
    const input = makeInput("pi", "project", "preferred", "optional", "mcp");
    mkdirSync(join(input.cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(input.cwd, ".pi/mcp.json"),
      JSON.stringify({ mcpServers: { tavily: { command: "npx" } } }, null, 2),
    );
    const plan = planPi(input, readRecord(input));
    expect(plan.errors).toEqual([]);
    const configEdit = plan.edits.find((edit) => edit.format === "json");
    expect(configEdit?.file).toBe(join(input.cwd, ".pi/mcp.json"));
    const setOp = configEdit?.ops.find((op) => op.op === "set");
    expect(setOp && "value" in setOp ? (setOp.value as { exposure: string }).exposure : undefined).toBe("direct");
    expect(plan.edits.some((edit) => edit.format === "rules")).toBe(true);
    expect(plan.notes.join(" ")).toContain("tavily");
  });

  test("pi: off tiers write DEEPSEEK_ENABLE flags into the env block", () => {
    const input = makeInput("pi", "global", "off", "optional", "mcp");
    const plan = planPi(input, readRecord(input));
    const setOp = plan.edits.find((edit) => edit.format === "json")?.ops[0];
    const env = setOp && "value" in setOp ? ((setOp.value as { env: Record<string, string> }).env ?? {}) : {};
    expect(env.DEEPSEEK_ENABLE_SEARCH).toBe("false");
    expect(env.DEEPSEEK_ENABLE_FETCH).toBeUndefined();
  });

  test("opencode: rejects the structurally unavailable search tier and duplicate plugin entries", () => {
    const preferred = makeInput("opencode", "global", "preferred", "optional");
    const preferredPlan = planOpenCode(preferred, readRecord(preferred));
    expect(preferredPlan.errors.length).toBe(1);
    expect(preferredPlan.errors[0]?.message).toContain("no preferred tier");

    const input = makeInput("opencode", "global", "forced", "optional");
    const config = join(input.home, ".config/opencode");
    mkdirSync(config, { recursive: true });
    writeFileSync(
      join(config, "opencode.jsonc"),
      JSON.stringify({ plugins: [{ package: "github:gwokhou/deepseek-web-retrieval" }] }, null, 2),
    );
    const plan = planOpenCode(input, readRecord(input));
    expect(plan.errors.length).toBe(1);
    expect(plan.errors[0]?.message).toContain("already has a plugins entry");
  });

  test("opencode: forced search snapshots the current provider and appends permissions", () => {
    const input = makeInput("opencode", "global", "forced", "forced");
    const config = join(input.home, ".config/opencode");
    mkdirSync(config, { recursive: true });
    writeFileSync(
      join(config, "opencode.jsonc"),
      `// comment\n{ "websearch": { "provider": "tavily" }, "permissions": [{ "action": "bash", "resource": "*", "effect": "allow" }] }\n`,
    );
    const plan = planOpenCode(input, readRecord(input));
    expect(plan.errors).toEqual([]);
    expect(plan.notes.join(" ")).toContain("tavily");
    const permissions = plan.edits
      .find((edit) => edit.format === "json")
      ?.ops.find((op) => op.op === "append-array" && op.path[0] === "permissions");
    expect(
      permissions && "entries" in permissions
        ? (permissions.entries ?? []).map((entry) => (entry as { action: string }).action)
        : [],
    ).toEqual(["websearch", "deepseek_fetch", "webfetch"]);
  });

  test("codex: detects the [tools] no-op trap and plans the web_search kill switch", () => {
    const trapped = makeInput("codex", "global", "optional", "optional");
    const dir = join(trapped.home, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.toml"), "[tools]\nweb_search = false\n");
    expect(planCodex(trapped, readRecord(trapped)).errors[0]?.message).toContain("no-op");

    const input = makeInput("codex", "global", "forced", "optional");
    const dir2 = join(input.home, ".codex");
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir2, "config.toml"), 'model = "gpt-5.2"\nweb_search = "live"\n');
    const plan = planCodex(input, readRecord(input));
    expect(plan.errors).toEqual([]);
    const ops = plan.edits.find((edit) => edit.format === "toml")?.ops ?? [];
    expect(ops.some((op) => op.op === "set" && op.path.join(".") === "web_search" && op.value === "disabled")).toBe(
      true,
    );
    expect(plan.notes.join(" ")).toContain('"live"');
    expect(plan.notes.join(" ")).toContain("env_vars");
  });

  test("codex: project scope reports the global fallback for config.toml", () => {
    const input = makeInput("codex", "project", "preferred", "optional");
    const plan = planCodex(input, readRecord(input));
    expect(plan.notes.join(" ")).toContain("user level");
    expect(plan.edits.find((edit) => edit.format === "rules")?.file).toBe(join(input.cwd, "AGENTS.md"));
    expect(plan.edits.find((edit) => edit.format === "toml")?.file).toBe(join(input.home, ".codex/config.toml"));
  });

  test("codex: notes version drift between the probed CLI and the tested lock", () => {
    const input = makeInput("codex", "global", "optional", "optional");
    const drifted = planCodex({ ...input, hostVersion: "0.170.1" }, readRecord(input));
    expect(drifted.notes.join(" ")).toContain("0.170.1");
    expect(drifted.notes.join(" ")).toContain("0.163.0");
    const matching = planCodex({ ...input, hostVersion: "0.163.0" }, readRecord(input));
    expect(matching.notes.join(" ")).not.toContain("drifted");
    expect(planCodex(input, readRecord(input)).notes.join(" ")).not.toContain("drifted");
  });

  test("parseCodexVersion reads the codex-cli version line", () => {
    expect(parseCodexVersion("codex-cli 0.163.0\n")).toBe("0.163.0");
    expect(parseCodexVersion("codex 0.163.0\n")).toBe("0.163.0");
    expect(parseCodexVersion("codex-cli unknown\n")).toBeUndefined();
    expect(parseCodexVersion("")).toBeUndefined();
  });

  test("codex: off tiers disable tools via disabled_tools, keeping the user's own entries", () => {
    const input = makeInput("codex", "global", "off", "optional");
    const dir = join(input.home, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.toml"),
      '[mcp_servers.deepseek]\ncommand = "node"\ndisabled_tools = ["their_tool", "deepseek_fetch"]\n',
    );
    const plan = planCodex(input, readRecord(input));
    expect(plan.errors).toEqual([]);
    const setOp = plan.edits
      .find((edit) => edit.format === "toml")
      ?.ops.find((op) => op.op === "set" && op.path.join(".") === "mcp_servers.deepseek");
    const entry =
      setOp && "value" in setOp
        ? (setOp.value as { disabled_tools?: string[]; env?: Record<string, string> })
        : undefined;
    // The user's own entry rides along; the stale deepseek_fetch (ours) is filtered so
    // only the off tier's choice is written fresh.
    expect(entry?.disabled_tools).toEqual(["their_tool", "deepseek_web_search"]);
    expect(entry?.env).toBeUndefined();
    expect(plan.notes.join(" ")).toContain("disabled_tools");
    expect(plan.notes.join(" ")).toContain("deepseek_web_search");
  });
});

describe("apply and uninstall round-trips", () => {
  test("pi project: creates, verifies, and fully removes on uninstall", () => {
    const input = makeInput("pi", "project", "optional", "optional", "mcp");
    const plan = planPi(input, readRecord(input));
    const applied = applyPlan(plan, input);
    expect(applied.ok).toBe(true);
    expect(existsSync(join(input.cwd, ".pi/mcp.json"))).toBe(true);
    expect(listRecords(input).map((record) => record.host)).toContain("pi");
    uninstall(input);
    expect(existsSync(join(input.cwd, ".pi/mcp.json"))).toBe(false);
    expect(listRecords(input)).toEqual([]);
  });

  test("opencode global: snapshot restores the competitor, comments survive, re-apply is a no-op", () => {
    const input = makeInput("opencode", "global", "forced", "preferred");
    const config = join(input.home, ".config/opencode");
    mkdirSync(config, { recursive: true });
    const original = `{\n  // keep me\n  "websearch": { "provider": "tavily" },\n  "permissions": [{ "action": "bash", "resource": "*", "effect": "allow" }],\n}\n`;
    writeFileSync(join(config, "opencode.jsonc"), original);
    const plan = planOpenCode(input, readRecord(input));
    const first = applyPlan(plan, input);
    expect(first.ok).toBe(true);
    const afterFirst = readFileSync(join(config, "opencode.jsonc"), "utf8");
    expect(afterFirst).toContain("// keep me");
    expect(afterFirst).toContain('"deepseek"');
    // Re-apply dedupes: nothing new appended.
    const second = applyPlan(planOpenCode(input, readRecord(input)), input);
    expect(second.ok).toBe(true);
    const afterSecond = readFileSync(join(config, "opencode.jsonc"), "utf8");
    expect((afterSecond.match(/deepseek-web-retrieval/g) ?? []).length).toBe(
      (afterFirst.match(/deepseek-web-retrieval/g) ?? []).length,
    );
    uninstall(input);
    const restored = readFileSync(join(config, "opencode.jsonc"), "utf8");
    const restoredValue = parseJsonc(restored) as {
      websearch: { provider: string };
      permissions: { action: string; resource?: string; effect?: string }[];
      plugins?: unknown[];
    };
    expect(restored).toContain('"tavily"');
    expect(restoredValue.websearch.provider).toBe("tavily");
    expect(restoredValue.permissions).toEqual([{ action: "bash", resource: "*", effect: "allow" }]);
    expect(restoredValue.plugins).toBeUndefined();
    expect(existsSync(join(config, "AGENTS.md"))).toBe(false);
  });

  test("codex global: writes the TOML entry and kill switch, restores web_search on uninstall", () => {
    const input = makeInput("codex", "global", "forced", "optional");
    const dir = join(input.home, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.toml"),
      '# my comment\nmodel = "gpt-5.2"\nweb_search = "live"\n\n[mcp_servers.github]\ncommand = "npx"\n',
    );
    const plan = planCodex(input, readRecord(input));
    expect(plan.notes.join(" ")).toContain("comments");
    const applied = applyPlan(plan, input);
    expect(applied.ok).toBe(true);
    const text = readFileSync(join(dir, "config.toml"), "utf8");
    expect(text).toContain("[mcp_servers.deepseek]");
    expect(text).toContain('web_search = "disabled"');
    expect(text).toContain("[mcp_servers.github]");
    expect(text).toContain("env_vars");
    uninstall(input);
    const restored = readFileSync(join(dir, "config.toml"), "utf8");
    expect(restored).toContain('web_search = "live"');
    expect(restored).toContain("[mcp_servers.github]");
    expect(restored).not.toContain("mcp_servers.deepseek");
  });

  test("codex forced refuses while a web-capable MCP server stays registered", () => {
    const input = makeInput("codex", "global", "forced", "optional");
    const dir = join(input.home, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.toml"), '[mcp_servers.tavily]\ncommand = "npx"\n');
    const plan = planForHost("codex", input);
    expect(plan.errors.length).toBe(1);
    expect(plan.errors[0]?.message).toContain("mcp_servers.tavily");
    expect(plan.errors[0]?.message).toContain("no per-server kill switch");
    expect(existsSync(join(dir, "config.toml"))).toBe(true);
    expect(readFileSync(join(dir, "config.toml"), "utf8")).not.toContain("deepseek");
  });

  test("pi forced disables web-capable competitors and restores them on uninstall", () => {
    const input = makeInput("pi", "project", "forced", "optional", "mcp");
    mkdirSync(join(input.cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(input.cwd, ".pi/mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            tavily: { command: "npx", args: ["-y", "tavily-mcp"], enabled: true },
            github: { command: "npx", args: ["-y", "@github/mcp"] },
          },
        },
        null,
        2,
      ),
    );
    const plan = planForHost("pi", input);
    expect(plan.errors).toEqual([]);
    const exclusion = plan.edits
      .find((edit) => edit.format === "json")
      ?.ops.find((op) => op.op === "set" && op.path.join(".") === "mcpServers.tavily.enabled");
    expect(exclusion && "value" in exclusion ? exclusion.value : undefined).toBe(false);
    expect(exclusion && "previous" in exclusion ? exclusion.previous : undefined).toBe(true);
    expect(plan.notes.join(" ")).toContain("tavily");
    expect(plan.notes.join(" ")).toContain("not exclusive");
    applyPlan(plan, input);
    const applied = JSON.parse(readFileSync(join(input.cwd, ".pi/mcp.json"), "utf8")) as {
      mcpServers: Record<string, { enabled?: boolean }>;
    };
    expect(applied.mcpServers.tavily?.enabled).toBe(false);
    expect(applied.mcpServers.github?.enabled).toBeUndefined();
    uninstall(input);
    const restored = JSON.parse(readFileSync(join(input.cwd, ".pi/mcp.json"), "utf8")) as {
      mcpServers: Record<string, { enabled?: boolean }>;
    };
    expect(restored.mcpServers.tavily?.enabled).toBe(true);
    expect(restored.mcpServers.github).toBeDefined();
  });

  test("preferred notes existing rules steering toward another web tool", () => {
    const input = makeInput("pi", "project", "preferred", "optional", "mcp");
    writeFileSync(join(input.cwd, "AGENTS.md"), "# Rules\n\nAlways use the built-in webfetch tool for pages.\n");
    const plan = planForHost("pi", input);
    expect(plan.errors).toEqual([]);
    expect(plan.notes.join(" ")).toContain("steer toward other web tools");
    expect(plan.notes.join(" ")).toContain("built-in webfetch");
  });

  test("forced plans point at the README's privacy-and-cost section", () => {
    const input = makeInput("codex", "global", "forced", "optional");
    const plan = planForHost("codex", input);
    expect(plan.notes.join(" ")).toContain('README\'s "Privacy and cost" section');
  });

  test("uninstall refuses when nothing is recorded", () => {
    const input = makeInput("pi", "global", "optional", "optional", "mcp");
    expect(() => uninstall(input)).toThrow(/No pi install is recorded/);
  });

  test("pi rejects installing with both capabilities off", () => {
    const input = makeInput("pi", "global", "off", "off", "mcp");
    const plan = planPi(input, readRecord(input));
    expect(plan.errors.length).toBe(1);
    expect(plan.errors[0]?.message).toContain("Both capabilities are off");
  });

  test("tier downgrade reverts the previous init's artifacts instead of orphaning them", () => {
    const input = makeInput("codex", "global", "forced", "optional");
    const dir = join(input.home, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.toml"), 'model = "gpt-5.2"\nweb_search = "live"\n');
    // Install forced: web_search is disabled and snapshotted.
    applyPlan(planForHost("codex", input), input);
    expect(readFileSync(join(dir, "config.toml"), "utf8")).toContain('web_search = "disabled"');
    // Downgrade to optional: the plan carries an explicit revert.
    const downgraded = planForHost("codex", { ...input, search: "optional" });
    expect(downgraded.reverts?.length).toBe(1);
    expect(
      downgraded.reverts?.[0]?.ops.some(
        (op: { op: string; path: readonly string[] }) => op.op === "set" && op.path[0] === "web_search",
      ),
    ).toBe(true);
    applyPlan(downgraded, input);
    // The revert is partial (the new plan still claims config.toml), so the file
    // must survive the revert even though the installer created it.
    expect(existsSync(join(dir, "config.toml"))).toBe(true);
    expect(readFileSync(join(dir, "config.toml"), "utf8")).toContain('web_search = "live"');
    // Uninstall is complete: nothing from either install remains.
    uninstall(input);
    const restored = readFileSync(join(dir, "config.toml"), "utf8");
    expect(restored).toContain('web_search = "live"');
    expect(restored).not.toContain("mcp_servers.deepseek");
  });

  test("codex: off tier writes disabled_tools, merges user entries, and downgrades cleanly", () => {
    const input = makeInput("codex", "global", "off", "optional");
    const dir = join(input.home, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.toml"),
      '[mcp_servers.deepseek]\ncommand = "node"\ndisabled_tools = ["their_tool"]\n',
    );
    const applied = applyPlan(planCodex(input, readRecord(input)), input);
    expect(applied.ok).toBe(true);
    const afterInstall = readFileSync(join(dir, "config.toml"), "utf8");
    expect(afterInstall).toContain('disabled_tools = [ "their_tool", "deepseek_web_search" ]');

    // Downgrade to optional: the set op replaces the entry without our tool name; the
    // user's own entry stays.
    applyPlan(planForHost("codex", { ...input, search: "optional" }), input);
    const afterDowngrade = readFileSync(join(dir, "config.toml"), "utf8");
    expect(afterDowngrade).toContain('disabled_tools = [ "their_tool" ]');
    expect(afterDowngrade).not.toContain("deepseek_web_search");

    // Uninstall restores the user's original entry exactly.
    uninstall(input);
    const restored = readFileSync(join(dir, "config.toml"), "utf8");
    expect(restored).toContain('disabled_tools = [ "their_tool" ]');
    expect(restored).not.toContain("env_vars");
  });

  test("preferred → forced downgrade removes the orphaned rules block", () => {
    const input = makeInput("opencode", "global", "off", "preferred");
    applyPlan(planForHost("opencode", input), input);
    const rulesFile = join(input.home, ".config/opencode/AGENTS.md");
    expect(existsSync(rulesFile)).toBe(true);
    const upgraded = planForHost("opencode", { ...input, fetch: "forced" });
    expect(upgraded.reverts?.some((revert: { format: string }) => revert.format === "rules")).toBe(true);
    applyPlan(upgraded, input);
    expect(existsSync(rulesFile)).toBe(false);
    uninstall(input);
    expect(existsSync(join(input.home, ".config/opencode/opencode.jsonc"))).toBe(false);
  });
});

describe("apply rollback", () => {
  test("a mid-write failure restores the touched files byte-identically and keeps the prior record", () => {
    const input = makeInput("opencode", "project", "optional", "preferred");
    const config = join(input.cwd, "opencode.jsonc");
    const rules = join(input.cwd, "AGENTS.md");
    const original = `{\n  // keep me\n  "websearch": { "provider": "tavily" }\n}\n`;
    writeFileSync(config, original);

    const first = applyPlan(planOpenCode(input, readRecord(input)), input);
    expect(first.ok).toBe(true);
    const afterFirst = readFileSync(config, "utf8");
    expect(afterFirst).toContain("// keep me");

    // The re-init would rewrite the config, but its rules write cannot even
    // open the file: the AGENTS.md path is a symlink into a directory that
    // does not exist, so loading treats the file as absent while the write
    // fails with ENOENT (it cannot create the target).
    rmSync(rules);
    symlinkSync("missing-dir/target", rules);
    const reinit: InstallerInput = { ...input, search: "forced" };
    expect(() => applyPlan(planOpenCode(reinit, readRecord(reinit)), reinit)).toThrow(
      /apply failed and was rolled back/,
    );

    expect(readFileSync(config, "utf8")).toBe(afterFirst);
    const record = readRecord(input);
    expect(record?.tiers.search).toBe("optional");
    // The prior record still snapshots the true pre-install world, so uninstall
    // restores it rather than the failed run's half-written values.
    uninstall(input);
    const restored = readFileSync(config, "utf8");
    const restoredValue = parseJsonc(restored) as {
      websearch: { provider: string };
      plugins?: unknown[];
      permissions?: unknown[];
    };
    expect(restored).toContain("// keep me");
    expect(restoredValue.websearch.provider).toBe("tavily");
    expect(restoredValue.plugins).toBeUndefined();
    expect(restoredValue.permissions).toBeUndefined();
  });

  test("a record-write failure rolls back created files and leaves no install recorded", () => {
    const input = makeInput("opencode", "project", "optional", "preferred");
    // The record path is a directory: readRecord sees no record (the read
    // fails) and the record write fails after both files were written.
    mkdirSync(join(input.cwd, ".deepseek-web-retrieval/install.opencode.json"), { recursive: true });

    expect(() => applyPlan(planOpenCode(input, readRecord(input)), input)).toThrow(/apply failed and was rolled back/);
    expect(existsSync(join(input.cwd, "opencode.jsonc"))).toBe(false);
    expect(existsSync(join(input.cwd, "AGENTS.md"))).toBe(false);
    expect(listRecords(input)).toEqual([]);
  });
});

describe("review fixes", () => {
  test("plan renders old values for set ops and existing counts for appends", () => {
    const input = makeInput("pi", "global", "optional", "optional", "mcp");
    mkdirSync(join(input.home, ".pi/agent"), { recursive: true });
    writeFileSync(
      join(input.home, ".pi/agent/mcp.json"),
      JSON.stringify({ mcpServers: { deepseek: { command: "node", args: ["/old/cli.js"] } } }, null, 2),
    );
    const rendered = renderPlan(planForHost("pi", input));
    expect(rendered).toContain("(was ");
    expect(rendered).toContain("/old/cli.js");

    const oc = makeInput("opencode", "global", "forced", "optional");
    const config = join(oc.home, ".config/opencode");
    mkdirSync(config, { recursive: true });
    writeFileSync(
      join(config, "opencode.jsonc"),
      JSON.stringify({ permissions: [{ action: "bash", resource: "*", effect: "allow" }] }, null, 2),
    );
    const ocRendered = renderPlan(planForHost("opencode", oc));
    expect(ocRendered).toContain("1 existing kept");
  });

  test("detects trailing TOML comments, not just comment lines", () => {
    expect(hasTomlComment('model = "gpt" # my note\n')).toBe(true);
    expect(hasTomlComment("# full line\n")).toBe(true);
    expect(hasTomlComment('url = "https://x.com/a#b"\n')).toBe(false);
    expect(hasTomlComment('model = "gpt"\n')).toBe(false);
  });

  test("install records are written owner-only", () => {
    const input = makeInput("pi", "global", "optional", "optional", "mcp");
    applyPlan(planForHost("pi", input), input);
    const { statePathFor } = require("../../src/installer/state") as typeof import("../../src/installer/state");
    const mode = statSync(statePathFor(input)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("refuses to snapshot an existing entry containing a literal API key", () => {
    const input = makeInput("codex", "global", "optional", "optional");
    const dir = join(input.home, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.toml"),
      '[mcp_servers.deepseek]\ncommand = "node"\nargs = ["x"]\n\n[mcp_servers.deepseek.env]\nDEEPSEEK_API_KEY = "sk-real-secret"\n',
    );
    const plan = planForHost("codex", input);
    expect(plan.errors.length).toBe(1);
    expect(plan.errors[0]?.message).toContain("credential");
    expect(plan.edits).toEqual([]);
  });

  test("re-init over the installer's own environment-variable indirection is not treated as a secret", () => {
    const input = makeInput("pi", "global", "optional", "optional", "mcp");
    applyPlan(planForHost("pi", input), input);
    // The written entry carries env.DEPSEEK_API_KEY = "${DEEPSEEK_API_KEY}"; a
    // re-init must snapshot that indirection form, not refuse it as a literal key.
    const reinit = planForHost("pi", input);
    expect(reinit.errors).toEqual([]);
    expect(reinit.edits.length).toBeGreaterThan(0);
    applyPlan(reinit, input);
    uninstall(input);
    expect(existsSync(join(input.home, ".pi", "agent", "mcp.json"))).toBe(false);
  });

  test("per-host markers let pi and codex share one AGENTS.md", () => {
    const piInput = makeInput("pi", "project", "preferred", "off", "mcp");
    applyPlan(planForHost("pi", piInput), piInput);
    const codexInput = { ...piInput, host: "codex" as const };
    applyPlan(planForHost("codex", codexInput), codexInput);
    const agents = join(piInput.cwd, "AGENTS.md");
    const both = fsReadFileSync(agents, "utf8");
    expect(hasBlock("pi", both)).toBe(true);
    expect(hasBlock("codex", both)).toBe(true);

    uninstall(piInput);
    const afterPi = fsReadFileSync(agents, "utf8");
    expect(hasBlock("pi", afterPi)).toBe(false);
    expect(hasBlock("codex", afterPi)).toBe(true);

    uninstall(codexInput);
    expect(existsSync(agents)).toBe(false);
  });

  test("runInstallerCli resolves --cwd to an absolute record path and gates on --apply", async () => {
    const logs: string[] = [];
    const errorsOut: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (line: string) => logs.push(line);
    console.error = (line: string) => errorsOut.push(line);
    try {
      const home = mkdtempSync(join(tmpdir(), "dwr-cli-home-"));
      const cwd = mkdtempSync(join(tmpdir(), "dwr-cli-cwd-"));
      const relative = relativePath(process.cwd(), cwd);
      const code = await runInstallerCli([
        "init",
        "--host",
        "pi",
        "--scope",
        "project",
        "--search",
        "optional",
        "--fetch",
        "optional",
        "--home",
        home,
        "--cwd",
        relative,
      ]);
      // --home is not a known flag; the CLI must reject it instead of guessing.
      expect(code).toBe(1);
      expect(errorsOut.join("\n")).toContain("unknown flag --home");
      expect(logs.join("\n")).not.toContain("--apply");

      const code2 = await runInstallerCli([
        "init",
        "--host",
        "pi",
        "--scope",
        "project",
        "--search",
        "optional",
        "--fetch",
        "optional",
        "--cwd",
        relative,
      ]);
      expect(code2).toBe(0);
      expect(logs.join("\n")).toContain("Plan only");
      expect(existsSync(join(cwd, ".pi/mcp.json"))).toBe(false);

      const code3 = await runInstallerCli([
        "init",
        "--host",
        "pi",
        "--scope",
        "project",
        "--search",
        "false",
        "--fetch",
        "optional",
        "--cwd",
        cwd,
        "--apply",
      ]);
      expect(code3).toBe(1);
      expect(errorsOut.join("\n")).toContain('invalid --search value "false"');
      expect(existsSync(join(cwd, ".pi/mcp.json"))).toBe(false);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  test("applyPlan refuses to clobber a non-array at an append-array path", () => {
    const input = makeInput("opencode", "global", "forced", "optional");
    const config = join(input.home, ".config/opencode");
    mkdirSync(config, { recursive: true });
    writeFileSync(join(config, "opencode.jsonc"), JSON.stringify({ permissions: "ask" }, null, 2));
    expect(() => applyPlan(planForHost("opencode", input), input)).toThrow(/not an array/);
    // Nothing was written: the prepare pass failed before any file changed.
    expect(fsReadFileSync(join(config, "opencode.jsonc"), "utf8")).toContain('"ask"');
  });
});

describe("scope isolation", () => {
  test("a codex install refuses a second scope that claims the same config file", () => {
    const input = makeInput("codex", "global", "optional", "optional");
    applyPlan(planForHost("codex", input), input);
    const project = planForHost("codex", { ...input, scope: "project" });
    expect(project.errors.length).toBe(1);
    expect(project.errors[0]?.message).toContain("global scope");
    expect(project.errors[0]?.message).toContain("uninstall --host codex --scope global");
    expect(project.edits).toEqual([]);
  });

  test("the refusal is symmetric when the project install came first", () => {
    const input = makeInput("codex", "project", "optional", "optional");
    applyPlan(planForHost("codex", input), input);
    const global = planForHost("codex", { ...input, scope: "global" });
    expect(global.errors.length).toBe(1);
    expect(global.errors[0]?.message).toContain("project scope");
  });

  test("pi and opencode scope pairs map to disjoint files and install side by side", () => {
    const piGlobal = makeInput("pi", "global", "optional", "optional", "mcp");
    applyPlan(planForHost("pi", piGlobal), piGlobal);
    const piProject = planForHost("pi", { ...piGlobal, scope: "project" });
    expect(piProject.errors).toEqual([]);
    applyPlan(piProject, { ...piGlobal, scope: "project" });
    expect(listRecords(piGlobal).length).toBe(2);
    uninstall({ ...piGlobal, scope: "project" });
    expect(readRecord(piGlobal)).toBeDefined();
    expect(existsSync(join(piGlobal.home, ".pi/agent/mcp.json"))).toBe(true);
  });

  test("uninstall refuses when a legacy record at the other scope claims the same file", () => {
    const input = makeInput("codex", "global", "optional", "optional");
    const file = join(input.home, ".codex/config.toml");
    const record = {
      version: 1 as const,
      host: "codex" as const,
      scope: "global" as const,
      createdAt: new Date().toISOString(),
      tiers: { search: "optional" as const, fetch: "optional" as const },
      files: [{ file, format: "toml" as const, created: false, ops: [] }],
    };
    writeRecord(input, record);
    writeRecord({ ...input, scope: "project" }, { ...record, scope: "project" as const });
    expect(() => uninstall(input)).toThrow(/also recorded at the project scope/);
  });
});

describe("revert ownership", () => {
  test("claimedByOtherScope returns only files the other scope's record also claims", () => {
    const input = makeInput("codex", "global", "optional", "optional");
    const fileA = join(input.home, ".codex/config.toml");
    const fileB = join(input.cwd, "AGENTS.md");
    writeRecord(
      { ...input, scope: "project" },
      {
        version: 1,
        host: "codex",
        scope: "project",
        tiers: { search: "optional", fetch: "optional" },
        createdAt: new Date().toISOString(),
        files: [
          { file: fileA, format: "toml", created: false, ops: [] },
          { file: fileB, format: "rules", created: true, ops: [] },
        ],
      },
    );
    const cases: readonly { readonly files: readonly string[]; readonly expected: string[] }[] = [
      { files: [fileB, join(input.cwd, "other.toml")], expected: [fileB] },
      { files: [fileA, fileB], expected: [fileA, fileB] },
      { files: [join(input.cwd, "unrelated.json")], expected: [] },
      { files: [], expected: [] },
    ];
    for (const { files, expected } of cases) {
      expect(claimedByOtherScope(input, files)).toEqual(expected);
    }
    // The mirror direction: a project-scope input against a global record.
    const projectInput = makeInput("codex", "project", "optional", "optional");
    writeRecord(
      { ...projectInput, scope: "global" },
      {
        version: 1,
        host: "codex",
        scope: "global",
        tiers: { search: "optional", fetch: "optional" },
        createdAt: new Date().toISOString(),
        files: [{ file: fileA, format: "toml", created: false, ops: [] }],
      },
    );
    expect(claimedByOtherScope(projectInput, [fileA, fileB])).toEqual([fileA]);
    // Without a record at the other scope nothing is ever claimed.
    const fresh = makeInput("codex", "global", "optional", "optional");
    expect(claimedByOtherScope(fresh, [fileA, fileB])).toEqual([]);
  });

  test("a whole-file orphan revert deletes a created file it leaves empty", () => {
    const input = makeInput("pi", "project", "optional", "optional", "mcp");
    const extra = join(input.cwd, ".pi/extra.json");
    mkdirSync(dirname(extra), { recursive: true });
    writeFileSync(extra, '{"a":1}\n');
    writeRecord(input, {
      version: 1,
      host: "pi",
      scope: "project",
      tiers: { search: "optional", fetch: "optional" },
      createdAt: new Date().toISOString(),
      files: [
        {
          file: extra,
          format: "json",
          created: true,
          ops: [{ op: "set", path: ["a"], applied: 1, previous: undefined }],
        },
      ],
    });
    // The new plan does not claim the extra file, so it reverts wholly; reverting
    // its only op empties it, and a created file left empty is deleted.
    const applied = applyPlan(planForHost("pi", input), input);
    expect(applied.ok).toBe(true);
    expect(existsSync(extra)).toBe(false);
    expect(existsSync(join(input.cwd, ".pi/mcp.json"))).toBe(true);
  });
});

describe("format codecs", () => {
  test("toml: revert keeps user keys and drops the installer's entries", () => {
    const codec = codecFor("toml", "codex");
    const edit: TomlEdit = {
      file: "config.toml",
      format: "toml",
      ops: [
        { op: "set", path: ["mcp_servers", "deepseek", "command"], value: "npx" },
        { op: "append-array", path: ["favorites"], entries: ["deepseek"] },
      ],
    };
    const applied = codec.apply('model = "gpt-5.2"\nfavorites = ["tavily"]\n', edit);
    expect(applied.text).toContain("[mcp_servers.deepseek]");
    // The user edits another key after the install.
    const userEdited = codec.apply(applied.text, {
      file: edit.file,
      format: "toml",
      ops: [{ op: "set", path: ["model"], value: "o4-mini" }],
    });
    const recorded: RecordedFile = {
      file: edit.file,
      format: "toml",
      created: false,
      ops: applied.recorded,
      createdParents: applied.createdParents,
    };
    const reverted = codec.revert(userEdited.text, recorded);
    expect(reverted.text).toContain('model = "o4-mini"');
    expect(reverted.text).toContain("tavily");
    expect(reverted.text).not.toContain("deepseek");
    expect(reverted.notes).toEqual([]);
  });

  test("rules: upsert keeps surrounding content and revert removes only the block", () => {
    const codec = codecFor("rules", "pi");
    const edit: RulesEdit = {
      file: "AGENTS.md",
      format: "rules",
      block: buildRulesBlock("pi", ["prefer the deepseek tools"]),
    };
    const applied = codec.apply("# house rules\n", edit);
    expect(applied.text).toContain("# house rules");
    expect(applied.recorded).toEqual([]);
    const recorded: RecordedFile = { file: edit.file, format: "rules", created: false, ops: [] };
    expect(codec.revert(applied.text, recorded).text).toBe("# house rules\n");
    expect(codec.isEffectivelyEmpty(codec.revert(`${edit.block}\n`, { ...recorded, created: true }).text)).toBe(true);
  });

  test("verify: one positive and one negative case per format", () => {
    const json = codecFor("json", "pi");
    const jsonEdit: JsonEdit = { file: "x.jsonc", format: "json", ops: [{ op: "set", path: ["a"], value: 1 }] };
    expect(json.verify(json.apply("", jsonEdit).text, jsonEdit)).toBe(true);
    expect(json.verify("{}", jsonEdit)).toBe(false);

    const toml = codecFor("toml", "codex");
    const tomlEdit: TomlEdit = {
      file: "x.toml",
      format: "toml",
      ops: [{ op: "set", path: ["web_search"], value: "disabled" }],
    };
    expect(toml.verify(toml.apply("", tomlEdit).text, tomlEdit)).toBe(true);
    expect(toml.verify('web_search = "live"\n', tomlEdit)).toBe(false);

    const rules = codecFor("rules", "pi");
    const rulesEdit: RulesEdit = { file: "AGENTS.md", format: "rules", block: buildRulesBlock("pi", ["line"]) };
    expect(rules.verify(rules.apply("", rulesEdit).text, rulesEdit)).toBe(true);
    expect(rules.verify("# nothing to see\n", rulesEdit)).toBe(false);
  });
});

describe("drift refusal and CLI edges", () => {
  test("runInstallerCli probes codex --version and surfaces drift in the plan", async () => {
    const home = mkdtempSync(join(tmpdir(), "dwr-cli-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "dwr-cli-cwd-"));
    const bin = mkdtempSync(join(tmpdir(), "dwr-cli-bin-"));
    writeFileSync(join(bin, "codex"), "#!/bin/sh\necho 'codex-cli 9.9.9'\n");
    chmodSync(join(bin, "codex"), 0o755);
    const logs: string[] = [];
    const errorsOut: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    const previousHome = process.env.HOME;
    const previousPath = process.env.PATH;
    console.log = (line: string) => logs.push(line);
    console.error = (line: string) => errorsOut.push(line);
    process.env.HOME = home;
    process.env.PATH = bin;
    try {
      const code = await runInstallerCli([
        "init",
        "--host",
        "codex",
        "--scope",
        "global",
        "--search",
        "optional",
        "--fetch",
        "optional",
        "--cwd",
        cwd,
      ]);
      expect(code).toBe(0);
      expect(logs.join("\n")).toContain("9.9.9");
      expect(logs.join("\n")).toContain("0.163.0");

      // Without a codex binary the probe skips with a stderr note, plan unaffected.
      logs.length = 0;
      process.env.PATH = join(bin, "empty");
      const code2 = await runInstallerCli([
        "init",
        "--host",
        "codex",
        "--scope",
        "global",
        "--search",
        "optional",
        "--fetch",
        "optional",
        "--cwd",
        cwd,
      ]);
      expect(code2).toBe(0);
      expect(errorsOut.join("\n")).toContain("version-drift check was skipped");
      expect(logs.join("\n")).not.toContain("9.9.9");
    } finally {
      console.log = originalLog;
      console.error = originalError;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      process.env.PATH = previousPath;
    }
  });

  test("apply refuses when a set-op path changed since the plan was rendered", () => {
    const input = makeInput("pi", "project", "optional", "optional", "mcp");
    mkdirSync(join(input.cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(input.cwd, ".pi/mcp.json"),
      JSON.stringify({ mcpServers: { deepseek: { command: "node", args: ["/old/cli.js"] } } }, null, 2),
    );
    const plan = planForHost("pi", input);
    // The user edits the file after reviewing the plan, before --apply.
    writeFileSync(
      join(input.cwd, ".pi/mcp.json"),
      JSON.stringify({ mcpServers: { deepseek: { command: "changed", args: ["/old/cli.js"] } } }, null, 2),
    );
    expect(() => applyPlan(plan, input)).toThrow(/changed since the plan was rendered/);
    expect(JSON.parse(readFileSync(join(input.cwd, ".pi/mcp.json"), "utf8")).mcpServers.deepseek.command).toBe(
      "changed",
    );
    expect(readRecord(input)).toBeUndefined();
  });

  test("an explicit config home routes global config and the install record", () => {
    const input = makeInput("opencode", "global", "optional", "optional");
    const xdg = join(input.home, "xdg-config");
    const rooted = { ...input, configHome: xdg };
    applyPlan(planForHost("opencode", rooted), rooted);
    expect(existsSync(join(xdg, "opencode/opencode.jsonc"))).toBe(true);
    expect(readRecord(rooted)).toBeDefined();
    uninstall(rooted);
    expect(existsSync(join(xdg, "opencode/opencode.jsonc"))).toBe(false);
    expect(existsSync(join(input.home, ".config/opencode/opencode.jsonc"))).toBe(false);
  });

  test("the rendered plan shows the reverts section for a downgrade", () => {
    const input = makeInput("codex", "global", "forced", "optional");
    const dir = join(input.home, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.toml"), 'model = "gpt-5.2"\nweb_search = "live"\n');
    applyPlan(planForHost("codex", input), input);
    const downgraded = planForHost("codex", { ...input, search: "optional" });
    const rendered = renderPlan(downgraded);
    expect(rendered).toContain("Reverts");
    expect(rendered).toContain("config.toml");
    expect(rendered).toContain("web_search");
  });

  test("re-init with fewer entries reverts the dropped ones and still uninstalls the kept ones", () => {
    const input = makeInput("opencode", "global", "off", "forced");
    const config = join(input.home, ".config/opencode");
    mkdirSync(config, { recursive: true });
    writeFileSync(
      join(config, "opencode.jsonc"),
      JSON.stringify({ permissions: [{ action: "bash", resource: "*", effect: "allow" }] }, null, 2),
    );
    applyPlan(planForHost("opencode", input), input);
    const afterFirst = parseJsonc(readFileSync(join(config, "opencode.jsonc"), "utf8")) as {
      permissions: { action: string }[];
    };
    expect(afterFirst.permissions.map((entry) => entry.action)).toEqual(["bash", "deepseek_fetch", "webfetch"]);
    // fetch downgrades to optional: the webfetch permission is an orphaned entry
    // and reverts immediately — the record claims only what it kept.
    applyPlan(planForHost("opencode", { ...input, fetch: "optional" }), input);
    const afterDowngrade = parseJsonc(readFileSync(join(config, "opencode.jsonc"), "utf8")) as {
      permissions: { action: string }[];
    };
    expect(afterDowngrade.permissions.map((entry) => entry.action)).toEqual(["bash", "deepseek_fetch"]);
    uninstall(input);
    const restored = parseJsonc(readFileSync(join(config, "opencode.jsonc"), "utf8")) as {
      permissions: { action: string; resource?: string; effect?: string }[];
    };
    expect(restored.permissions).toEqual([{ action: "bash", resource: "*", effect: "allow" }]);
  });

  test("opencode: a tier change replaces the plugins entry instead of accumulating a second", () => {
    const input = makeInput("opencode", "global", "forced", "optional");
    const config = join(input.home, ".config/opencode/opencode.jsonc");
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, JSON.stringify({ theme: "dark" }, null, 2));
    applyPlan(planForHost("opencode", input), input);
    type Plugins = { plugins: { package: string; options: Record<string, unknown> }[] };
    const afterForced = parseJsonc(readFileSync(config, "utf8")) as Plugins;
    expect(afterForced.plugins).toEqual([
      { package: "deepseek-web-retrieval", options: { setDefaultWebsearch: true } },
    ]);

    applyPlan(planForHost("opencode", { ...input, search: "optional" }), input);
    const afterOptional = parseJsonc(readFileSync(config, "utf8")) as Plugins;
    expect(afterOptional.plugins).toEqual([{ package: "deepseek-web-retrieval", options: {} }]);

    uninstall(input);
    expect(parseJsonc(readFileSync(config, "utf8"))).toEqual({ theme: "dark" });
  });

  test("pi: changing --package replaces the packages source instead of keeping both", () => {
    const input = makeInput("pi", "project", "optional", "optional");
    applyPlan(planForHost("pi", input), input);
    const settings = join(input.cwd, ".pi/settings.json");
    expect((parseJsonc(readFileSync(settings, "utf8")) as { packages: string[] }).packages).toEqual([
      "npm:deepseek-web-retrieval",
    ]);

    applyPlan(planForHost("pi", { ...input, packageRef: "deepseek-web-retrieval@canary" }), input);
    expect((parseJsonc(readFileSync(settings, "utf8")) as { packages: string[] }).packages).toEqual([
      "npm:deepseek-web-retrieval@canary",
    ]);

    uninstall(input);
    expect(existsSync(settings)).toBe(false);
  });

  test("list and uninstall run end to end through the CLI with injectable output", async () => {
    const home = mkdtempSync(join(tmpdir(), "dwr-cli2-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "dwr-cli2-cwd-"));
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const out: string[] = [];
      const io = { out: (line: string) => out.push(line), err: (line: string) => out.push(line) };
      expect(await runInstallerCli(["list", "--cwd", cwd], io)).toBe(0);
      expect(out.join("\n")).toContain("No installs recorded.");

      out.length = 0;
      const code = await runInstallerCli(
        [
          "init",
          "--host",
          "pi",
          "--scope",
          "project",
          "--search",
          "optional",
          "--fetch",
          "optional",
          "--path",
          "mcp",
          "--package",
          "deepseek-web-retrieval@canary",
          "--cwd",
          cwd,
          "--apply",
        ],
        io,
      );
      expect(code).toBe(0);
      const registered = JSON.parse(readFileSync(join(cwd, ".pi/mcp.json"), "utf8")) as {
        mcpServers: { deepseek: { args: string[] } };
      };
      expect(registered.mcpServers.deepseek.args).toContain("deepseek-web-retrieval@canary");

      out.length = 0;
      expect(await runInstallerCli(["list", "--cwd", cwd], io)).toBe(0);
      expect(out.join("\n")).toContain("pi (project)");

      out.length = 0;
      expect(await runInstallerCli(["uninstall", "--host", "pi", "--scope", "project", "--cwd", cwd], io)).toBe(0);
      expect(out.join("\n")).toContain("removed install record");
      expect(existsSync(join(cwd, ".pi/mcp.json"))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
  test("XDG_CONFIG_HOME routes the global config home when it belongs to the real home", async () => {
    const home = mkdtempSync(join(tmpdir(), "dwr-xdg-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "dwr-xdg-cwd-"));
    const xdg = join(home, "xdg");
    mkdirSync(xdg, { recursive: true });
    const previousHome = process.env.HOME;
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = xdg;
    try {
      const out: string[] = [];
      const code = await runInstallerCli(
        [
          "init",
          "--host",
          "opencode",
          "--scope",
          "global",
          "--search",
          "optional",
          "--fetch",
          "optional",
          "--cwd",
          cwd,
          "--apply",
        ],
        { out: (line: string) => out.push(line), err: (line: string) => out.push(line) },
      );
      expect(code).toBe(0);
      expect(existsSync(join(xdg, "opencode/opencode.jsonc"))).toBe(true);
      expect(existsSync(join(home, ".config/opencode/opencode.jsonc"))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
    }
  });
});

describe("pi extension path", () => {
  test("default path registers the package in settings.json and leaves mcp.json alone", () => {
    const input = makeInput("pi", "project", "optional", "optional");
    mkdirSync(join(input.cwd, ".pi"), { recursive: true });
    writeFileSync(join(input.cwd, ".pi/mcp.json"), JSON.stringify({ mcpServers: { github: { command: "npx" } } }));
    const plan = planPi(input, readRecord(input));
    expect(plan.errors).toEqual([]);
    expect(plan.edits.map((edit) => edit.file)).toEqual([join(input.cwd, ".pi/settings.json")]);
    const append = plan.edits
      .find((edit): edit is JsonEdit => edit.format === "json")
      ?.ops.find((op) => op.op === "append-array");
    expect(append && "entries" in append ? append.entries : undefined).toEqual(["npm:deepseek-web-retrieval"]);
    expect(plan.notes.join(" ")).toContain("session start");
    expect(plan.notes.join(" ")).toContain("no env forwarding");
  });

  test("off tiers write the settings namespace switches the extension reads", () => {
    const input = makeInput("pi", "global", "off", "optional");
    const plan = planPi(input, readRecord(input));
    const ops = plan.edits.find((edit) => edit.format === "json")?.ops ?? [];
    expect(
      ops.find((op) => op.op === "set" && op.path.join(".") === "deepseekWebRetrieval.enableSearch"),
    ).toMatchObject({ value: false });
    expect(ops.some((op) => op.path.join(".") === "deepseekWebRetrieval.enableFetch")).toBe(false);
    expect(plan.notes.join(" ")).toContain("deepseekWebRetrieval");
  });

  test("preferred rules name the unprefixed extension tool ids", () => {
    const input = makeInput("pi", "project", "preferred", "optional");
    const plan = planForHost("pi", input);
    expect(plan.errors).toEqual([]);
    const rules = plan.edits.find((edit) => edit.format === "rules");
    expect(rules && "block" in rules ? rules.block : "").toContain("- Use deepseek_web_search");
    expect(rules && "block" in rules ? rules.block : "").not.toContain("mcp__deepseek");
  });

  test("forced disables mcp.json competitors and refuses web-capable package sources", () => {
    const refused = makeInput("pi", "global", "forced", "optional");
    mkdirSync(join(refused.home, ".pi/agent"), { recursive: true });
    writeFileSync(
      join(refused.home, ".pi/agent/settings.json"),
      JSON.stringify({ packages: ["npm:@example/web-search-helper"] }),
    );
    const refusedPlan = planPi(refused, readRecord(refused));
    expect(refusedPlan.errors[0]?.message).toContain("npm:@example/web-search-helper");
    expect(refusedPlan.errors[0]?.message).toContain("no per-package kill switch");

    const input = makeInput("pi", "project", "forced", "optional");
    mkdirSync(join(input.cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(input.cwd, ".pi/mcp.json"),
      JSON.stringify({ mcpServers: { tavily: { command: "npx", enabled: true } } }),
    );
    const plan = planForHost("pi", input);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.map((edit) => edit.file)).toContain(join(input.cwd, ".pi/mcp.json"));
    const exclusion = plan.edits
      .find((edit): edit is JsonEdit => edit.format === "json" && edit.file.endsWith("mcp.json"))
      ?.ops.find((op: ConfigOp) => op.path.join(".") === "mcpServers.tavily.enabled");
    expect(exclusion && "value" in exclusion ? exclusion.value : undefined).toBe(false);
  });

  test("a foreign packages entry without a record is refused", () => {
    const input = makeInput("pi", "global", "optional", "optional");
    mkdirSync(join(input.home, ".pi/agent"), { recursive: true });
    writeFileSync(
      join(input.home, ".pi/agent/settings.json"),
      JSON.stringify({ packages: ["npm:deepseek-web-retrieval"] }),
    );
    const plan = planPi(input, readRecord(input));
    expect(plan.errors[0]?.message).toContain("did not write");
    expect(plan.errors[0]?.message).toContain("pi remove");
  });

  test("apply and uninstall round-trip restores settings.json exactly", () => {
    const input = makeInput("pi", "project", "off", "optional");
    mkdirSync(join(input.cwd, ".pi"), { recursive: true });
    const original = JSON.stringify({ theme: "dark" });
    writeFileSync(join(input.cwd, ".pi/settings.json"), original);
    const applied = applyPlan(planForHost("pi", input), input);
    expect(applied.ok).toBe(true);
    const after = JSON.parse(readFileSync(join(input.cwd, ".pi/settings.json"), "utf8")) as {
      theme: string;
      packages: string[];
      deepseekWebRetrieval: { enableSearch: boolean };
    };
    expect(after.theme).toBe("dark");
    expect(after.packages).toEqual(["npm:deepseek-web-retrieval"]);
    expect(after.deepseekWebRetrieval.enableSearch).toBe(false);
    uninstall(input);
    // The JSON codec restores the value, re-serialized with its own formatting.
    expect(JSON.parse(readFileSync(join(input.cwd, ".pi/settings.json"), "utf8"))).toEqual({ theme: "dark" });
  });

  test("re-init from the mcp path migrates: the mcp.json entry reverts as a whole-file orphan", () => {
    const input = makeInput("pi", "project", "optional", "optional", "mcp");
    applyPlan(planForHost("pi", input), input);
    expect(existsSync(join(input.cwd, ".pi/mcp.json"))).toBe(true);

    const migrated = { ...input, path: undefined } as InstallerInput;
    const plan = planForHost("pi", migrated);
    expect(plan.errors).toEqual([]);
    expect(plan.reverts?.map((file) => file.file)).toEqual([join(input.cwd, ".pi/mcp.json")]);
    applyPlan(plan, migrated);
    expect(existsSync(join(input.cwd, ".pi/mcp.json"))).toBe(false);
    const settings = JSON.parse(readFileSync(join(input.cwd, ".pi/settings.json"), "utf8")) as { packages: string[] };
    expect(settings.packages).toEqual(["npm:deepseek-web-retrieval"]);
    uninstall(migrated);
    expect(existsSync(join(input.cwd, ".pi/settings.json"))).toBe(false);
  });

  test("CLI --path validation refuses bad values and non-pi hosts", async () => {
    const out: string[] = [];
    const io = { out: (line: string) => out.push(line), err: (line: string) => out.push(line) };
    const base = ["--scope", "global", "--search", "optional", "--fetch", "optional", "--cwd", "/tmp"];
    expect(await runInstallerCli(["init", "--host", "pi", ...base, "--path", "bogus"], io)).toBe(1);
    expect(out.join("\n")).toContain('invalid --path value "bogus"');
    out.length = 0;
    expect(await runInstallerCli(["init", "--host", "codex", ...base, "--path", "mcp"], io)).toBe(1);
    expect(out.join("\n")).toContain("--path is only supported for host pi");
  });
});

describe("self-package detection", () => {
  test("pi: an unrelated similarly-named package is not refused and stays untouched", () => {
    const input = makeInput("pi", "global", "optional", "optional");
    mkdirSync(join(input.home, ".pi/agent"), { recursive: true });
    writeFileSync(
      join(input.home, ".pi/agent/settings.json"),
      JSON.stringify({ packages: ["npm:deepseek-web-retrieval-extra"] }),
    );
    const plan = planPi(input, readRecord(input));
    expect(plan.errors).toEqual([]);
    const append = plan.edits
      .find((edit): edit is JsonEdit => edit.format === "json")
      ?.ops.find((op) => op.op === "append-array");
    expect(append && "entries" in append ? append.entries : undefined).toEqual(["npm:deepseek-web-retrieval"]);
  });

  test("pi: untracked forks, pinned versions, and tarballs of this package are refused", () => {
    const input = makeInput("pi", "global", "optional", "optional");
    mkdirSync(join(input.home, ".pi/agent"), { recursive: true });
    writeFileSync(
      join(input.home, ".pi/agent/settings.json"),
      JSON.stringify({
        packages: [
          "npm:deepseek-web-retrieval@0.3.0",
          "github:gwokhou/deepseek-web-retrieval",
          "npm:file:/tmp/deepseek-web-retrieval-0.5.0.tgz",
        ],
      }),
    );
    const plan = planPi(input, readRecord(input));
    expect(plan.errors.length).toBe(1);
    expect(plan.errors[0]?.message).toContain("did not write");
    expect(plan.errors[0]?.message).toContain("pi remove");
    expect(plan.edits).toEqual([]);
  });

  test("pi: the installer's own tracked fork source is never flagged as an unexcludable competitor", () => {
    const fork = makeInput("pi", "project", "optional", "optional");
    const withFork = { ...fork, packageRef: "my-web-search-fork" };
    applyPlan(planForHost("pi", withFork), withFork);

    // Without a record the same web-capable-looking source is refused…
    const untracked = makeInput("pi", "project", "forced", "optional");
    mkdirSync(join(untracked.cwd, ".pi"), { recursive: true });
    writeFileSync(join(untracked.cwd, ".pi/settings.json"), JSON.stringify({ packages: ["npm:my-web-search-fork"] }));
    expect(planPi(untracked, readRecord(untracked)).errors[0]?.message).toContain("npm:my-web-search-fork");

    // …but once the install is tracked, forced does not flag its own source.
    expect(planForHost("pi", { ...withFork, search: "forced" }).errors).toEqual([]);
  });

  test("pi: a web-capable package whose name merely contains ours cannot bypass the forced refusal", () => {
    const input = makeInput("pi", "global", "forced", "optional");
    mkdirSync(join(input.home, ".pi/agent"), { recursive: true });
    writeFileSync(
      join(input.home, ".pi/agent/settings.json"),
      JSON.stringify({ packages: ["npm:deepseek-web-retrieval-search-fork"] }),
    );
    const plan = planPi(input, readRecord(input));
    expect(plan.errors[0]?.message).toContain("Forced cannot deliver exclusive routing");
    expect(plan.errors[0]?.message).toContain("npm:deepseek-web-retrieval-search-fork");
  });

  test("pi: a --package ref already carrying the npm: source prefix is written as-is", () => {
    const input = makeInput("pi", "project", "optional", "optional");
    const plan = planPi({ ...input, packageRef: "npm:deepseek-web-retrieval@canary" }, readRecord(input));
    expect(plan.errors).toEqual([]);
    const append = plan.edits
      .find((edit): edit is JsonEdit => edit.format === "json")
      ?.ops.find((op) => op.op === "append-array");
    expect(append && "entries" in append ? append.entries : undefined).toEqual(["npm:deepseek-web-retrieval@canary"]);
  });

  test("opencode: an unrelated similarly-named plugin package is not refused", () => {
    const input = makeInput("opencode", "global", "forced", "optional");
    const config = join(input.home, ".config/opencode");
    mkdirSync(config, { recursive: true });
    writeFileSync(
      join(config, "opencode.jsonc"),
      JSON.stringify({ plugins: [{ package: "deepseek-web-retrieval-extra" }] }, null, 2),
    );
    expect(planOpenCode(input, readRecord(input)).errors).toEqual([]);
  });
});

function relativePath(from: string, to: string): string {
  return to.startsWith(from) ? to.slice(from.length + 1) : to;
}

describe("whole-repo review regressions", () => {
  const begin = "<!-- deepseek-web-retrieval:pi:rules:begin -->";
  const end = "<!-- deepseek-web-retrieval:pi:rules:end -->";

  for (const malformed of [begin, end, `${end}\n${begin}`, `${begin}\n${begin}\n${end}`, `${begin}\n${end}\n${end}`]) {
    test(`refuses malformed rules without losing user content: ${malformed}`, () => {
      const input = makeInput("pi", "project", "preferred", "optional");
      const rules = join(input.cwd, "AGENTS.md");
      const original = `# Project rules\n${malformed}\n# User policy\nNever touch production.\n`;
      writeFileSync(rules, original);
      const plan = planForHost("pi", input);
      expect(plan.errors.map((error) => error.message).join(" ")).toContain("malformed rules block");
      expect(() => applyPlan(plan, input)).toThrow();
      expect(readFileSync(rules, "utf8")).toBe(original);
      expect(existsSync(join(input.cwd, ".pi/settings.json"))).toBe(false);
      expect(readRecord(input)).toBeUndefined();
    });
  }

  test("rules damaged after planning refuse before any configuration is written", () => {
    const input = makeInput("pi", "project", "preferred", "optional");
    const plan = planForHost("pi", input);
    const rules = join(input.cwd, "AGENTS.md");
    const damaged = `${begin}\n# User policy\nNever touch production.\n`;
    writeFileSync(rules, damaged);
    expect(() => applyPlan(plan, input)).toThrow("malformed rules block");
    expect(readFileSync(rules, "utf8")).toBe(damaged);
    expect(existsSync(join(input.cwd, ".pi/settings.json"))).toBe(false);
  });

  test("uninstall preserves all files and the record while a rules block is malformed", () => {
    const input = makeInput("pi", "project", "preferred", "optional");
    applyPlan(planForHost("pi", input), input);
    const rules = join(input.cwd, "AGENTS.md");
    const settings = join(input.cwd, ".pi/settings.json");
    const configBefore = readFileSync(settings, "utf8");
    const recordBefore = readRecord(input);
    const damaged = `${readFileSync(rules, "utf8").replace(end, "")}\n# User policy\n`;
    writeFileSync(rules, damaged);
    expect(() => uninstall(input)).toThrow("malformed rules block");
    expect(readFileSync(rules, "utf8")).toBe(damaged);
    expect(readFileSync(settings, "utf8")).toBe(configBefore);
    expect(readRecord(input)).toEqual(recordBefore);
  });

  for (const path of ["extension", "mcp"] as const) {
    test(`Pi ${path} forced re-init preserves exclusions and original enabled values`, () => {
      const input = makeInput("pi", "project", "forced", "optional", path);
      const file = join(input.cwd, ".pi/mcp.json");
      const original = {
        mcpServers: {
          tavily: { command: "npx", enabled: true },
          brave: { command: "npx" },
          exa: { command: "npx", enabled: false },
        },
      };
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(original));
      for (let run = 0; run < 3; run += 1) {
        expect(applyPlan(planForHost("pi", input), input).ok).toBe(true);
        const servers = JSON.parse(readFileSync(file, "utf8")).mcpServers;
        for (const name of ["tavily", "brave", "exa"]) expect(servers[name].enabled).toBe(false);
      }
      // A real downgrade still restores competitors, and uninstall restores the original config.
      const optional = { ...input, search: "optional" as const };
      expect(applyPlan(planForHost("pi", optional), optional).ok).toBe(true);
      const servers = JSON.parse(readFileSync(file, "utf8")).mcpServers;
      for (const name of ["tavily", "brave", "exa"] as const) expect(servers[name]).toEqual(original.mcpServers[name]);
      uninstall(optional);
      expect(parseJsonc(readFileSync(file, "utf8"))).toEqual(original);
    });
  }

  for (const secondScope of ["project", "global"] as const) {
    test(`Codex rejects another project's ${secondScope} install and permits it after uninstall`, () => {
      const first = makeInput("codex", "project", "optional", "optional");
      const second = { ...first, scope: secondScope, cwd: mkdtempSync(join(tmpdir(), "dwr-other-project-")) };
      applyPlan(planForHost("codex", first), first);
      const config = join(first.home, ".codex/config.toml");
      const before = readFileSync(config, "utf8");
      const plan = planForHost("codex", second);
      expect(plan.errors.length).toBeGreaterThan(0);
      expect(plan.errors[0]?.message).toContain(first.cwd);
      expect(() => applyPlan(plan, second)).toThrow();
      expect(readFileSync(config, "utf8")).toBe(before);
      uninstall(first);
      const afterUninstall = planForHost("codex", second);
      expect(afterUninstall.errors).toEqual([]);
      expect(applyPlan(afterUninstall, second).ok).toBe(true);
      uninstall(second);
      expect(existsSync(config)).toBe(false);
    });
  }

  test("Codex apply rechecks ownership acquired after the plan was rendered", () => {
    const first = makeInput("codex", "project", "optional", "optional");
    const second = { ...first, cwd: mkdtempSync(join(tmpdir(), "dwr-other-project-")) };
    const stalePlan = planForHost("codex", second);
    applyPlan(planForHost("codex", first), first);
    const config = join(first.home, ".codex/config.toml");
    const before = readFileSync(config, "utf8");
    expect(() => applyPlan(stalePlan, second)).toThrow();
    expect(readFileSync(config, "utf8")).toBe(before);
    expect(readRecord(second)).toBeUndefined();
    uninstall(first);
  });

  test("Codex uninstall rejects a copied record owned by a different project", () => {
    const first = makeInput("codex", "project", "optional", "optional");
    const second = { ...first, cwd: mkdtempSync(join(tmpdir(), "dwr-other-project-")) };
    applyPlan(planForHost("codex", first), first);
    const record = readRecord(first);
    expect(record).toBeDefined();
    if (!record) throw new Error("missing fixture record");
    writeRecord(second, record);
    const file = join(first.home, ".codex/config.toml");
    const before = readFileSync(file, "utf8");
    expect(() => uninstall(second)).toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readRecord(second)).toEqual(record);
    uninstall(first);
  });

  for (const host of ["pi", "codex"] as const) {
    for (const search of ["preferred", "optional"] as const) {
      test(`${host} only steers the preferred capability when search is ${search}`, () => {
        const input = makeInput(host, "project", search, search === "preferred" ? "optional" : "preferred");
        const plan = planForHost(host, input);
        const block = plan.edits.find((edit): edit is RulesEdit => edit.format === "rules")?.block ?? "";
        expect(block.includes("deepseek_web_search")).toBe(input.search === "preferred");
        expect(block.includes("deepseek_fetch")).toBe(input.fetch === "preferred");
        expect(applyPlan(plan, input).ok).toBe(true);
        expect(readFileSync(join(input.cwd, "AGENTS.md"), "utf8")).toContain(block);
        uninstall(input);
      });
    }
  }
});

describe("shared config ownership lifecycle", () => {
  test("a failed first apply releases its claim so another project can install", () => {
    const first = makeInput("codex", "project", "optional", "optional");
    mkdirSync(join(first.cwd, ".deepseek-web-retrieval/install.codex.json"), { recursive: true });
    expect(() => applyPlan(planForHost("codex", first), first)).toThrow("apply failed and was rolled back");
    expect(existsSync(join(first.home, ".codex"))).toBe(false);
    const second = { ...first, cwd: mkdtempSync(join(tmpdir(), "dwr-other-project-")) };
    expect(applyPlan(planForHost("codex", second), second).ok).toBe(true);
    uninstall(second);
  });

  test("a failed re-init retains the previous owner's claim and original undo state", () => {
    const first = makeInput("codex", "project", "optional", "optional");
    applyPlan(planForHost("codex", first), first);
    const config = join(first.home, ".codex/config.toml");
    const before = readFileSync(config, "utf8");
    const recorded = readRecord(first);
    symlinkSync("missing-directory/AGENTS.md", join(first.cwd, "AGENTS.md"));
    const reinit = { ...first, search: "preferred" as const };
    expect(() => applyPlan(planForHost("codex", reinit), reinit)).toThrow("apply failed and was rolled back");
    expect(readFileSync(config, "utf8")).toBe(before);
    expect(readRecord(first)).toEqual(recorded);
    const second = { ...first, cwd: mkdtempSync(join(tmpdir(), "dwr-other-project-")) };
    expect(planForHost("codex", second).errors[0]?.message).toContain(first.cwd);
    uninstall(first);
  });

  test("ownership is independent of XDG config home and follows a symlinked home", () => {
    const first = makeInput("codex", "project", "optional", "optional");
    applyPlan(planForHost("codex", first), first);
    const cwd = mkdtempSync(join(tmpdir(), "dwr-other-project-"));
    const alias = join(cwd, "home-alias");
    symlinkSync(first.home, alias);
    const second = { ...first, cwd, home: alias, configHome: join(cwd, "other-config-home") };
    expect(planForHost("codex", second).errors[0]?.message).toContain(first.cwd);
    uninstall(first);
  });

  test("legacy generated registrations cannot be adopted from another project, and re-init migrates the owner", () => {
    const first = makeInput("codex", "project", "optional", "optional");
    applyPlan(planForHost("codex", first), first);
    const directory = join(first.home, ".codex");
    // Recreate the older on-disk format: a project record with no ownership metadata.
    for (const name of readdirSync(directory)) {
      if (name.endsWith(".owner.json")) rmSync(join(directory, name));
    }
    const record = readRecord(first);
    if (!record) throw new Error("missing fixture record");
    writeRecord(first, { ...record, files: record.files.map(({ shared: _shared, ...file }) => file) });
    const second = { ...first, cwd: mkdtempSync(join(tmpdir(), "dwr-other-project-")) };
    expect(planForHost("codex", second).errors[0]?.message).toContain("older install");
    expect(applyPlan(planForHost("codex", first), first).ok).toBe(true);
    const claims = readdirSync(directory).filter((name) => name.endsWith(".owner.json"));
    expect(claims.length).toBe(1);
    expect(statSync(join(directory, claims[0])).mode & 0o777).toBe(0o600);
    expect(planForHost("codex", second).errors[0]?.message).toContain(first.cwd);
    uninstall(first);
    expect(existsSync(directory)).toBe(false);
  });
});
