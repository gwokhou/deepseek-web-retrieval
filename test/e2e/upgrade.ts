import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseToml } from "smol-toml";
import { parseJsonc } from "../../src/core/jsonc";
import { check, excerpt } from "./assert";
import type { Runner } from "./runner";
import { findPackedTarball } from "./tarball";

/** Upgrade real 0.4.0 records with the packed candidate, then restore user config. */
export async function runUpgradeScenario(runner: Runner): Promise<string[]> {
  const log: string[] = [];
  const cwd = runner.projectDir.guest;
  const env = { HOME: runner.homeDir.guest, npm_config_registry: "https://registry.npmjs.org" };
  const prefix = join(runner.homeDir.guest, "upgrade");
  const cli = join(prefix, "node_modules/.bin/deepseek-web-retrieval");
  const manifest = join(runner.homeDir.host, "upgrade/node_modules/deepseek-web-retrieval/package.json");
  const tarball = findPackedTarball(runner.repoHostDir);
  const candidateRef = `file:${join(runner.repoDir, tarball)}`;
  const run = async (args: readonly string[]) => {
    const result = await runner.run(args, { cwd, env, timeoutMs: 180_000 });
    check(
      result.exitCode === 0,
      `upgrade command failed: ${args.join(" ")}`,
      excerpt(`${result.stdout}\n${result.stderr}`),
    );
    return result;
  };
  const install = async (ref: string, legacy = false) => {
    // The baseline CLI only needs MCP dependencies; avoid resolving old host
    // peers to today's releases, while the candidate uses normal npm semantics.
    await run([
      "npm",
      "install",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...(legacy ? ["--legacy-peer-deps"] : []),
      ref,
    ]);
  };
  await install("deepseek-web-retrieval@0.4.0", true);
  check(JSON.parse(readFileSync(manifest, "utf8")).version === "0.4.0", "baseline is not the published 0.4.0 package");

  const piDir = join(runner.homeDir.host, ".pi/agent");
  const codexDir = join(runner.homeDir.host, ".codex");
  mkdirSync(piDir, { recursive: true });
  mkdirSync(codexDir, { recursive: true });
  const piMcpPath = join(piDir, "mcp.json");
  const piSettingsPath = join(piDir, "settings.json");
  const codexPath = join(codexDir, "config.toml");
  const opencodePath = join(runner.projectDir.host, "opencode.jsonc");
  const rules = [join(piDir, "AGENTS.md"), join(codexDir, "AGENTS.md"), join(runner.projectDir.host, "AGENTS.md")];
  const originalRules = "# User rules\n\nKeep existing project conventions.\n";
  const piMcp = {
    mcpServers: { tavily: { command: "tavily-mcp", enabled: true }, local: { command: "local-tools", enabled: false } },
  };
  const piSettings = { theme: "dark", quietStartup: true };
  const codex = { model: "gpt-5.2", web_search: "live" };
  const opencode = {
    websearch: { provider: "original-provider" },
    permissions: [{ action: "read", resource: "*", effect: "allow" }],
  };
  writeFileSync(piMcpPath, JSON.stringify(piMcp, null, 2));
  writeFileSync(piSettingsPath, JSON.stringify(piSettings, null, 2));
  writeFileSync(codexPath, 'model = "gpt-5.2"\nweb_search = "live"\n');
  writeFileSync(opencodePath, JSON.stringify(opencode, null, 2));
  for (const file of rules) writeFileSync(file, originalRules);

  const installs = [
    { host: "pi", scope: "global" },
    { host: "codex", scope: "global" },
    { host: "opencode", scope: "project" },
  ];
  const init = async (host: string, scope: string, ref: string) =>
    run([
      cli,
      "init",
      "--host",
      host,
      "--scope",
      scope,
      "--search",
      "forced",
      "--fetch",
      "preferred",
      "--package",
      ref,
      "--apply",
    ]);
  for (const { host, scope } of installs) await init(host, scope, "deepseek-web-retrieval@0.4.0");
  const json = (path: string) => parseJsonc(readFileSync(path, "utf8")) as Record<string, unknown>;
  const piServers = () => (json(piMcpPath).mcpServers ?? {}) as Record<string, { enabled?: boolean }>;
  check("deepseek" in piServers(), "0.4.0 did not create the legacy Pi MCP registration");
  check(piServers().tavily?.enabled === false, "0.4.0 did not capture the competitor's enabled snapshot");
  check(
    parseToml(readFileSync(codexPath, "utf8")).web_search === "disabled",
    "0.4.0 did not capture the Codex search snapshot",
  );
  log.push("upgrade: published 0.4.0 installed all three hosts over existing user config");

  await install(candidateRef);
  const candidateVersion = JSON.parse(readFileSync(join(runner.repoHostDir, "package.json"), "utf8")).version;
  check(
    JSON.parse(readFileSync(manifest, "utf8")).version === candidateVersion,
    "npm upgrade did not install the candidate",
  );
  const listed = await run([cli, "list"]);
  for (const { host, scope } of installs)
    check(listed.stdout.includes(`${host} (${scope})`), `candidate could not read the legacy ${host} record`);
  for (const { host, scope } of installs) await init(host, scope, candidateRef);
  // Repeating a forced extension install must retain the original, enabled snapshot.
  await init("pi", "global", candidateRef);
  check(!("deepseek" in piServers()), "Pi upgrade retained the obsolete MCP registration");
  check(piServers().tavily?.enabled === false, "Pi extension migration re-enabled a forced competitor");
  const packages = json(piSettingsPath).packages;
  check(
    Array.isArray(packages) && packages.length === 1 && packages[0] === `npm:${candidateRef}`,
    "Pi upgrade did not register exactly one native extension source",
  );
  for (const file of rules)
    check(readFileSync(file, "utf8").includes("Keep existing project conventions."), "upgrade removed user rules");
  log.push(
    "upgrade: candidate read legacy records, migrated Pi MCP to the default extension, and retained original snapshots on repeated init",
  );

  for (const { host, scope } of installs) await run([cli, "uninstall", "--host", host, "--scope", scope]);
  const same = (actual: unknown, expected: unknown, message: string) =>
    check(isDeepStrictEqual(actual, expected), message, JSON.stringify(actual));
  same(json(piMcpPath), piMcp, "uninstall did not restore the original Pi competitors");
  same(json(piSettingsPath), piSettings, "uninstall did not restore original Pi settings");
  same(parseToml(readFileSync(codexPath, "utf8")), codex, "uninstall did not restore original Codex config");
  same(json(opencodePath), opencode, "uninstall did not restore original OpenCode config");
  for (const file of rules)
    check(
      existsSync(file) && readFileSync(file, "utf8").trim() === originalRules.trim(),
      "uninstall did not preserve original user rules",
    );
  check((await run([cli, "list"])).stdout.includes("No installs recorded"), "uninstall left install records behind");
  // A fresh install after uninstall also proves ownership claims were released.
  await init("codex", "global", candidateRef);
  await run([cli, "uninstall", "--host", "codex", "--scope", "global"]);
  same(
    parseToml(readFileSync(codexPath, "utf8")),
    codex,
    "fresh install after upgrade/uninstall did not restore the config",
  );
  log.push(
    "upgrade: uninstall restored all original config values and user rules; ownership was released for a fresh install",
  );
  return log;
}
