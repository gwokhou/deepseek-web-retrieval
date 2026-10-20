import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { beforeAll, describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

const CLI = "dist/cli.js"

/** The smoke test must run, so build the entry when a fresh checkout has not. */
beforeAll(() => {
  if (existsSync(CLI)) return
  const build = spawnSync("bun", ["run", "build"], { stdio: "inherit" })
  if (build.status !== 0) throw new Error("`bun run build` failed; cannot run the stdio smoke test")
})

async function spawnCli(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [CLI],
    env: { PATH: process.env.PATH ?? "", ...env },
  })
  const client = new Client({ name: "deepseek-web-retrieval-test", version: "0.0.0" })
  await client.connect(transport)
  return client
}

describe("built CLI smoke test", () => {
  test("handshakes over real stdio and lists both tools", async () => {
    const client = await spawnCli({ DEEPSEEK_API_KEY: "sk-test" })
    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["deepseek_fetch", "deepseek_web_search"])

      // Local validation only: rejected before any network request.
      const result = await client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "not-a-url" },
      })
      expect(result.isError).toBe(true)
    } finally {
      await client.close()
    }
  })

  test("exits with an error when the API key is missing", async () => {
    const proc = Bun.spawn(["node", CLI], {
      env: { PATH: process.env.PATH ?? "", DEEPSEEK_API_KEY: "" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
    expect(exitCode).toBe(1)
    expect(stderr).toContain("DEEPSEEK_API_KEY")
  })

  test("lists only the search tool when DEEPSEEK_ENABLE_FETCH is false", async () => {
    const client = await spawnCli({ DEEPSEEK_API_KEY: "sk-test", DEEPSEEK_ENABLE_FETCH: "false" })
    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toEqual(["deepseek_web_search"])
    } finally {
      await client.close()
    }
  })

  test("exits with an error when both tools are disabled", async () => {
    const proc = Bun.spawn(["node", CLI], {
      env: {
        PATH: process.env.PATH ?? "",
        DEEPSEEK_API_KEY: "sk-test",
        DEEPSEEK_ENABLE_SEARCH: "false",
        DEEPSEEK_ENABLE_FETCH: "false",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
    expect(exitCode).toBe(1)
    expect(stderr).toContain("DEEPSEEK_ENABLE_SEARCH")
  })
})
