import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { applyPlan } from "../../src/installer/apply"
import { applyJsonOps, revertJsonOps } from "../../src/installer/configFile"
import { parseJsonc } from "../../src/core/jsonc"
import { planForHost } from "../../src/installer/hosts"
import { planCodex } from "../../src/installer/hosts/codex"
import { planOpenCode } from "../../src/installer/hosts/opencode"
import { planPi } from "../../src/installer/hosts/pi"
import { buildRulesBlock, hasBlock, removeBlock, upsertBlock } from "../../src/installer/rules"
import { hasTomlComment } from "../../src/installer/configFile"
import { renderPlan } from "../../src/installer/render"
import { runInstallerCli } from "../../src/installer/cli"
import { readFileSync as fsReadFileSync, statSync } from "node:fs"
import { claimedByOtherScope, readRecord, writeRecord } from "../../src/installer/state"
import { listRecords } from "../../src/installer/state"
import { uninstall } from "../../src/installer/uninstall"
import type { InstallerInput } from "../../src/installer/types"

const homes: string[] = []
const cwds: string[] = []

afterEach(() => {
  // Temp dirs are left for the OS cleaner; nothing to restore process-wide.
  homes.length = 0
  cwds.length = 0
})

function makeInput(host: InstallerInput["host"], scope: InstallerInput["scope"], search: InstallerInput["search"], fetch: InstallerInput["fetch"]): InstallerInput {
  const home = mkdtempSync(join(tmpdir(), "dwr-home-"))
  const cwd = mkdtempSync(join(tmpdir(), "dwr-cwd-"))
  homes.push(home)
  cwds.push(cwd)
  return { host, scope, search, fetch, packageRef: "deepseek-web-retrieval", home, cwd }
}

describe("json config editing", () => {
  test("applyJsonOps preserves comments and is idempotent", () => {
    const text = `{\n  // keep me\n  "a": 1,\n}\n`
    const ops = [
      { op: "append-array", path: ["plugins"], entries: [{ package: "x" }] },
      { op: "set", path: ["websearch", "provider"], value: "deepseek" },
    ] as const
    const first = applyJsonOps(text, [...ops])
    expect(first.text).toContain("// keep me")
    const second = applyJsonOps(first.text, [...ops])
    expect(second.recorded[0]?.applied).toEqual([])
    expect(second.text).toBe(first.text)
  })

  test("revertJsonOps restores snapshots and leaves user-modified values untouched", () => {
    const text = `{\n  "websearch": { "provider": "tavily" },\n  "permissions": [{ "action": "bash" }],\n}\n`
    const applied = applyJsonOps(text, [
      { op: "set", path: ["websearch", "provider"], value: "deepseek" },
      { op: "append-array", path: ["permissions"], entries: [{ action: "websearch" }] },
    ])
    // The user changes the provider again after the install.
    const userEdited = applyJsonOps(applied.text, [{ op: "set", path: ["websearch", "provider"], value: "exa" }])
    const reverted = revertJsonOps(userEdited.text, applied.recorded, applied.createdParents)
    const value = parseJsonc(reverted.text) as { websearch: { provider: string }; permissions: { action: string }[] }
    expect(value.websearch.provider).toBe("exa") // user edit wins
    expect(value.permissions).toEqual([{ action: "bash" }]) // our entry still removed
    expect(reverted.notes.join(" ")).toContain("left untouched")
  })
})

describe("rules blocks", () => {
  const block = buildRulesBlock("pi", ["line one", "line two"])

  test("upsert appends to a new file and replaces an existing block without duplicating", () => {
    expect(upsertBlock("pi", "", block)).toBe(`${block}\n`)
    const once = upsertBlock("pi", "# project rules\n", block)
    expect(hasBlock("pi", once)).toBe(true)
    expect(once).toContain("# project rules")
    const twice = upsertBlock("pi", once, buildRulesBlock("pi", ["changed"]))
    expect(twice.match(/deepseek-web-retrieval:pi:rules:begin/g)?.length).toBe(1)
    expect(twice).toContain("changed")
    expect(removeBlock("pi", twice)).toBe("# project rules\n")
  })
})

