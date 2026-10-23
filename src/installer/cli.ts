import { homedir } from "node:os";
import { resolve } from "node:path";
import { userConfigHome } from "../core/config-file";
import type { Env } from "../core/env";
import { TOOL_VERSION } from "../version";
import { ApplyError, applyPlan } from "./apply";
import { runConfigCommand } from "./config-command";
import { HOST_PLANNERS, HOST_VERSION_PROBES, planForHost } from "./hosts";
import { pinPackageRef } from "./ownership";
import { renderPlan } from "./render";
import { legacyGlobalStateDir, listRecords, readingLegacyGlobalRecords } from "./state";
import type { HostName, InstallerInput, Scope, Tier } from "./types";
import { uninstall } from "./uninstall";

const HOSTS = Object.keys(HOST_PLANNERS) as readonly HostName[];
const HOST_CHOICES = `<${HOSTS.join("|")}>`;
const SCOPES: readonly Scope[] = ["project", "global"];
const TIERS: readonly Tier[] = ["optional", "preferred", "forced", "off"];

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_RECOVERY = 3;

const USAGE = `Usage:
  deepseek-web-retrieval init --host ${HOST_CHOICES} --scope <project|global> \
--search <optional|preferred|forced|off> --fetch <optional|preferred|forced|off> \
[--path <extension|mcp>] [--package <npm ref>] [--pin] [--cwd <dir>] [--apply]
  deepseek-web-retrieval uninstall --host ${HOST_CHOICES} --scope <project|global> [--cwd <dir>]
  deepseek-web-retrieval list [--cwd <dir>]
  deepseek-web-retrieval config [--search <query>]
  deepseek-web-retrieval version

init prints the full plan (every file, old value → new value) and writes nothing
until --apply is passed. uninstall restores what the plan applied. --path picks
the integration mechanism for hosts with more than one (Pi: extension by
default, mcp for the stdio MCP server). --package overrides the package ref
written into host config; the Pi extension path turns it into the packages
source (a bare name is prefixed with npm:, a ref that already starts with npm:
is written as-is). --pin appends the running CLI's version to the package ref
(a ref already ending in a version keeps it), so hosts resolve that exact
release instead of the latest publish; re-run init --pin to move the pin.

config prints the effective configuration — every knob with its value and its
source (default, shared file, or environment), resolved the way the MCP server
resolves it — and exits 1 when the config file or the DEEPSEEK_* environment
has problems (unknown or rejected keys, unparseable JSON, set-but-unusable
variable values; a missing file is fine). config --search <query>
runs one billed search through that configuration to verify the key, config,
and network end to end; it exits 1 when the key is missing or the search fails.

Exit codes: 0 success; 1 refused or failed with nothing written (a failed apply
is fully rolled back); 2 invalid command line; 3 recovery required — a failed
apply could not roll back completely, follow the reported guidance before
re-running.`;

interface Flags {
  readonly values: Map<string, string>;
  readonly booleans: Set<string>;
  readonly problems: readonly string[];
}

const VALUE_FLAGS = new Set(["host", "scope", "search", "fetch", "path", "package", "cwd"]);
const BOOLEAN_FLAGS = new Set(["apply", "pin"]);
const PATH_CHOICES: readonly ["extension", "mcp"] = ["extension", "mcp"];

function parseFlags(args: readonly string[]): Flags {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const problems: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (!arg.startsWith("--")) {
      problems.push(`unexpected argument "${arg}" (flags only)`);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (BOOLEAN_FLAGS.has(name)) {
      if (eq !== -1) {
        problems.push(`--${name} does not accept a value; use --${name} to enable it or omit it`);
        continue;
      }
      if (booleans.has(name)) {
        problems.push(`--${name} was given more than once`);
        continue;
      }
      booleans.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      problems.push(`unknown flag --${name}`);
      continue;
    }
    if (values.has(name)) {
      problems.push(`--${name} was given more than once`);
      continue;
    }
    if (eq !== -1) {
      values.set(name, arg.slice(eq + 1));
      continue;
    }
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      problems.push(`--${name} requires a value`);
      continue;
    }
    values.set(name, next);
    i += 1;
  }
  return { values, booleans, problems };
}

/** Where the CLI writes; injectable so tests can assert command output. */
export interface CliIo {
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
  /** Platform the CLI resolves paths for; tests pin "win32" on any host. */
  readonly platform?: NodeJS.Platform;
}

