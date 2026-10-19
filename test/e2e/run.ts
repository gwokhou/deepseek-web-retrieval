import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { findHost, readHosts } from "../../scripts/hosts"
import { ScenarioError } from "./assert"
import { runOpencodeScenario } from "./opencode"
import { runPiScenario } from "./pi"
import { createDockerRunner, createLocalRunner, ensureDockerImage } from "./runner"
import type { Runner } from "./runner"

const IMAGE = "deepseek-web-retrieval-e2e:latest"

interface Scenario {
  readonly name: string
  readonly requiresApiKey: boolean
  readonly run: (runner: Runner) => Promise<string[]>
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: "pi",
    requiresApiKey: false,
    run: (runner) => runPiScenario(runner),
  },
  {
    name: "opencode",
    requiresApiKey: true,
    run: (runner) => runOpencodeScenario(runner),
  },
]

const repoRoot = resolve(import.meta.dir, "..", "..")
const args = process.argv.slice(2)
const useLocal = args.includes("--local")
const requested = args.find((arg) => !arg.startsWith("--"))

async function main(): Promise<number> {
  if (requested !== undefined && !SCENARIOS.some((scenario) => scenario.name === requested)) {
    const names = SCENARIOS.map((scenario) => scenario.name).join(", ")
    console.error(`Unknown scenario "${requested}". Available: ${names} (or no argument for all).`)
    return 1
  }

  const selected = SCENARIOS.filter((scenario) => requested === undefined || scenario.name === requested)

  // Hard guard, not a skip: a missing key means the run is misconfigured.
  if (selected.some((scenario) => scenario.requiresApiKey) && !(process.env.DEEPSEEK_API_KEY ?? "").trim()) {
    console.error(
      "DEEPSEEK_API_KEY is not set. The opencode scenario makes real billed DeepSeek requests.\n" +
        "Export the key and re-run, or run only the keyless scenario: bun run test:e2e pi",
    )
    return 1
  }

  const build = spawnSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "pipe" })
  if (build.status !== 0) {
    console.error("`bun run build` failed:\n" + (build.stderr?.toString() ?? ""))
    return 1
  }

  const runner = useLocal ? createLocalRunner(repoRoot) : createDockerRunner(repoRoot, IMAGE)
  if (!useLocal) {
    const hosts = readHosts(repoRoot)
    try {
      ensureDockerImage(repoRoot, IMAGE, {
        OPENCODE_VERSION: findHost(hosts, "opencode").version,
        PI_VERSION: findHost(hosts, "pi").version,
      })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 1
    }
  }
  console.log(
    `mode: ${runner.mode} (agent versions pinned by ${useLocal ? "the host" : "docs/hosts.jsonc"})`,
  )

  let failures = 0
  for (const scenario of selected) {
    console.log(`\n=== ${scenario.name} ===`)
    try {
      for (const line of await scenario.run(runner)) console.log(line)
      console.log(`${scenario.name}: PASS`)
    } catch (error) {
      failures++
      const message = error instanceof ScenarioError || error instanceof Error ? error.message : String(error)
      console.error(`${scenario.name}: FAIL\n${message}`)
    }
  }

  console.error(`\n${failures === 0 ? "All scenarios passed" : `${failures} scenario(s) failed`}`)
  return failures === 0 ? 0 : 1
}

process.exit(await main())