describe("plans", () => {
  test("pi: registers with direct exposure, notes other servers, and adds rules for preferred", () => {
    const input = makeInput("pi", "project", "preferred", "optional")
    mkdirSync(join(input.cwd, ".pi"), { recursive: true })
    writeFileSync(
      join(input.cwd, ".pi/mcp.json"),
      JSON.stringify({ mcpServers: { tavily: { command: "npx" } } }, null, 2),
    )
    const plan = planPi(input)
    expect(plan.errors).toEqual([])
    const configEdit = plan.edits.find((edit) => edit.format === "json")
    expect(configEdit?.file).toBe(join(input.cwd, ".pi/mcp.json"))
    const setOp = configEdit?.ops.find((op) => op.op === "set")
    expect(setOp && "value" in setOp ? (setOp.value as { exposure: string }).exposure : undefined).toBe("direct")
    expect(plan.edits.some((edit) => edit.format === "rules")).toBe(true)
    expect(plan.notes.join(" ")).toContain("tavily")
  })

  test("pi: off tiers write DEEPSEEK_ENABLE flags into the env block", () => {
    const input = makeInput("pi", "global", "off", "optional")
    const plan = planPi(input)
    const setOp = plan.edits[0]?.ops[0]
    const env = setOp && "value" in setOp ? ((setOp.value as { env: Record<string, string> }).env ?? {}) : {}
    expect(env.DEEPSEEK_ENABLE_SEARCH).toBe("false")
    expect(env.DEEPSEEK_ENABLE_FETCH).toBeUndefined()
  })

  test("opencode: rejects the structurally unavailable search tier and duplicate plugin entries", () => {
    const preferred = makeInput("opencode", "global", "preferred", "optional")
    const preferredPlan = planOpenCode(preferred)
    expect(preferredPlan.errors.length).toBe(1)
    expect(preferredPlan.errors[0]?.message).toContain("no preferred tier")

    const input = makeInput("opencode", "global", "forced", "optional")
    const config = join(input.home, ".config/opencode")
    mkdirSync(config, { recursive: true })
    writeFileSync(
      join(config, "opencode.jsonc"),
      JSON.stringify({ plugins: [{ package: "github:gwokhou/deepseek-web-retrieval" }] }, null, 2),
    )
    const plan = planOpenCode(input)
    expect(plan.errors.length).toBe(1)
    expect(plan.errors[0]?.message).toContain("already has a plugins entry")
  })

  test("opencode: forced search snapshots the current provider and appends permissions", () => {
    const input = makeInput("opencode", "global", "forced", "forced")
    const config = join(input.home, ".config/opencode")
    mkdirSync(config, { recursive: true })
    writeFileSync(
      join(config, "opencode.jsonc"),
      `// comment\n{ "websearch": { "provider": "tavily" }, "permissions": [{ "action": "bash", "resource": "*", "effect": "allow" }] }\n`,
    )
    const plan = planOpenCode(input)
    expect(plan.errors).toEqual([])
    expect(plan.notes.join(" ")).toContain("tavily")
    const permissions = plan.edits[0]?.ops.find((op) => op.op === "append-array" && op.path[0] === "permissions")
    expect(permissions && "entries" in permissions ? (permissions.entries ?? []).map((entry) => (entry as { action: string }).action) : []).toEqual(["websearch", "deepseek_fetch", "webfetch"])
  })

  test("codex: detects the [tools] no-op trap and plans the web_search kill switch", () => {
    const trapped = makeInput("codex", "global", "optional", "optional")
    const dir = join(trapped.home, ".codex")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "config.toml"), '[tools]\nweb_search = false\n')
    expect(planCodex(trapped).errors[0]?.message).toContain("no-op")

    const input = makeInput("codex", "global", "forced", "optional")
    const dir2 = join(input.home, ".codex")
    mkdirSync(dir2, { recursive: true })
    writeFileSync(join(dir2, "config.toml"), 'model = "gpt-5.2"\nweb_search = "live"\n')
    const plan = planCodex(input)
    expect(plan.errors).toEqual([])
    const ops = plan.edits[0]?.ops ?? []
    expect(ops.some((op) => op.op === "set" && op.path.join(".") === "web_search" && op.value === "disabled")).toBe(true)
    expect(plan.notes.join(" ")).toContain('"live"')
    expect(plan.notes.join(" ")).toContain("env_vars")
  })

  test("codex: project scope reports the global fallback for config.toml", () => {
    const input = makeInput("codex", "project", "preferred", "optional")
    const plan = planCodex(input)
    expect(plan.notes.join(" ")).toContain("user level")
    expect(plan.edits.find((edit) => edit.format === "rules")?.file).toBe(join(input.cwd, "AGENTS.md"))
    expect(plan.edits.find((edit) => edit.format === "toml")?.file).toBe(join(input.home, ".codex/config.toml"))
  })
})

