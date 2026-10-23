import { readFileSync } from "node:fs";

/**
 * The published package version, read once at startup. Resolves to the repo
 * root when run from source and to the package root when run from the bundled
 * dist/ output; npm always ships package.json alongside it.
 */
export const TOOL_VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
