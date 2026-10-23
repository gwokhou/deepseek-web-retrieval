import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_KEYS, configSummaryValues } from "../src/core/config-summary";
import { OPTION_ENV_BY_KEY } from "../src/core/env";
import { resolvePluginOptions } from "../src/core/options";
import type { ForcedFlavor, HostsFile, Mechanism } from "./hosts";
import { readHosts } from "./hosts";

const BEGIN = "<!-- generated: host-matrix — edit docs/hosts.jsonc, then run `bun run docs:matrix` -->";
const END = "<!-- /generated: host-matrix -->";

const CONTROL_BEGIN = "<!-- generated: control-matrix — edit docs/hosts.jsonc, then run `bun run docs:matrix` -->";
const CONTROL_END = "<!-- /generated: control-matrix -->";

const KNOB_BEGIN =
  "<!-- generated: knob-table — edit src/core/config-summary.ts or env.ts, then run `bun run docs:matrix` -->";
const KNOB_END = "<!-- /generated: knob-table -->";

const MECHANISM_DISPLAY: Readonly<Record<Mechanism, string>> = {
  "native-provider": "native websearch provider",
  "native-override": "native tool/fetch override",
  plugin: "custom tool plugin",
  extension: "extension API",
  mcp: "MCP server",
  wrapper: "CLI/HTTP wrapper",
};

const STATUS_DISPLAY = {
  supported: "Supported",
  "no-adapter-yet": "No adapter yet",
} as const;

const FORCED_DISPLAY: Readonly<Record<ForcedFlavor, string>> = {
  replacement: "Replacement",
  exclusion: "Exclusion",
  "de-facto": "De-facto",
  none: "—",
};

