import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { parseJsonc } from "../src/core/jsonc"
import { findHost, FORCED_FLAVORS, MECHANISMS, readHosts } from "../scripts/hosts"
import type { HostEntry } from "../scripts/hosts"
import { renderControlTable, renderHostTable } from "../scripts/render-matrix"

const repoRoot = join(import.meta.dir, "..")

describe("parseJsonc", () => {
  test("parses line and block comments", () => {
    expect(parseJsonc('{ // line\n "a": 1 /* block */, "b": 2\n}')).toEqual({ a: 1, b: 2 })
  })

  test("strips trailing commas in objects and arrays", () => {
    expect(parseJsonc('{"a": [1, 2,],}')).toEqual({ a: [1, 2] })
  })

  test("keeps comment-like and comma-like content inside strings", () => {
    expect(parseJsonc('{"url": "https://x.com/a,b", "note": "not // a comment"}')).toEqual({
      url: "https://x.com/a,b",
      note: "not // a comment",
    })
  })

  test("preserves escaped quotes inside strings", () => {
    expect(parseJsonc('{"a": "say \\"hi\\""}')).toEqual({ a: 'say "hi"' })
  })
})

describe("docs/hosts.jsonc", () => {
  const hosts = readHosts(repoRoot)

  test("baseline is a YYYY-MM-DD date", () => {
    expect(/^\d{4}-\d{2}-\d{2}$/.test(hosts.baseline)).toBe(true)
    expect(!Number.isNaN(Date.parse(hosts.baseline))).toBe(true)
  })

  test("host names are unique and versions are non-empty", () => {
    const names = hosts.hosts.map((host) => host.name)
    expect(new Set(names).size).toBe(names.length)
    for (const host of hosts.hosts) {
      expect(host.version.trim().length).toBeGreaterThan(0)
    }
  })

  test("rows stay sorted: open-source hosts first, then alphabetical", () => {
    const keys = hosts.hosts.map(
      (host): [number, string] => [host.license === null ? 1 : 0, host.display.toLowerCase()],
    )
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
    expect(keys).toEqual(sorted)
  })

  test("every host declares at least one known integration path", () => {
    for (const host of hosts.hosts) {
      expect(host.paths.length).toBeGreaterThan(0)
      for (const path of host.paths) {
        expect(MECHANISMS).toContain(path)
      }
    }
  })

  test("supported hosts have an adapter and guide that exist", () => {
    const supported = hosts.hosts.filter((host) => host.status === "supported") as HostEntry[]
    expect(supported.length).toBeGreaterThanOrEqual(2)
    for (const host of supported) {
      expect(existsSync(join(repoRoot, host.adapter as string))).toBe(true)
      expect(existsSync(join(repoRoot, host.guide as string))).toBe(true)
    }
  })

  test("the MCP server covers every host that lists mcp as a path", () => {
    const mcpHosts = hosts.hosts.filter((host) => host.paths.includes("mcp"))
    expect(mcpHosts.length).toBeGreaterThanOrEqual(7)
    expect(findHost(hosts, "pi").paths[0]).toBe("mcp")
  })

  test("every host declares control tiers for search and fetch", () => {
    for (const host of hosts.hosts) {
      for (const capability of ["search", "fetch"] as const) {
        const control = host.control[capability]
        expect(["yes", "n/a"]).toContain(control.optional)
        expect(["yes", "n/a"]).toContain(control.preferred)
        expect(FORCED_FLAVORS).toContain(control.forced)
        if (control.forced === "none") {
          expect(control.key).toBe("")
        } else {
          expect(control.key.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  test("replacement flavor implies the matching native extension point", () => {
    for (const host of hosts.hosts) {
      if (host.control.search.forced === "replacement") expect(host.nativeSearchProvider).toBe(true)
      if (host.control.fetch.forced === "replacement") expect(host.nativeFetchOverride).toBe(true)
    }
  })
})

describe("docs/integration.md stays in sync with docs/hosts.jsonc", () => {
  test("the generated host table matches the rendered table", () => {
    const doc = readFileSync(join(repoRoot, "docs", "integration.md"), "utf8")
    const begin = doc.indexOf("<!-- generated: host-matrix")
    const end = doc.indexOf("<!-- /generated: host-matrix -->")
    expect(begin).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(begin)
    const block = doc.slice(begin, end + "<!-- /generated: host-matrix -->".length)
    expect(block).toBe(
      `<!-- generated: host-matrix — edit docs/hosts.jsonc, then run \`bun run docs:matrix\` -->\n\n${renderHostTable(readHosts(repoRoot))}\n\n<!-- /generated: host-matrix -->`,
    )
  })
})

describe("docs/research/control-matrix.md stays in sync with docs/hosts.jsonc", () => {
  test("the generated control matrix matches the rendered table", () => {
    const doc = readFileSync(join(repoRoot, "docs", "research", "control-matrix.md"), "utf8")
    const begin = doc.indexOf("<!-- generated: control-matrix")
    const end = doc.indexOf("<!-- /generated: control-matrix -->")
    expect(begin).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(begin)
    const block = doc.slice(begin, end + "<!-- /generated: control-matrix -->".length)
    expect(block).toBe(
      `<!-- generated: control-matrix — edit docs/hosts.jsonc, then run \`bun run docs:matrix\` -->\n\n${renderControlTable(readHosts(repoRoot))}\n\n<!-- /generated: control-matrix -->`,
    )
  })
})

describe("installer prose stays anchored to docs/hosts.jsonc", () => {
  test("every version literal in src/installer appears in docs/hosts.jsonc", () => {
    // CONTRIBUTING: version mentions in prose are provenance anchors that move with
    // re-verification, not with the bump. A literal that vanished from hosts.jsonc
    // means a bump happened without the re-verification pass — fail here, not in a
    // user's plan note.
    const hostsText = readFileSync(join(repoRoot, "docs", "hosts.jsonc"), "utf8")
    const seen: string[] = []
    for (const entry of readdirSync(join(repoRoot, "src", "installer"), { recursive: true })) {
      const name = String(entry)
      if (!name.endsWith(".ts")) continue
      const text = readFileSync(join(repoRoot, "src", "installer", name), "utf8")
      for (const match of text.matchAll(/\b\d+\.\d+\.\d+\b/g)) {
        seen.push(`${name}: ${match[0]}`)
        expect(hostsText).toContain(match[0])
      }
    }
    expect(seen.length).toBeGreaterThan(0)
  })
})