describe("apply and uninstall round-trips", () => {
  test("pi project: creates, verifies, and fully removes on uninstall", () => {
    const input = makeInput("pi", "project", "optional", "optional")
    const plan = planPi(input)
    const applied = applyPlan(plan, input)
    expect(applied.ok).toBe(true)
    expect(existsSync(join(input.cwd, ".pi/mcp.json"))).toBe(true)
    expect(listRecords(input.home, input.cwd).map((record) => record.host)).toContain("pi")
    uninstall(input)
    expect(existsSync(join(input.cwd, ".pi/mcp.json"))).toBe(false)
    expect(listRecords(input.home, input.cwd)).toEqual([])
  })

  test("opencode global: snapshot restores the competitor, comments survive, re-apply is a no-op", () => {
    const input = makeInput("opencode", "global", "forced", "preferred")
    const config = join(input.home, ".config/opencode")
    mkdirSync(config, { recursive: true })
    const original = `{\n  // keep me\n  "websearch": { "provider": "tavily" },\n  "permissions": [{ "action": "bash", "resource": "*", "effect": "allow" }],\n}\n`
    writeFileSync(join(config, "opencode.jsonc"), original)
    const plan = planOpenCode(input)
    const first = applyPlan(plan, input)
    expect(first.ok).toBe(true)
    const afterFirst = readFileSync(join(config, "opencode.jsonc"), "utf8")
    expect(afterFirst).toContain("// keep me")
    expect(afterFirst).toContain('"deepseek"')
    // Re-apply dedupes: nothing new appended.
    const second = applyPlan(planOpenCode(input), input)
    expect(second.ok).toBe(true)
    const afterSecond = readFileSync(join(config, "opencode.jsonc"), "utf8")
    expect((afterSecond.match(/deepseek-web-retrieval/g) ?? []).length).toBe((afterFirst.match(/deepseek-web-retrieval/g) ?? []).length)
    uninstall(input)
    const restored = readFileSync(join(config, "opencode.jsonc"), "utf8")
    const restoredValue = parseJsonc(restored) as { websearch: { provider: string }; permissions: { action: string; resource?: string; effect?: string }[]; plugins?: unknown[] }
    expect(restored).toContain('"tavily"')
    expect(restoredValue.websearch.provider).toBe("tavily")
    expect(restoredValue.permissions).toEqual([{ action: "bash", resource: "*", effect: "allow" }])
    expect(restoredValue.plugins).toBeUndefined()
    expect(existsSync(join(config, "AGENTS.md"))).toBe(false)
  })

  test("codex global: writes the TOML entry and kill switch, restores web_search on uninstall", () => {
    const input = makeInput("codex", "global", "forced", "optional")
    const dir = join(input.home, ".codex")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "config.toml"), '# my comment\nmodel = "gpt-5.2"\nweb_search = "live"\n\n[mcp_servers.github]\ncommand = "npx"\n')
    const plan = planCodex(input)
    expect(plan.notes.join(" ")).toContain("comments")
    const applied = applyPlan(plan, input)
    expect(applied.ok).toBe(true)
    const text = readFileSync(join(dir, "config.toml"), "utf8")
    expect(text).toContain("[mcp_servers.deepseek]")
    expect(text).toContain('web_search = "disabled"')
    expect(text).toContain("[mcp_servers.github]")
    expect(text).toContain("env_vars")
    uninstall(input)
    const restored = readFileSync(join(dir, "config.toml"), "utf8")
    expect(restored).toContain('web_search = "live"')
    expect(restored).toContain("[mcp_servers.github]")
    expect(restored).not.toContain("mcp_servers.deepseek")
  })

  test("codex forced refuses while a web-capable MCP server stays registered", () => {
    const input = makeInput("codex", "global", "forced", "optional")
    const dir = join(input.home, ".codex")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "config.toml"), '[mcp_servers.tavily]\ncommand = "npx"\n')
    const plan = planForHost("codex", input)
    expect(plan.errors.length).toBe(1)
    expect(plan.errors[0]?.message).toContain("mcp_servers.tavily")
    expect(plan.errors[0]?.message).toContain("no per-server kill switch")
    expect(existsSync(join(dir, "config.toml"))).toBe(true)
    expect(readFileSync(join(dir, "config.toml"), "utf8")).not.toContain("deepseek")
  })

  test("pi forced disables web-capable competitors and restores them on uninstall", () => {
    const input = makeInput("pi", "project", "forced", "optional")
    mkdirSync(join(input.cwd, ".pi"), { recursive: true })
    writeFileSync(
      join(input.cwd, ".pi/mcp.json"),
      JSON.stringify({
        mcpServers: {
          tavily: { command: "npx", args: ["-y", "tavily-mcp"], enabled: true },
          github: { command: "npx", args: ["-y", "@github/mcp"] },
        },
      }, null, 2),
    )
    const plan = planForHost("pi", input)
    expect(plan.errors).toEqual([])
    const exclusion = plan.edits[0]?.ops.find((op) => op.op === "set" && op.path.join(".") === "mcpServers.tavily.enabled")
    expect(exclusion && "value" in exclusion ? exclusion.value : undefined).toBe(false)
    expect(exclusion && "previous" in exclusion ? exclusion.previous : undefined).toBe(true)
    expect(plan.notes.join(" ")).toContain("tavily")
    expect(plan.notes.join(" ")).toContain("not exclusive")
    applyPlan(plan, input)
    const applied = JSON.parse(readFileSync(join(input.cwd, ".pi/mcp.json"), "utf8")) as {
      mcpServers: Record<string, { enabled?: boolean }>
    }
    expect(applied.mcpServers.tavily?.enabled).toBe(false)
    expect(applied.mcpServers.github?.enabled).toBeUndefined()
    uninstall(input)
    const restored = JSON.parse(readFileSync(join(input.cwd, ".pi/mcp.json"), "utf8")) as {
      mcpServers: Record<string, { enabled?: boolean }>
    }
    expect(restored.mcpServers.tavily?.enabled).toBe(true)
    expect(restored.mcpServers.github).toBeDefined()
  })

  test("preferred notes existing rules steering toward another web tool", () => {
    const input = makeInput("pi", "project", "preferred", "optional")
    writeFileSync(join(input.cwd, "AGENTS.md"), "# Rules\n\nAlways use the built-in webfetch tool for pages.\n")
    const plan = planForHost("pi", input)
    expect(plan.errors).toEqual([])
    expect(plan.notes.join(" ")).toContain("steer toward other web tools")
    expect(plan.notes.join(" ")).toContain("built-in webfetch")
  })

  test("forced plans point at the README's privacy-and-cost section", () => {
    const input = makeInput("codex", "global", "forced", "optional")
    const plan = planForHost("codex", input)
    expect(plan.notes.join(" ")).toContain('README\'s "Privacy and cost" section')
  })

  test("uninstall refuses when nothing is recorded", () => {
    const input = makeInput("pi", "global", "optional", "optional")
    expect(() => uninstall(input)).toThrow(/No pi install is recorded/)
  })

  test("pi rejects installing with both capabilities off", () => {
    const input = makeInput("pi", "global", "off", "off")
    const plan = planPi(input)
    expect(plan.errors.length).toBe(1)
    expect(plan.errors[0]?.message).toContain("Both capabilities are off")
  })

  test("tier downgrade reverts the previous init's artifacts instead of orphaning them", () => {
    const input = makeInput("codex", "global", "forced", "optional")
    const dir = join(input.home, ".codex")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "config.toml"), 'model = "gpt-5.2"\nweb_search = "live"\n')
    // Install forced: web_search is disabled and snapshotted.
    applyPlan(planForHost("codex", input), input)
    expect(readFileSync(join(dir, "config.toml"), "utf8")).toContain('web_search = "disabled"')
    // Downgrade to optional: the plan carries an explicit revert.
    const downgraded = planForHost("codex", { ...input, search: "optional" })
    expect(downgraded.reverts?.length).toBe(1)
    expect(downgraded.reverts?.[0]?.ops.some((op: { op: string; path: readonly string[] }) => op.op === "set" && op.path[0] === "web_search")).toBe(true)
    applyPlan(downgraded, input)
    // The revert is partial (the new plan still claims config.toml), so the file
    // must survive the revert even though the installer created it.
    expect(existsSync(join(dir, "config.toml"))).toBe(true)
    expect(readFileSync(join(dir, "config.toml"), "utf8")).toContain('web_search = "live"')
    // Uninstall is complete: nothing from either install remains.
    uninstall(input)
    const restored = readFileSync(join(dir, "config.toml"), "utf8")
    expect(restored).toContain('web_search = "live"')
    expect(restored).not.toContain("mcp_servers.deepseek")
  })

  test("preferred → forced downgrade removes the orphaned rules block", () => {
    const input = makeInput("opencode", "global", "off", "preferred")
    applyPlan(planForHost("opencode", input), input)
    const rulesFile = join(input.home, ".config/opencode/AGENTS.md")
    expect(existsSync(rulesFile)).toBe(true)
    const upgraded = planForHost("opencode", { ...input, fetch: "forced" })
    expect(upgraded.reverts?.some((revert: { format: string }) => revert.format === "rules")).toBe(true)
    applyPlan(upgraded, input)
    expect(existsSync(rulesFile)).toBe(false)
    uninstall(input)
    expect(existsSync(join(input.home, ".config/opencode/opencode.jsonc"))).toBe(false)
  })
})


