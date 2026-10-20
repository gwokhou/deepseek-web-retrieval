import { homedir } from "node:os"
import { resolve } from "node:path"
import { planForHost } from "./hosts"
import { applyPlan } from "./apply"
import { renderPlan } from "./render"
import { listRecords } from "./state"
import { uninstall } from "./uninstall"
import type { HostName, InstallerInput, Scope, Tier } from "./types"

const HOSTS: readonly HostName[] = ["opencode", "pi", "codex"]
const SCOPES: readonly Scope[] = ["project", "global"]
const TIERS: readonly Tier[] = ["optional", "preferred", "forced", "off"]

const USAGE = `Usage:
  deepseek-web-retrieval init --host <opencode|pi|codex> --scope <project|global> \
--search <optional|preferred|forced|off> --fetch <optional|preferred|forced|off> \
[--package <npm ref>] [--cwd <dir>] [--apply]
  deepseek-web-retrieval uninstall --host <opencode|pi|codex> --scope <project|global> [--cwd <dir>]
  deepseek-web-retrieval list [--cwd <dir>]

init prints the full plan (every file, old value → new value) and writes nothing
until --apply is passed. uninstall restores what the plan applied.`

interface Flags {
  readonly values: Map<string, string>
  readonly booleans: Set<string>
  readonly problems: readonly string[]
}

const VALUE_FLAGS = new Set(["host", "scope", "search", "fetch", "package", "cwd"])
const BOOLEAN_FLAGS = new Set(["apply"])

function parseFlags(args: readonly string[]): Flags {
  const values = new Map<string, string>()
  const booleans = new Set<string>()
  const problems: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string
    if (!arg.startsWith("--")) {
      problems.push(`unexpected argument "${arg}" (flags only)`)
      continue
    }
    const eq = arg.indexOf("=")
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (BOOLEAN_FLAGS.has(name)) {
      booleans.add(name)
      continue
    }
    if (!VALUE_FLAGS.has(name)) {
      problems.push(`unknown flag --${name}`)
      continue
    }
    if (eq !== -1) {
      values.set(name, arg.slice(eq + 1))
      continue
    }
    const next = args[i + 1]
    if (next === undefined || next.startsWith("--")) {
      problems.push(`--${name} requires a value`)
      continue
    }
    values.set(name, next)
    i += 1
  }
  return { values, booleans, problems }
}

/** CLI entry for the init/uninstall/list subcommands; returns the process exit code. */
export async function runInstallerCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv
  if (command === undefined || command === "help" || command === "--help") {
    console.log(USAGE)
    return command === undefined ? 1 : 0
  }
  const flags = parseFlags(rest)
  if (flags.problems.length > 0) {
    for (const problem of flags.problems) console.error(`error: ${problem}`)
    console.error(`\n${USAGE}`)
    return 1
  }
  const cwd = resolve(flags.values.get("cwd") ?? process.cwd())
  const home = process.env.HOME ?? homedir()

  if (command === "list") {
    const records = listRecords(home, cwd)
    if (records.length === 0) {
      console.log("No installs recorded.")
      return 0
    }
    for (const record of records) {
      console.log(`${record.host} (${record.scope}) — search=${record.tiers.search}, fetch=${record.tiers.fetch}, installed ${record.createdAt}`)
      for (const file of record.files) console.log(`  ${file.created ? "created" : "modified"} ${file.file}`)
    }
    return 0
  }

  if (command === "uninstall") {
    const input = requireInput(flags, cwd, home, false)
    if (typeof input === "number") return input
    try {
      for (const line of uninstall(input)) console.log(line)
      return 0
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  if (command !== "init") {
    console.error(`Unknown command "${command}".\n\n${USAGE}`)
    return 1
  }

  const input = requireInput(flags, cwd, home, true)
  if (typeof input === "number") return input
  const plan = planForHost(input.host, input)
  if (plan.errors.length > 0) {
    for (const error of plan.errors) console.error(`error: ${error.message}`)
    console.error("Nothing was written.")
    return 1
  }
  console.log(renderPlan(plan))
  if (!flags.booleans.has("apply")) {
    console.log("\nPlan only — re-run with --apply to write these changes.")
    return 0
  }
  try {
    const result = applyPlan(plan, input)
    for (const line of result.lines) console.log(line)
    return result.ok ? 0 : 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function requireInput(flags: Flags, cwd: string, home: string, needsTiers: boolean): InstallerInput | number {
  const problems: string[] = []
  const host = flags.values.get("host")
  const scope = flags.values.get("scope")
  const search = needsTiers ? (flags.values.get("search") ?? "") : "optional"
  const fetch = needsTiers ? (flags.values.get("fetch") ?? "") : "optional"
  if (host === undefined) problems.push(`--host is required (one of: ${HOSTS.join(", ")})`)
  else if (!HOSTS.includes(host as HostName)) problems.push(`invalid --host value "${host}" (one of: ${HOSTS.join(", ")})`)
  if (scope === undefined) problems.push(`--scope is required (one of: ${SCOPES.join(", ")})`)
  else if (!SCOPES.includes(scope as Scope)) problems.push(`invalid --scope value "${scope}" (one of: ${SCOPES.join(", ")})`)
  if (needsTiers) {
    if (!TIERS.includes(search as Tier)) {
      problems.push(
        flags.values.has("search")
          ? `invalid --search value "${search}" (one of: ${TIERS.join(", ")})`
          : `--search is required (one of: ${TIERS.join(", ")})`,
      )
    }
    if (!TIERS.includes(fetch as Tier)) {
      problems.push(
        flags.values.has("fetch")
          ? `invalid --fetch value "${fetch}" (one of: ${TIERS.join(", ")})`
          : `--fetch is required (one of: ${TIERS.join(", ")})`,
      )
    }
  }
  if (home === "") problems.push("HOME is not set and the user home cannot be resolved; cannot proceed")
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`)
    console.error(`\n${USAGE}`)
    return 1
  }
  return {
    host: host as HostName,
    scope: scope as Scope,
    search: search as Tier,
    fetch: fetch as Tier,
    packageRef: flags.values.get("package") ?? "deepseek-web-retrieval",
    home,
    cwd,
  }
}
