import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, excerpt } from "./assert";
import type { Runner } from "./runner";
import { findPackedTarball } from "./tarball";

interface PiServerEntry {
  readonly name?: unknown;
  readonly state?: unknown;
  readonly tools?: unknown;
}

interface PiListOutput {
  readonly servers?: readonly PiServerEntry[];
}

/**
 * Keyless run of the published-package path: `npm pack` output from this
 * checkout is installed with npm inside the container, its bin is executed
 * directly (shebang, dependency resolution), and the installed binary is then
 * registered as the Pi MCP server for a real handshake. This is the path users
 * hit via `npx deepseek-web-retrieval`; every other scenario runs the checkout's
 * dist/cli.js, which would stay green if the packaging broke.
 */
export async function runPkgScenario(runner: Runner): Promise<string[]> {
  const log: string[] = [];
  const tarball = findPackedTarball(runner.repoHostDir);
  const env = { HOME: runner.homeDir.guest };
  const cwd = runner.projectDir.guest;

  const install = await runner.run(
    [
      "npm",
      "install",
      "--no-fund",
      "--no-audit",
      "--prefix",
      join(runner.homeDir.guest, "pkg"),
      join(runner.repoDir, tarball),
    ],
    { cwd, env, timeoutMs: 180_000 },
  );
  check(
    install.exitCode === 0,
    "npm install of the packed tarball failed",
    excerpt(`${install.stdout}\n${install.stderr}`),
  );
  log.push(`pkg: installed ${tarball} with npm inside the container`);

  // npm --prefix installs dependency bins under node_modules/.bin, not bin/.
  const bin = join(runner.homeDir.guest, "pkg", "node_modules", ".bin", "deepseek-web-retrieval");
  const binRun = await runner.run([bin, "list"], { cwd, env });
  check(binRun.exitCode === 0, "installed bin failed to run", excerpt(`${binRun.stdout}\n${binRun.stderr}`));
  check(
    binRun.stdout.includes("No installs recorded"),
    "installed bin `list` output unexpected",
    excerpt(binRun.stdout),
  );
  log.push("pkg: installed bin executed directly (shebang + bundled deps)");

  const configDir = join(runner.homeDir.host, ".pi", "agent");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          deepseek: {
            command: bin,
            args: [],
            env: { DEEPSEEK_API_KEY: "sk-e2e-placeholder" },
            exposure: "direct",
            enabled: true,
          },
        },
      },
      null,
      2,
    ),
  );

  const list = await runner.run(["pi", "mcp", "list", "--json"], { cwd, env });
  check(list.exitCode === 0, "`pi mcp list` failed", excerpt(list.stderr || list.stdout));
  const server = (JSON.parse(list.stdout) as PiListOutput).servers?.find((entry) => entry.name === "deepseek");
  check(server !== undefined && server.state === "connected", "installed package did not connect as the pi server");
  const tools = Array.isArray(server?.tools) ? (server?.tools as unknown[]) : [];
  check(
    tools.includes("deepseek_web_search") && tools.includes("deepseek_fetch"),
    "installed package did not expose both tools",
    `tools: ${tools.join(", ")}`,
  );
  log.push("pkg: installed package connected through Pi's MCP client with both tools");
  return log;
}
