import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readHosts } from "./hosts"
import type { HostsFile, Mechanism } from "./hosts"

const BEGIN = "<!-- generated: host-matrix — edit docs/hosts.jsonc, then run `bun run docs:matrix` -->"
const END = "<!-- /generated: host-matrix -->"

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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const hosts = readHosts(repoRoot)

if (process.argv.includes("--check")) {
  if (updateIntegrationDoc(repoRoot, hosts)) {
    console.error("docs/integration.md is out of sync with docs/hosts.jsonc; run `bun run docs:matrix` and commit")
    process.exit(1)
  }
  console.log("docs/integration.md is in sync with docs/hosts.jsonc")
} else {
  const changed = updateIntegrationDoc(repoRoot, hosts)
  console.log(changed ? "docs/integration.md updated" : "docs/integration.md already in sync")
}
