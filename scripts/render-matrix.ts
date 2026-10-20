import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readHosts } from "./hosts"
import type { ForcedFlavor, HostsFile, Mechanism } from "./hosts"

const BEGIN = "<!-- generated: host-matrix — edit docs/hosts.jsonc, then run `bun run docs:matrix` -->"
const END = "<!-- /generated: host-matrix -->"

const CONTROL_BEGIN = "<!-- generated: control-matrix — edit docs/hosts.jsonc, then run `bun run docs:matrix` -->"
const CONTROL_END = "<!-- /generated: control-matrix -->"

const MECHANISM_DISPLAY: Readonly<Record<Mechanism, string>> = {
  "native-provider": "native provider",
  "native-override": "native override",
  plugin: "plugin",
  extension: "extension",
  mcp: "MCP server",
  wrapper: "CLI/HTTP wrapper",
}

const STATUS_DISPLAY = {
  supported: "Supported",
  "no-adapter-yet": "No adapter yet",
} as const

const FORCED_DISPLAY: Readonly<Record<ForcedFlavor, string>> = {
  replacement: "Replacement",
  exclusion: "Exclusion",
  "de-facto": "De-facto",
  none: "—",
}

export function renderHostTable(hosts: HostsFile): string {
  const rows = hosts.hosts.map((host) => {
    const openSource = host.license === null ? "No" : `Yes (${host.license})`
    const bestPath = host.paths.map((path) => MECHANISM_DISPLAY[path]).join(" or ")
    return `| ${host.display} | ${host.version} | ${openSource} | ${host.nativeSearchProvider ? "Yes" : "No"} | ${host.nativeFetchOverride ? "Yes" : "No"} | ${bestPath} | ${STATUS_DISPLAY[host.status]} |`
  })
  return [
    "| Host | Version checked | Open source | Native search provider | Native fetch override | Best path | Status |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

export function renderControlTable(hosts: HostsFile): string {
  const rows = hosts.hosts.flatMap((host) =>
    (["search", "fetch"] as const).map((capability) => {
      const control = host.control[capability]
      const forced = control.forced === "none" ? "No" : "Yes"
      const mechanism = control.forced === "none" ? "—" : `${FORCED_DISPLAY[control.forced]} — ${control.key}`
      const optional = control.optional === "yes" ? "Yes" : "n/a"
      const preferred = control.preferred === "yes" ? "Yes" : "n/a"
      return `| ${host.display} | ${capability === "search" ? "Search" : "Fetch"} | ${optional} | ${preferred} | ${forced} | ${mechanism} |`
    }),
  )
  return [
    "| Host | Capability | Optional | Preferred | Forced | Mechanism |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

/** Replaces the generated block in docs/integration.md. Returns true when the file changed. */
export function updateIntegrationDoc(repoRoot: string, hosts: HostsFile): boolean {
  const docPath = join(repoRoot, "docs", "integration.md")
  const current = readFileSync(docPath, "utf8")
  const beginIndex = current.indexOf(BEGIN)
  const endIndex = current.indexOf(END)
  if (beginIndex === -1 || endIndex === -1) {
    throw new Error(`generated markers missing from ${docPath}`)
  }
  const updated =
    current.slice(0, beginIndex) + `${BEGIN}\n\n${renderHostTable(hosts)}\n\n${END}` + current.slice(endIndex + END.length)
  if (updated === current) return false
  writeFileSync(docPath, updated)
  return true
}

/** Replaces the generated control block in docs/control-matrix.md. Returns true when the file changed. */
export function updateControlDoc(repoRoot: string, hosts: HostsFile): boolean {
  const docPath = join(repoRoot, "docs", "control-matrix.md")
  const current = readFileSync(docPath, "utf8")
  const beginIndex = current.indexOf(CONTROL_BEGIN)
  const endIndex = current.indexOf(CONTROL_END)
  if (beginIndex === -1 || endIndex === -1) {
    throw new Error(`generated markers missing from ${docPath}`)
  }
  const updated =
    current.slice(0, beginIndex) +
    `${CONTROL_BEGIN}\n\n${renderControlTable(hosts)}\n\n${CONTROL_END}` +
    current.slice(endIndex + CONTROL_END.length)
  if (updated === current) return false
  writeFileSync(docPath, updated)
  return true
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const hosts = readHosts(repoRoot)

// CLI only: this module is imported by tests, so running on import would
// rewrite the generated docs and defeat the drift check.
if (import.meta.main) {
  const run = (): [boolean, boolean] => [
    updateIntegrationDoc(repoRoot, hosts),
    updateControlDoc(repoRoot, hosts),
  ]
  if (process.argv.includes("--check")) {
    const [integrationChanged, controlChanged] = run()
    if (integrationChanged || controlChanged) {
      const stale = [
        integrationChanged ? "docs/integration.md" : null,
        controlChanged ? "docs/control-matrix.md" : null,
      ]
        .filter(Boolean)
        .join(" and ")
      console.error(`${stale} ${controlChanged && !integrationChanged ? "is" : "are"} out of sync with docs/hosts.jsonc; run \`bun run docs:matrix\` and commit`)
      process.exit(1)
    }
    console.log("generated docs are in sync with docs/hosts.jsonc")
  } else {
    const [integrationChanged, controlChanged] = run()
    const messages = [
      integrationChanged ? "docs/integration.md updated" : "docs/integration.md already in sync",
      controlChanged ? "docs/control-matrix.md updated" : "docs/control-matrix.md already in sync",
    ]
    console.log(messages.join("; "))
  }
}
