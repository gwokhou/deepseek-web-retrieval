import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const registry = "https://registry.npmjs.org";

export function releaseNotes(version: string, tag: string, changelog: string): string {
  if (!stableVersion.test(version) || tag !== `v${version}`) {
    throw new Error("Release tag must be vX.Y.Z and match package.json version exactly");
  }
  const sections = changelog.replace(/\r\n/g, "\n").split(/^## /m).slice(1);
  const matching = sections.filter((section) => section.split("\n")[0]?.trim() === version);
  if (matching.length !== 1) throw new Error(`Expected exactly one CHANGELOG.md section for ${version}`);
  const notes = matching[0]?.split("\n").slice(1).join("\n").trim() ?? "";
  if (!notes) throw new Error(`CHANGELOG.md section for ${version} is empty`);
  return `${notes}\n`;
}

type Packed = { name: string; version: string; filename: string; integrity: string };
type Published = { name?: string; version?: string; dist?: { integrity?: string } };
type RegistryMetadata = { "dist-tags"?: { latest?: string }; versions?: Record<string, Published> };

export function publicationState(packed: Packed, metadata: RegistryMetadata) {
  const published = metadata.versions?.[packed.version];
  const latest = metadata["dist-tags"]?.latest;
  if (published) {
    if (
      published.name !== packed.name ||
      published.version !== packed.version ||
      published.dist?.integrity !== packed.integrity
    ) {
      throw new Error(`${packed.name}@${packed.version} already exists with different package contents`);
    }
    return { exists: true, latest: latest === packed.version };
  }
  if (latest) {
    if (!stableVersion.test(latest)) throw new Error(`Unexpected npm latest version: ${latest}`);
    const candidateParts = packed.version.split(".").map(BigInt);
    const latestParts = latest.split(".").map(BigInt);
    const firstDifference = candidateParts.findIndex((part, index) => part !== latestParts[index]);
    if (firstDifference < 0 || candidateParts[firstDifference] < latestParts[firstDifference]) {
      throw new Error(`Refusing to move npm latest backwards from ${latest} to ${packed.version}`);
    }
  }
  return { exists: false, latest: false };
}

export async function registryState(
  packed: Packed,
  fetcher: (url: string, options: RequestInit) => Promise<Response> = fetch,
) {
  const response = await fetcher(`${registry}/${encodeURIComponent(packed.name)}`, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return publicationState(packed, {});
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  const metadata = (await response.json()) as RegistryMetadata;
  if (!metadata.versions || !metadata["dist-tags"]) throw new Error("Invalid npm registry metadata");
  return publicationState(packed, metadata);
}

export async function waitForPublication(
  readState: () => Promise<ReturnType<typeof publicationState>>,
  pause: () => Promise<void> = () => Bun.sleep(10_000),
) {
  // npm may accept an upload before its processing pipeline exposes the version.
  for (let attempt = 0; attempt < 31; attempt++) {
    const state = await readState();
    if (state.exists) return state;
    if (attempt < 30) await pause();
  }
  throw new Error(
    "Published version is still missing after five minutes; wait for npm processing, then rerun failed jobs",
  );
}

function output(values: Record<string, string | boolean>) {
  const lines = Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  process.stdout.write(lines);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
}

async function main() {
  const [command, directory] = process.argv.slice(2);
  if (!directory) throw new Error("Usage: bun scripts/release.ts prepare|status|verify <artifact-directory>");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (command === "prepare") {
    const tag = process.env.RELEASE_TAG || `v${pkg.version}`;
    const notes = releaseNotes(pkg.version, tag, readFileSync("CHANGELOG.md", "utf8"));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "notes.md"), notes);
    output({ version: pkg.version, tag, tarball: `${pkg.name}-${pkg.version}.tgz` });
    return;
  }
  if (command !== "status" && command !== "verify") throw new Error(`Unknown command: ${command}`);
  const packages: Packed[] = JSON.parse(readFileSync(join(directory, "pack.json"), "utf8"));
  const packed = packages[0];
  if (
    packages.length !== 1 ||
    !packed ||
    packed.name !== pkg.name ||
    packed.version !== pkg.version ||
    !stableVersion.test(packed.version) ||
    basename(packed.filename) !== packed.filename
  ) {
    throw new Error("Packed artifact does not match package.json");
  }
  const integrity = `sha512-${createHash("sha512")
    .update(readFileSync(join(directory, packed.filename)))
    .digest("base64")}`;
  if (integrity !== packed.integrity) throw new Error("Packed artifact integrity mismatch");
  output(command === "status" ? await registryState(packed) : await waitForPublication(() => registryState(packed)));
}

if (import.meta.main) await main();
