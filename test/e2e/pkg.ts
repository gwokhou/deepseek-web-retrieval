import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

  for (const peer of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@opencode/plugin"]) {
    check(!existsSync(join(runner.homeDir.host, "pkg/node_modules", peer)), `standalone install pulled in ${peer}`);
  }
  log.push("pkg: normal npm installation omitted all optional host SDKs");

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

  // Use Pi's public loader and host SDK aliases, without any SDK installed next
  // to our tarball. Inspect registered tools, not just the absence of an error.
  const packageDir = join(runner.homeDir.guest, "pkg/node_modules/deepseek-web-retrieval");
  const piLoad = await runner.run(
    [
      "node",
      "--input-type=module",
      "-e",
      `import assert from "node:assert/strict";
       import { readFileSync, realpathSync } from "node:fs";
       import { dirname, join } from "node:path";
       import { pathToFileURL } from "node:url";
       const { discoverAndLoadExtensions } = await import(pathToFileURL(join(dirname(realpathSync("/opt/agents/bin/pi")), "index.js")));
       const root = process.argv[1];
       const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
       const result = await discoverAndLoadExtensions(manifest.pi.extensions.map(entry => join(root, entry)), process.cwd());
       assert.deepEqual(result.errors, []);
       assert.deepEqual(result.extensions.flatMap(extension => [...extension.tools.keys()]).sort(), ["deepseek_fetch", "deepseek_web_search"]);
       console.log("packed Pi extension registered both tools");`,
      packageDir,
    ],
    { cwd, env: { ...env, DEEPSEEK_API_KEY: "sk-e2e-placeholder" }, timeoutMs: 60_000 },
  );
  check(piLoad.exitCode === 0, "Pi could not load the installed extension with host SDKs", excerpt(piLoad.stderr));
  log.push("pkg: installed native Pi extension registered both tools through the host's public loader");

  const opencodeConfigDir = join(runner.homeDir.host, ".config/opencode");
  mkdirSync(opencodeConfigDir, { recursive: true });
  writeFileSync(
    join(opencodeConfigDir, "opencode.jsonc"),
    JSON.stringify({ plugins: [{ package: `file:${join(runner.repoDir, tarball)}` }] }),
  );
  const plugins = await runner.run(["node", join(runner.repoDir, "test/e2e/opencode-package.mjs")], {
    cwd,
    env,
    timeoutMs: 120_000,
  });
  check(
    plugins.exitCode === 0,
    "OpenCode could not activate the packed plugin",
    excerpt(`${plugins.stdout}\n${plugins.stderr}`, 8000),
  );
  log.push("pkg: installed OpenCode plugin is active in the real host without bundled host SDKs");
  return log;
}
