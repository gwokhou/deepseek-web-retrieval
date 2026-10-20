import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ScenarioError, requireWhich } from "./assert"

export interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface RunOptions {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly timeoutMs?: number
}

/** A directory that exists on the host and is visible to the agents. */
export interface Dir {
  /** Host-side path, for writing files. */
  readonly host: string
  /** Path the agents see (a mount point inside the container). */
  readonly guest: string
}

export interface Runner {
  /** Repo checkout path on the host, for existence checks. */
  readonly repoHostDir: string
  /** Repo checkout as seen by the agents (read-only mount). */
  readonly repoDir: string
  /** Isolated HOME for the agents. */
  readonly homeDir: Dir
  /** Scratch project directory for host configs. */
  readonly projectDir: Dir
  run(cmd: readonly string[], options: RunOptions): Promise<ExecResult>
}

const DOCKER_HINT = "install Docker; the e2e suites only run inside containers"

function requireDocker(): string {
  return requireWhich("docker", DOCKER_HINT)
}

export function createDockerRunner(repoRoot: string, image: string): Runner {
  const docker = requireDocker()
  const homeDir = dir(mkdtempSync(join(tmpdir(), "deepseek-e2e-home-")), "/home/verifier")
  const projectDir = dir(mkdtempSync(join(tmpdir(), "deepseek-e2e-project-")), "/project")
  const uid = process.getuid?.() ?? 1000
  const gid = process.getgid?.() ?? 1000

  const dockerArgs = [
    "run",
    "--rm",
    `--user=${uid}:${gid}`,
    "-v",
    `${repoRoot}:/work:ro`,
    "-v",
    `${homeDir.host}:${homeDir.guest}`,
    "-v",
    `${projectDir.host}:${projectDir.guest}`,
  ]

  return {
    repoHostDir: repoRoot,
    repoDir: "/work",
    homeDir,
    projectDir,
    run: (cmd, options) => {
      const env = options.env ?? {}
      const envFlags = Object.entries(env).flatMap(([key, value]) =>
        value === undefined ? [] : ["-e", `${key}=${value}`],
      )
      return exec(
        [docker, ...dockerArgs, ...envFlags, "-w", options.cwd, image, ...cmd],
        { cwd: repoRoot, env: process.env, timeoutMs: options.timeoutMs },
      )
    },
  }
}

/** Builds the pinned-agent image; layer cache makes repeat builds cheap. */
export function ensureDockerImage(
  repoRoot: string,
  image: string,
  versions: Readonly<Record<string, string>>,
): void {
  const docker = requireDocker()
  const buildArgs = Object.entries(versions).flatMap(([key, value]) => ["--build-arg", `${key}=${value}`])
  const build = spawnSync(
    docker,
    ["build", "-t", image, ...buildArgs, "-f", join(repoRoot, "test", "e2e", "Dockerfile"), repoRoot],
    { stdio: "inherit" },
  )
  if (build.status !== 0) {
    throw new ScenarioError("docker build failed; see output above")
  }
}

function dir(host: string, guest: string = host): Dir {
  return { host, guest }
}

async function exec(
  cmd: readonly string[],
  options: { cwd: string; env?: Readonly<Record<string, string | undefined>>; timeoutMs?: number },
): Promise<ExecResult> {
  const proc = Bun.spawn([...cmd], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer =
    options.timeoutMs !== undefined ? setTimeout(() => proc.kill(), options.timeoutMs) : undefined
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode: exitCode ?? -1 }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