describe("review fixes", () => {
  test("plan renders old values for set ops and existing counts for appends", () => {
    const input = makeInput("pi", "global", "optional", "optional")
    mkdirSync(join(input.home, ".pi/agent"), { recursive: true })
    writeFileSync(
      join(input.home, ".pi/agent/mcp.json"),
      JSON.stringify({ mcpServers: { deepseek: { command: "node", args: ["/old/cli.js"] } } }, null, 2),
    )
    const rendered = renderPlan(planForHost("pi", input))
    expect(rendered).toContain("(was ")
    expect(rendered).toContain("/old/cli.js")

    const oc = makeInput("opencode", "global", "forced", "optional")
    const config = join(oc.home, ".config/opencode")
    mkdirSync(config, { recursive: true })
    writeFileSync(
      join(config, "opencode.jsonc"),
      JSON.stringify({ permissions: [{ action: "bash", resource: "*", effect: "allow" }] }, null, 2),
    )
    const ocRendered = renderPlan(planForHost("opencode", oc))
    expect(ocRendered).toContain("1 existing kept")
  })

  test("detects trailing TOML comments, not just comment lines", () => {
    expect(hasTomlComment('model = "gpt" # my note\n')).toBe(true)
    expect(hasTomlComment('# full line\n')).toBe(true)
    expect(hasTomlComment('url = "https://x.com/a#b"\n')).toBe(false)
    expect(hasTomlComment('model = "gpt"\n')).toBe(false)
  })

  test("install records are written owner-only", () => {
    const input = makeInput("pi", "global", "optional", "optional")
    applyPlan(planForHost("pi", input), input)
    const { statePathFor } = require("../../src/installer/state") as typeof import("../../src/installer/state")
    const mode = statSync(statePathFor(input)).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test("refuses to snapshot an existing entry containing a literal API key", () => {
    const input = makeInput("codex", "global", "optional", "optional")
    const dir = join(input.home, ".codex")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "config.toml"),
      '[mcp_servers.deepseek]\ncommand = "node"\nargs = ["x"]\n\n[mcp_servers.deepseek.env]\nDEEPSEEK_API_KEY = "sk-real-secret"\n',
    )
    const plan = planForHost("codex", input)
    expect(plan.errors.length).toBe(1)
    expect(plan.errors[0]?.message).toContain("credential")
    expect(plan.edits).toEqual([])
  })

  test("re-init over the installer's own ${VAR} indirection is not treated as a secret", () => {
    const input = makeInput("pi", "global", "optional", "optional")
    applyPlan(planForHost("pi", input), input)
    // The written entry carries env.DEPSEEK_API_KEY = "${DEEPSEEK_API_KEY}"; a
    // re-init must snapshot that indirection form, not refuse it as a literal key.
    const reinit = planForHost("pi", input)
    expect(reinit.errors).toEqual([])
    expect(reinit.edits.length).toBeGreaterThan(0)
    applyPlan(reinit, input)
    uninstall(input)
    expect(existsSync(join(input.home, ".pi", "agent", "mcp.json"))).toBe(false)
  })

  test("per-host markers let pi and codex share one AGENTS.md", () => {
    const piInput = makeInput("pi", "project", "preferred", "off")
    applyPlan(planForHost("pi", piInput), piInput)
    const codexInput = { ...piInput, host: "codex" as const }
    applyPlan(planForHost("codex", codexInput), codexInput)
    const agents = join(piInput.cwd, "AGENTS.md")
    const both = fsReadFileSync(agents, "utf8")
    expect(hasBlock("pi", both)).toBe(true)
    expect(hasBlock("codex", both)).toBe(true)

    uninstall(piInput)
    const afterPi = fsReadFileSync(agents, "utf8")
    expect(hasBlock("pi", afterPi)).toBe(false)
    expect(hasBlock("codex", afterPi)).toBe(true)

    uninstall(codexInput)
    expect(existsSync(agents)).toBe(false)
  })

  test("runInstallerCli resolves --cwd to an absolute record path and gates on --apply", async () => {
    const logs: string[] = []
    const errorsOut: string[] = []
    const originalLog = console.log
    const originalError = console.error
    console.log = (line: string) => logs.push(line)
    console.error = (line: string) => errorsOut.push(line)
    try {
      const home = mkdtempSync(join(tmpdir(), "dwr-cli-home-"))
      const cwd = mkdtempSync(join(tmpdir(), "dwr-cli-cwd-"))
      const relative = relativePath(process.cwd(), cwd)
      const code = await runInstallerCli([
        "init", "--host", "pi", "--scope", "project", "--search", "optional", "--fetch", "optional",
        "--home", home, "--cwd", relative,
      ])
      // --home is not a known flag; the CLI must reject it instead of guessing.
      expect(code).toBe(1)
      expect(errorsOut.join("\n")).toContain("unknown flag --home")
      expect(logs.join("\n")).not.toContain("--apply")

      const code2 = await runInstallerCli([
        "init", "--host", "pi", "--scope", "project", "--search", "optional", "--fetch", "optional",
        "--cwd", relative,
      ])
      expect(code2).toBe(0)
      expect(logs.join("\n")).toContain("Plan only")
      expect(existsSync(join(cwd, ".pi/mcp.json"))).toBe(false)

      const code3 = await runInstallerCli([
        "init", "--host", "pi", "--scope", "project", "--search", "false", "--fetch", "optional",
        "--cwd", cwd, "--apply",
      ])
      expect(code3).toBe(1)
      expect(errorsOut.join("\n")).toContain('invalid --search value "false"')
      expect(existsSync(join(cwd, ".pi/mcp.json"))).toBe(false)
    } finally {
      console.log = originalLog
      console.error = originalError
    }
  })

  test("applyPlan refuses to clobber a non-array at an append-array path", () => {
    const input = makeInput("opencode", "global", "forced", "optional")
    const config = join(input.home, ".config/opencode")
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, "opencode.jsonc"), JSON.stringify({ permissions: "ask" }, null, 2))
    expect(() => applyPlan(planForHost("opencode", input), input)).toThrow(/not an array/)
    // Nothing was written: the prepare pass failed before any file changed.
    expect(fsReadFileSync(join(config, "opencode.jsonc"), "utf8")).toContain('"ask"')
  })
})

