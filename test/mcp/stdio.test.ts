import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT = resolve(import.meta.dir, "../..");
const CLI = resolve(ROOT, "dist/cli.js");

/** Fail explicitly when the execution environment cannot carry Node child-process stdio. */
async function assertNodeStdio(): Promise<void> {
  const proc = Bun.spawn(
    ["node", "-e", "process.stdin.once('data', () => { console.log('stdio-out'); console.error('stdio-err'); });"],
    { env: { PATH: process.env.PATH ?? "" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const timeout = setTimeout(() => proc.kill(), 3000);
  try {
    proc.stdin.write("stdio-in\n");
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0 || stdout !== "stdio-out\n" || stderr !== "stdio-err\n") {
      throw new Error(
        "Node child-process stdio probe failed before MCP startup: " +
          JSON.stringify({ exitCode, signal: proc.signalCode, stdout, stderr }) +
          ". Check the execution environment's pipe support (including sandbox restrictions) before running MCP tests.",
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Always test this checkout's build, even when an older dist/cli.js already exists. */
beforeAll(async () => {
  await assertNodeStdio();
  const build = spawnSync("bun", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
  if (build.status !== 0) {
    throw new Error(`CLI build failed (exit=${build.status}, signal=${build.signal}): ${build.stderr || build.stdout}`);
  }
}, 10000);

async function spawnCli(
  env: Record<string, string>,
  clientInfo: { name: string; version: string } = { name: "deepseek-web-retrieval-test", version: "0.0.0" },
): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [CLI],
    env: { PATH: process.env.PATH ?? "", ...env },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  const client = new Client(clientInfo);
  try {
    await client.connect(transport, { timeout: 3000 });
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw new Error(`CLI stdio handshake failed: ${String(error)}\nServer stderr: ${stderr || "(empty)"}`, {
      cause: error,
    });
  }
}

describe("built CLI smoke test", () => {
  test("handshakes over real stdio and lists both tools", async () => {
    const client = await spawnCli({ DEEPSEEK_API_KEY: "sk-test" });
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["deepseek_fetch", "deepseek_web_search"]);

      // Local validation only: rejected before any network request.
      const result = await client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "not-a-url" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  test("handshakes and serves tools when the client identifies as Codex", async () => {
    const client = await spawnCli({ DEEPSEEK_API_KEY: "sk-test" }, { name: "codex-mcp-client", version: "0.163.0" });
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["deepseek_fetch", "deepseek_web_search"]);

      // The shaping itself is asserted in server.test.ts and modern.test.ts; over real
      // stdio this guards the initialize handshake against the Codex identity.
      const result = await client.callTool({
        name: "deepseek_fetch",
        arguments: { url: "not-a-url" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  test("exits with an error when the API key is missing", async () => {
    const proc = Bun.spawn(["node", CLI], {
      env: { PATH: process.env.PATH ?? "", DEEPSEEK_API_KEY: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect({ exitCode, signal: proc.signalCode, stdout, stderr }).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: expect.stringContaining("DEEPSEEK_API_KEY"),
    });
  });

  test("lists only the search tool when DEEPSEEK_ENABLE_FETCH is false", async () => {
    const client = await spawnCli({ DEEPSEEK_API_KEY: "sk-test", DEEPSEEK_ENABLE_FETCH: "false" });
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(["deepseek_web_search"]);
    } finally {
      await client.close();
    }
  });

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
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect({ exitCode, signal: proc.signalCode, stdout, stderr }).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: expect.stringContaining("DEEPSEEK_ENABLE_SEARCH"),
    });
  });
});