/** CLI entry for the init/uninstall/list subcommands; returns the process exit code. */
export async function runInstallerCli(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line));
  const err = io.err ?? ((line: string) => console.error(line));
  const [command, ...rest] = argv;
  if (command === "version" || command === "--version") {
    out(TOOL_VERSION);
    return 0;
  }
  if (command === undefined) {
    err(USAGE);
    return EXIT_USAGE;
  }
  if (command === "help" || command === "--help") {
    out(USAGE);
    return 0;
  }
  const flags = parseFlags(rest);
  if (flags.problems.length > 0) {
    for (const problem of flags.problems) err(`error: ${problem}`);
    err(`\n${USAGE}`);
    return EXIT_USAGE;
  }
  const cwd = resolve(flags.values.get("cwd") ?? process.cwd());
  const home = process.env.HOME ?? homedir();
  const platform = io.platform ?? process.platform;
  const roots = { home, cwd, platform } as const;
  const configHome = resolveConfigHome(process.env, home, platform);

  if (command === "list") {
    let records: ReturnType<typeof listRecords>;
    try {
      records = listRecords({ ...roots, configHome });
    } catch (error) {
      err(error instanceof Error ? error.message : String(error));
      return 1;
    }
    if (records.length === 0) {
      out("No installs recorded.");
      return 0;
    }
    if (readingLegacyGlobalRecords({ ...roots, configHome })) {
      out(
        `Global install records are being read from the legacy ${legacyGlobalStateDir(roots)} ` +
          "(written before the Windows config home moved to %APPDATA%).",
      );
    }
    for (const record of records) {
      const by = record.installerVersion ? ` by v${record.installerVersion}` : "";
      out(
        `${record.host} (${record.scope}) — search=${record.tiers.search}, fetch=${record.tiers.fetch}, installed ${record.createdAt}${by}`,
      );
      for (const file of record.files) out(`  ${file.created ? "created" : "modified"} ${file.file}`);
    }
    return 0;
  }

  if (command === "config") {
    return runConfigCommand(flags.values.get("search"), { out, err });
  }

  if (command === "uninstall") {
    const required = requireInput(flags, cwd, home, configHome, platform, false);
    if (!required.ok) return usageError(required.problems, err);
    try {
      for (const line of uninstall(required.input)) out(line);
      return 0;
    } catch (error) {
      err(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (command !== "init") {
    err(`Unknown command "${command}".\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  const required = requireInput(flags, cwd, home, configHome, platform, true);
  if (!required.ok) return usageError(required.problems, err);
  const { input } = required;
  const probe = HOST_VERSION_PROBES[input.host];
  const hostVersion = probe?.(err);
  const plan = planForHost(input.host, hostVersion === undefined ? input : { ...input, hostVersion });
  if (plan.errors.length > 0) {
    for (const error of plan.errors) err(`error: ${error.message}`);
    err("Nothing was written.");
    return 1;
  }
  out(renderPlan(plan));
  if (!flags.booleans.has("apply")) {
    out("\nPlan only — re-run with --apply to write these changes.");
    return 0;
  }
  try {
    const result = applyPlan(plan, input);
    for (const line of result.lines) out(line);
    return 0;
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return exitCodeForError(error);
  }
}

/** Maps a thrown error to its exit code; recovery is the case a script must not retry blindly. */
export function exitCodeForError(error: unknown): number {
  return error instanceof ApplyError && error.status === "recovery_required" ? EXIT_RECOVERY : EXIT_FAILURE;
}

function usageError(problems: readonly string[], err: (line: string) => void): number {
  for (const problem of problems) err(`error: ${problem}`);
  err(`\n${USAGE}`);
  return EXIT_USAGE;
}

/**
 * The installer edge's one config-home resolution, built on the canonical
 * helper (userConfigHome): an inherited XDG_CONFIG_HOME is honored only when it
 * belongs to the real home — a rewritten HOME must not smuggle in someone
 * else's config root — and every other case takes the helper's platform
 * default (win32: %APPDATA% or `<home>\AppData\Roaming`; otherwise ~/.config).
 */
export function resolveConfigHome(env: Env, home: string, platform: NodeJS.Platform = process.platform): string {
  const xdgTrusted = env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME !== "" && home === (env.HOME ?? "");
  return userConfigHome({ env: xdgTrusted ? env : { ...env, XDG_CONFIG_HOME: undefined }, home, platform });
}

type RequireInputResult =
  | { readonly ok: true; readonly input: InstallerInput }
  | { readonly ok: false; readonly problems: readonly string[] };

function requireInput(
  flags: Flags,
  cwd: string,
  home: string,
  configHome: string,
  platform: NodeJS.Platform,
  needsTiers: boolean,
): RequireInputResult {
  const problems: string[] = [];
  const host = flags.values.get("host");
  const scope = flags.values.get("scope");
  const search = needsTiers ? (flags.values.get("search") ?? "") : "optional";
  const fetch = needsTiers ? (flags.values.get("fetch") ?? "") : "optional";
  const path = flags.values.get("path");
  if (host === undefined) problems.push(`--host is required (one of: ${HOSTS.join(", ")})`);
  else if (!HOSTS.includes(host as HostName))
    problems.push(`invalid --host value "${host}" (one of: ${HOSTS.join(", ")})`);
  if (scope === undefined) problems.push(`--scope is required (one of: ${SCOPES.join(", ")})`);
  else if (!SCOPES.includes(scope as Scope))
    problems.push(`invalid --scope value "${scope}" (one of: ${SCOPES.join(", ")})`);
  if (path !== undefined) {
    if (host !== "pi") {
      problems.push(`--path is only supported for host pi (${host ?? "no host"} has a single integration path)`);
    } else if (!(PATH_CHOICES as readonly string[]).includes(path)) {
      problems.push(`invalid --path value "${path}" (one of: ${PATH_CHOICES.join(", ")})`);
    }
  }
  if (needsTiers) {
    if (!TIERS.includes(search as Tier)) {
      problems.push(
        flags.values.has("search")
          ? `invalid --search value "${search}" (one of: ${TIERS.join(", ")})`
          : `--search is required (one of: ${TIERS.join(", ")})`,
      );
    }
    if (!TIERS.includes(fetch as Tier)) {
      problems.push(
        flags.values.has("fetch")
          ? `invalid --fetch value "${fetch}" (one of: ${TIERS.join(", ")})`
          : `--fetch is required (one of: ${TIERS.join(", ")})`,
      );
    }
  }
  if (home === "") problems.push("HOME is not set and the user home cannot be resolved; cannot proceed");
  if (problems.length > 0) return { ok: false, problems };
  const packageRef = flags.values.get("package") ?? "deepseek-web-retrieval";
  return {
    ok: true,
    input: {
      host: host as HostName,
      scope: scope as Scope,
      search: search as Tier,
      fetch: fetch as Tier,
      packageRef: flags.booleans.has("pin") ? pinPackageRef(packageRef, TOOL_VERSION) : packageRef,
      home,
      cwd,
      configHome,
      platform,
      ...(path !== undefined ? { path: path as "extension" | "mcp" } : {}),
    },
  };
}