export function renderHostTable(hosts: HostsFile): string {
  const rows = hosts.hosts.map((host) => {
    const openSource = host.license === null ? "No" : `Yes (${host.license})`;
    const bestPath = host.paths.map((path) => MECHANISM_DISPLAY[path]).join(" or ");
    return `| ${host.display} | ${host.version} | ${openSource} | ${host.nativeSearchProvider ? "Yes" : "No"} | ${host.nativeFetchOverride ? "Yes" : "No"} | ${bestPath} | ${STATUS_DISPLAY[host.status]} |`;
  });
  return [
    "| Host | Version checked | Open source | Native search provider | Native fetch override | Best path | Status |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

export function renderControlTable(hosts: HostsFile): string {
  const rows = hosts.hosts.flatMap((host) =>
    (["search", "fetch"] as const).map((capability) => {
      const control = host.control[capability];
      const forced = control.forced === "none" ? "No" : "Yes";
      const mechanism = control.forced === "none" ? "—" : `${FORCED_DISPLAY[control.forced]} — ${control.key}`;
      const optional = control.optional === "yes" ? "Yes" : "n/a";
      const preferred = control.preferred === "yes" ? "Yes" : "n/a";
      return `| ${host.display} | ${capability === "search" ? "Search" : "Fetch"} | ${optional} | ${preferred} | ${forced} | ${mechanism} |`;
    }),
  );
  return [
    "| Host | Capability | Optional | Preferred | Forced | Mechanism |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/**
 * The configuration guide's knob table: one row per config-vocabulary key, in
 * vocabulary order, with the matching DEEPSEEK_* variable and the built-in
 * default. Rendered from the same source the adapters resolve through
 * (CONFIG_KEYS, OPTION_ENV_BY_KEY, resolvePluginOptions), so the documented
 * mapping can never drift from the code.
 */
export function renderKnobTable(): string {
  const defaults = configSummaryValues(resolvePluginOptions({}));
  const rows = CONFIG_KEYS.map((key) => {
    const env = OPTION_ENV_BY_KEY[key];
    if (env === undefined) throw new Error(`config key "${key}" has no DEEPSEEK_* variable in OPTION_ENV_BY_KEY`);
    // maxResults' default is the coupling, not a constant: it follows count
    // whenever left unset (see resolveSearchOptions).
    const value =
      key === "maxResults"
        ? `follows \`count\` (${defaults.count})`
        : formatDefault(defaults[key as keyof typeof defaults]);
    return `| \`${key}\` | \`${env}\` | ${value} |`;
  });
  return ["| File / OpenCode key | Environment | Default |", "| --- | --- | --- |", ...rows].join("\n");
}

function formatDefault(value: unknown): string {
  if (value === undefined) return "unset";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "unset";
  return String(value);
}

/** Splices generated content between markers; shared by every generated block. */
function replaceGeneratedBlock(current: string, begin: string, end: string, content: string, docPath: string): string {
  const beginIndex = current.indexOf(begin);
  const endIndex = current.indexOf(end);
  if (beginIndex === -1 || endIndex === -1) {
    throw new Error(`generated markers missing from ${docPath}`);
  }
  return `${current.slice(0, beginIndex)}${begin}\n\n${content}\n\n${end}${current.slice(endIndex + end.length)}`;
}

/** Replaces the generated block in docs/integration.md. Returns true on drift; check mode never writes. */
export function updateIntegrationDoc(repoRoot: string, hosts: HostsFile, check = false): boolean {
  const docPath = join(repoRoot, "docs", "integration.md");
  const current = readFileSync(docPath, "utf8");
  const updated = replaceGeneratedBlock(current, BEGIN, END, renderHostTable(hosts), docPath);
  if (updated === current) return false;
  if (!check) writeFileSync(docPath, updated);
  return true;
}

/** Replaces the generated control block in docs/research/control-matrix.md. Returns true on drift; check mode never writes. */
export function updateControlDoc(repoRoot: string, hosts: HostsFile, check = false): boolean {
  const docPath = join(repoRoot, "docs", "research", "control-matrix.md");
  const current = readFileSync(docPath, "utf8");
  const updated = replaceGeneratedBlock(current, CONTROL_BEGIN, CONTROL_END, renderControlTable(hosts), docPath);
  if (updated === current) return false;
  if (!check) writeFileSync(docPath, updated);
  return true;
}

/** Replaces the generated knob block in docs/configuration.md. Returns true on drift; check mode never writes. */
export function updateConfigDoc(repoRoot: string, check = false): boolean {
  const docPath = join(repoRoot, "docs", "configuration.md");
  const current = readFileSync(docPath, "utf8");
  const updated = replaceGeneratedBlock(current, KNOB_BEGIN, KNOB_END, renderKnobTable(), docPath);
  if (updated === current) return false;
  if (!check) writeFileSync(docPath, updated);
  return true;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hosts = readHosts(repoRoot);

// CLI only: this module is imported by tests, so running on import would
// rewrite the generated docs and defeat the drift check.
if (import.meta.main) {
  const run = (check = false): Record<string, boolean> => ({
    "docs/integration.md": updateIntegrationDoc(repoRoot, hosts, check),
    "docs/research/control-matrix.md": updateControlDoc(repoRoot, hosts, check),
    "docs/configuration.md": updateConfigDoc(repoRoot, check),
  });
  const changed = (result: Record<string, boolean>): string[] =>
    Object.entries(result)
      .filter(([, isChanged]) => isChanged)
      .map(([file]) => file);
  if (process.argv.includes("--check")) {
    const stale = changed(run(true));
    if (stale.length > 0) {
      console.error(
        `${stale.join(" and ")} ${stale.length === 1 ? "is" : "are"} out of sync with the generated source ` +
          "(docs/hosts.jsonc, or the src/core config vocabulary); run `bun run docs:matrix` and commit",
      );
      process.exit(1);
    }
    console.log("generated docs are in sync with their sources");
  } else {
    const stale = changed(run());
    console.log(stale.length > 0 ? `${stale.join(" and ")} updated` : "generated docs already in sync");
  }
}
