import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findHost, readHosts } from "../../scripts/hosts";
import { ScenarioError } from "./assert";
import { runCapabilityOffScenario } from "./capability-off";
import { runCodexScenario } from "./codex";
import { runInstallerScenario } from "./installer";
import { runOpencodeScenario } from "./opencode";
import { runPiBilledScenario, runPiExtensionScenario, runPiScenario } from "./pi";
import { runPkgScenario } from "./pkg";
import { runPreferredScenario } from "./preferred";
import { runReinitScenario } from "./reinit";
import type { Runner } from "./runner";
import { createDockerRunner, ensureDockerImage } from "./runner";

const IMAGE = "deepseek-web-retrieval-e2e:latest";

interface Scenario {
  readonly name: string;
  readonly requiresApiKey: boolean;
  readonly run: (runner: Runner) => Promise<string[]>;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: "pi",
    requiresApiKey: false,
    run: (runner) => runPiScenario(runner),
  },
  {
    name: "pi-extension",
    requiresApiKey: false,
    run: (runner) => runPiExtensionScenario(runner),
  },
  {
    name: "pi-billed",
    requiresApiKey: true,
    run: (runner) => runPiBilledScenario(runner),
  },
  {
    name: "opencode",
    requiresApiKey: true,
    run: (runner) => runOpencodeScenario(runner),
  },
  {
    name: "codex",
    requiresApiKey: true,
    run: (runner) => runCodexScenario(runner),
  },
  {
    name: "installer",
    requiresApiKey: false,
    run: (runner) => runInstallerScenario(runner),
  },
  {
    name: "reinit",
    requiresApiKey: false,
    run: (runner) => runReinitScenario(runner),
  },
  {
    name: "pkg",
    requiresApiKey: false,
    run: (runner) => runPkgScenario(runner),
  },
  {
    name: "capability-off",
    requiresApiKey: false,
    run: (runner) => runCapabilityOffScenario(runner),
  },
  {
    name: "preferred",
    requiresApiKey: true,
    run: (runner) => runPreferredScenario(runner),
  },
];

const repoRoot = resolve(import.meta.dir, "..", "..");
const flagArgs = process.argv.slice(2).filter((arg) => arg.startsWith("--"));
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

async function main(): Promise<number> {
  if (flagArgs.length > 0) {
    console.error(
      `Unknown flag(s): ${flagArgs.join(", ")}. The e2e suites only run inside Docker; there is no --local mode.`,
    );
    return 1;
  }
  const names = SCENARIOS.map((scenario) => scenario.name);
  const unknown = requested.filter((name) => !names.includes(name));
  if (unknown.length > 0) {
    console.error(
      `Unknown scenario(s): ${unknown.join(", ")}. Available: ${names.join(", ")} (or no argument for all).`,
    );
    return 1;
  }

  const selected = SCENARIOS.filter((scenario) => requested.length === 0 || requested.includes(scenario.name));

  // Hard guard, not a skip: a missing key means the run is misconfigured.
  if (selected.some((scenario) => scenario.requiresApiKey) && !(process.env.DEEPSEEK_API_KEY ?? "").trim()) {
    const keyless = SCENARIOS.filter((scenario) => !scenario.requiresApiKey).map((scenario) => scenario.name);
    console.error(
      "DEEPSEEK_API_KEY is not set. The billed scenarios (pi-billed, opencode, codex, preferred) make real DeepSeek requests.\n" +
        `Export the key and re-run, or select only the keyless scenarios: bun run test:e2e ${keyless.join(" ")}`,
    );
    return 1;
  }

  const build = spawnSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
  if (build.status !== 0) {
    console.error(`\`bun run build\` failed:\n${build.stderr?.toString() ?? ""}`);
    return 1;
  }
  // Pack the tarball the installer and pkg scenarios consume; it is also what
  // `npx deepseek-web-retrieval` installs, so scenarios exercise real packaging.
  const pack = spawnSync("npm", ["pack"], { cwd: repoRoot, stdio: "pipe" });
  if (pack.status !== 0) {
    console.error(`\`npm pack\` failed:\n${pack.stderr?.toString() ?? ""}`);
    return 1;
  }

  const hosts = readHosts(repoRoot);
  try {
    ensureDockerImage(repoRoot, IMAGE, {
      OPENCODE_VERSION: findHost(hosts, "opencode").version,
      PI_VERSION: findHost(hosts, "pi").version,
      CODEX_VERSION: findHost(hosts, "codex").version,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.log("mode: docker (agent versions pinned by docs/hosts.jsonc)");

  let failures = 0;
  // Shared across scenarios (downloaded tarballs only); removed after the run.
  const sharedNpmCache = mkdtempSync(join(tmpdir(), "deepseek-e2e-npm-"));
  try {
    for (const scenario of selected) {
      console.log(`\n=== ${scenario.name} ===`);
      // A fresh isolated HOME and project dir per scenario, so one scenario's
      // leftovers (configs, npx install trees) cannot leak into the next one's
      // assertions — the installer's uninstall, for example, legitimately
      // restores whatever a previous scenario left registered. The npm cache
      // itself is shared per run; see createDockerRunner.
      const runner = createDockerRunner(repoRoot, IMAGE, sharedNpmCache);
      try {
        for (const line of await scenario.run(runner)) console.log(line);
        console.log(`${scenario.name}: PASS`);
      } catch (error) {
        failures++;
        const message = error instanceof ScenarioError || error instanceof Error ? error.message : String(error);
        console.error(`${scenario.name}: FAIL\n${message}`);
      } finally {
        runner.cleanup();
      }
    }
  } finally {
    rmSync(sharedNpmCache, { recursive: true, force: true });
  }

  console.error(`\n${failures === 0 ? "All scenarios passed" : `${failures} scenario(s) failed`}`);
  return failures === 0 ? 0 : 1;
}

process.exit(await main());
