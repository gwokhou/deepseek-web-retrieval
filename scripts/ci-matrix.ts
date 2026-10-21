import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findHost, readHosts } from "./hosts";

// Prints the @opencode/plugin CI matrix as a JSON array for
// `fromJson(needs.matrix.outputs.*)` in .github/workflows/ci.yml:
// the locked OpenCode version plus latest.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
console.log(JSON.stringify([findHost(readHosts(repoRoot), "opencode").version, "latest"]));
