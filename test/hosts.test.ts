import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { parseJsonc } from "../scripts/jsonc"
import { findHost, MECHANISMS, readHosts } from "../scripts/hosts"
import type { HostEntry } from "../scripts/hosts"
import { renderHostTable } from "../scripts/render-matrix"

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
    expect(mcpHosts.length).toBeGreaterThanOrEqual(8)
    expect(findHost(hosts, "pi").paths[0]).toBe("mcp")
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
