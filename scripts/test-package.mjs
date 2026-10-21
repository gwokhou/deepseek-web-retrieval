import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "dwr-package-"));
const home = join(scratch, "home");
const project = join(scratch, "project");
const env = { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config") };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 180000, ...options });
  assert.equal(
    result.status,
    0,
    `${command} failed (${result.error ?? result.signal}):\n${result.stderr}\n${result.stdout}`,
  );
  return result.stdout;
}

try {
  mkdirSync(home);
  mkdirSync(project);
  let tarball = process.argv[2] ? resolve(process.argv[2]) : undefined;
  if (!tarball) {
    const packed = JSON.parse(
      run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], { cwd: root }),
    );
    tarball = join(scratch, packed[0].filename);
  }
  // A standalone MCP install must not pull in unrelated host SDKs.
  run(
    "npm",
    ["install", "--prefix", join(scratch, "installed"), "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: scratch },
  );
  for (const peer of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@opencode/plugin"]) {
    assert.equal(existsSync(join(scratch, "installed/node_modules", peer)), false, `MCP install pulled in ${peer}`);
  }
  const bin = join(scratch, "installed/node_modules/.bin/deepseek-web-retrieval");
  const cli = (...args) => run(process.execPath, [bin, ...args], { cwd: project, env });
  assert.match(cli("list"), /No installs recorded/);
  const flags = ["--host", "pi", "--scope", "project", "--search", "optional"];
  cli("init", ...flags, "--fetch", "preferred", "--apply");
  assert.match(cli("list"), /pi \(project\)/);
  cli("init", ...flags, "--fetch", "optional", "--apply");
  const settings = JSON.parse(readFileSync(join(project, ".pi/settings.json"), "utf8"));
  assert.deepEqual(settings.packages, ["npm:deepseek-web-retrieval"]);
  cli("uninstall", "--host", "pi", "--scope", "project");
  assert.match(cli("list"), /No installs recorded/);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin],
    env: { ...env, DEEPSEEK_API_KEY: "sk-package-placeholder" },
    cwd: project,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });
  const client = new Client({ name: "package-smoke", version: "1" });
  try {
    await client.connect(transport, { timeout: 5000 });
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["deepseek_fetch", "deepseek_web_search"]);
    const invalid = await client.callTool({ name: "deepseek_fetch", arguments: { url: "not-a-url" } });
    assert.equal(invalid.isError, true);
  } catch (error) {
    throw new Error(`Installed package MCP failed: ${error}\n${stderr}`, { cause: error });
  } finally {
    await client.close();
  }
  console.log(`Package lifecycle and MCP stdio passed on Node ${process.version}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
