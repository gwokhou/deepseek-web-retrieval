import { homedir } from "node:os"
import { resolve } from "node:path"
import { HOST_PLANNERS, HOST_VERSION_PROBES, planForHost } from "./hosts"
import { applyPlan } from "./apply"
import { renderPlan } from "./render"
import { listRecords } from "./state"
import { uninstall } from "./uninstall"
import type { HostName, InstallerInput, Scope, Tier } from "./types"

const HOSTS = Object.keys(HOST_PLANNERS) as readonly HostName[]
const HOST_CHOICES = `<${HOSTS.join("|")}>`
const SCOPES: readonly Scope[] = ["project", "global"]
const TIERS: readonly Tier[] = ["optional", "preferred", "forced", "off"]

const USAGE = `Usage:
  deepseek-web-retrieval init --host ${HOST_CHOICES} --scope <project|global> \
--search <optional|preferred|forced|off> --fetch <optional|preferred|forced|off> \
[--path <extension|mcp>] [--package <npm ref>] [--cwd <dir>] [--apply]
  deepseek-web-retrieval uninstall --host ${HOST_CHOICES} --scope <project|global> [--cwd <dir>]
  deepseek-web-retrieval list [--cwd <dir>]

init prints the full plan (every file, old value → new value) and writes nothing
until --apply is passed. uninstall restores what the plan applied. --path picks
the integration mechanism for hosts with more than one (Pi: extension by
default, mcp for the stdio MCP server). --package overrides the package ref
written into host config; the Pi extension path turns it into the packages
source (a bare name is prefixed with npm:, a ref that already starts with npm:
is written as-is).`

interface Flags {
  readonly values: Map<string, string>
  readonly booleans: Set<string>
  readonly problems: readonly string[]
}

const VALUE_FLAGS = new Set(["host", "scope", "search", "fetch", "path", "package", "cwd"])
const BOOLEAN_FLAGS = new Set(["apply"])
const PATH_CHOICES: readonly ["extension", "mcp"] = ["extension", "mcp"]

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

/** Where the CLI writes; injectable so tests can assert command output. */
export interface CliIo {
  readonly out?: (line: string) => void
  readonly err?: (line: string) => void
}

/** CLI entry for the init/uninstall/list subcommands; returns the process exit code. */
export async function runInstallerCli(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line))
  const err = io.err ?? ((line: string) => console.error(line))
  const [command, ...rest] = argv
  if (command === undefined || command === "help" || command === "--help") {
    out(USAGE)
    return command === undefined ? 1 : 0
  }
  const flags = parseFlags(rest)
  if (flags.problems.length > 0) {
    for (const problem of flags.problems) err(`error: ${problem}`)
    err(`\n${USAGE}`)
    return 1
  }
  const cwd = resolve(flags.values.get("cwd") ?? process.cwd())
  const home = process.env.HOME ?? homedir()
  const configHome = resolveConfigHome(home)

  if (command === "list") {
    const records = listRecords({ home, cwd, configHome })
    if (records.length === 0) {
      out("No installs recorded.")
      return 0
    }
    for (const record of records) {
      out(`${record.host} (${record.scope}) — search=${record.tiers.search}, fetch=${record.tiers.fetch}, installed ${record.createdAt}`)
      for (const file of record.files) out(`  ${file.created ? "created" : "modified"} ${file.file}`)
    }
    return 0
  }

  if (command === "uninstall") {
    const required = requireInput(flags, cwd, home, configHome, false)
    if (!required.ok) return usageError(required.problems, err)
    try {
      for (const line of uninstall(required.input)) out(line)
      return 0
    } catch (error) {
      err(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  if (command !== "init") {
    err(`Unknown command "${command}".\n\n${USAGE}`)
    return 1
  }

  const required = requireInput(flags, cwd, home, configHome, true)
  if (!required.ok) return usageError(required.problems, err)
  const { input } = required
  const probe = HOST_VERSION_PROBES[input.host]
  const hostVersion = probe?.(err)
  const plan = planForHost(input.host, hostVersion === undefined ? input : { ...input, hostVersion })
  if (plan.errors.length > 0) {
    for (const error of plan.errors) err(`error: ${error.message}`)
    err("Nothing was written.")
    return 1
  }
  out(renderPlan(plan))
  if (!flags.booleans.has("apply")) {
    out("\nPlan only — re-run with --apply to write these changes.")
    return 0
  }
  try {
    const result = applyPlan(plan, input)
    for (const line of result.lines) out(line)
    return result.ok ? 0 : 1
  } catch (error) {
    err(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function usageError(problems: readonly string[], err: (line: string) => void): number {
  for (const problem of problems) err(`error: ${problem}`)
  err(`\n${USAGE}`)
  return 1
}

/**
 * XDG_CONFIG_HOME is honored only when it belongs to the real home; the one
 * environment read happens here, at the edge, and flows down as explicit input.
 */
function resolveConfigHome(home: string): string | undefined {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && home === (process.env.HOME ?? "")) return xdg
  return undefined
}

type RequireInputResult =
  | { readonly ok: true; readonly input: InstallerInput }
  | { readonly ok: false; readonly problems: readonly string[] }

function requireInput(
  flags: Flags,
  cwd: string,
  home: string,
  configHome: string | undefined,
  needsTiers: boolean,
): RequireInputResult {
  const problems: string[] = []
  const host = flags.values.get("host")
  const scope = flags.values.get("scope")
  const search = needsTiers ? (flags.values.get("search") ?? "") : "optional"
  const fetch = needsTiers ? (flags.values.get("fetch") ?? "") : "optional"
  const path = flags.values.get("path")
  if (host === undefined) problems.push(`--host is required (one of: ${HOSTS.join(", ")})`)
  else if (!HOSTS.includes(host as HostName)) problems.push(`invalid --host value "${host}" (one of: ${HOSTS.join(", ")})`)
  if (scope === undefined) problems.push(`--scope is required (one of: ${SCOPES.join(", ")})`)
  else if (!SCOPES.includes(scope as Scope)) problems.push(`invalid --scope value "${scope}" (one of: ${SCOPES.join(", ")})`)
  if (path !== undefined) {
    if (host !== "pi") {
      problems.push(`--path is only supported for host pi (${host ?? "no host"} has a single integration path)`)
    } else if (!(PATH_CHOICES as readonly string[]).includes(path)) {
      problems.push(`invalid --path value "${path}" (one of: ${PATH_CHOICES.join(", ")})`)
    }
  }
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
  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    input: {
      host: host as HostName,
      scope: scope as Scope,
      search: search as Tier,
      fetch: fetch as Tier,
      packageRef: flags.values.get("package") ?? "deepseek-web-retrieval",
      home,
      cwd,
      configHome,
      ...(path !== undefined ? { path: path as "extension" | "mcp" } : {}),
    },
  }
}