describe("scope isolation", () => {
  test("a codex install refuses a second scope that claims the same config file", () => {
    const input = makeInput("codex", "global", "optional", "optional")
    applyPlan(planForHost("codex", input), input)
    const project = planForHost("codex", { ...input, scope: "project" })
    expect(project.errors.length).toBe(1)
    expect(project.errors[0]?.message).toContain("global scope")
    expect(project.errors[0]?.message).toContain("uninstall --host codex --scope global")
    expect(project.edits).toEqual([])
  })

  test("the refusal is symmetric when the project install came first", () => {
    const input = makeInput("codex", "project", "optional", "optional")
    applyPlan(planForHost("codex", input), input)
    const global = planForHost("codex", { ...input, scope: "global" })
    expect(global.errors.length).toBe(1)
    expect(global.errors[0]?.message).toContain("project scope")
  })

  test("pi and opencode scope pairs map to disjoint files and install side by side", () => {
    const piGlobal = makeInput("pi", "global", "optional", "optional")
    applyPlan(planForHost("pi", piGlobal), piGlobal)
    const piProject = planForHost("pi", { ...piGlobal, scope: "project" })
    expect(piProject.errors).toEqual([])
    applyPlan(piProject, { ...piGlobal, scope: "project" })
    expect(listRecords(piGlobal.home, piGlobal.cwd).length).toBe(2)
    uninstall({ ...piGlobal, scope: "project" })
    expect(readRecord(piGlobal)).toBeDefined()
    expect(existsSync(join(piGlobal.home, ".pi/agent/mcp.json"))).toBe(true)
  })

  test("uninstall refuses when a legacy record at the other scope claims the same file", () => {
    const input = makeInput("codex", "global", "optional", "optional")
    const file = join(input.home, ".codex/config.toml")
    const record = {
      version: 1 as const,
      host: "codex" as const,
      scope: "global" as const,
      createdAt: new Date().toISOString(),
      tiers: { search: "optional" as const, fetch: "optional" as const },
      files: [{ file, format: "toml" as const, created: false, ops: [] }],
    }
    writeRecord(input, record)
    writeRecord({ ...input, scope: "project" }, { ...record, scope: "project" as const })
    expect(() => uninstall(input)).toThrow(/also recorded at the project scope/)
  })
})

