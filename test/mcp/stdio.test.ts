import { existsSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

const CLI = "dist/cli.js"

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
  test.skipIf(!existsSync(CLI))("handshakes over real stdio and lists both tools", async () => {
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

  test.skipIf(!existsSync(CLI))("exits with an error when the API key is missing", async () => {
    const proc = Bun.spawn(["node", CLI], {
      env: { PATH: process.env.PATH ?? "", DEEPSEEK_API_KEY: "" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
    expect(exitCode).toBe(1)
    expect(stderr).toContain("DEEPSEEK_API_KEY")
  })
})
