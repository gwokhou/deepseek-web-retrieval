#!/usr/bin/env node
// Any argument means a human ran the CLI; MCP clients spawn this bin with no
// arguments for the stdio server. The installer is imported statically and the
// MCP server dynamically, so init/uninstall never load — or depend on — the
// server's dependency graph, including when recovering from a bad server setup.
if (process.argv.length > 2) {
  const { runInstallerCli } = await import("../installer/cli");
  process.exit(await runInstallerCli(process.argv.slice(2)));
}

const { serveMcp } = await import("./serve");
serveMcp();

export {};