describe("revert ownership", () => {
  test("claimedByOtherScope returns only files the other scope's record also claims", () => {
    const input = makeInput("codex", "global", "optional", "optional")
    const fileA = join(input.home, ".codex/config.toml")
    const fileB = join(input.cwd, "AGENTS.md")
    writeRecord({ ...input, scope: "project" }, {
      version: 1,
      host: "codex",
      scope: "project",
      tiers: { search: "optional", fetch: "optional" },
      createdAt: new Date().toISOString(),
      files: [
        { file: fileA, format: "toml", created: false, ops: [] },
        { file: fileB, format: "rules", created: true, ops: [] },
      ],
    })
    const cases: readonly { readonly files: readonly string[]; readonly expected: string[] }[] = [
      { files: [fileB, join(input.cwd, "other.toml")], expected: [fileB] },
      { files: [fileA, fileB], expected: [fileA, fileB] },
      { files: [join(input.cwd, "unrelated.json")], expected: [] },
      { files: [], expected: [] },
    ]
    for (const { files, expected } of cases) {
      expect(claimedByOtherScope(input, files)).toEqual(expected)
    }
    // Without a record at the other scope nothing is ever claimed.
    const fresh = makeInput("codex", "global", "optional", "optional")
    expect(claimedByOtherScope(fresh, [fileA, fileB])).toEqual([])
  })

  test("a whole-file orphan revert deletes a created file it leaves empty", () => {
    const input = makeInput("pi", "project", "optional", "optional")
    const extra = join(input.cwd, ".pi/extra.json")
    mkdirSync(dirname(extra), { recursive: true })
    writeFileSync(extra, '{"a":1}\n')
    writeRecord(input, {
      version: 1,
      host: "pi",
      scope: "project",
      tiers: { search: "optional", fetch: "optional" },
      createdAt: new Date().toISOString(),
      files: [
        { file: extra, format: "json", created: true, ops: [{ op: "set", path: ["a"], applied: 1, previous: undefined }] },
      ],
    })
    // The new plan does not claim the extra file, so it reverts wholly; reverting
    // its only op empties it, and a created file left empty is deleted.
    const applied = applyPlan(planForHost("pi", input), input)
    expect(applied.ok).toBe(true)
    expect(existsSync(extra)).toBe(false)
    expect(existsSync(join(input.cwd, ".pi/mcp.json"))).toBe(true)
  })
})

function relativePath(from: string, to: string): string {
  return to.startsWith(from) ? to.slice(from.length + 1) : to
}
