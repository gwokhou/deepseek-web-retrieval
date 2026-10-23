# Integration model

[DeepSeek Web Retrieval](../README.md) is not tied to one host. Whether a coding agent can
use it depends on that agent's extension points.

**Research baseline:** the `baseline` field of [hosts.jsonc](hosts.jsonc). This matrix covers
CLI/terminal agents only; IDE and editor extension surfaces are out of scope. Versions are
the latest stable CLI release checked at that baseline unless noted otherwise. `No` means no
documented native provider or override was found in the checked version; several hosts still
ship built-in web tools. MCP tools can add equivalent tools, but do not replace built-ins.

## Mechanisms

| Mechanism | Search | Fetch | Requires | Current implementation |
| --- | --- | --- | --- | --- |
| Native websearch provider | Yes | No | Host plugin API | OpenCode v2 adapter |
| Native tool / fetch override | No | Yes | Host tool API | OpenCode v2 adapter |
| Custom tool plugin | Yes | Yes | Host plugin API | Cline CLI/SDK; no adapter yet |
| Extension API | Yes | Yes | Host extension API | Pi adapter (`src/pi/`) |
| MCP server | Yes | Yes | Host MCP client | Shipped (`src/mcp/`; Pi and Codex guides) |
| CLI/HTTP wrapper | Yes | Yes | Host can call external tools | Not shipped |

MCP is a protocol, not an agent. It is one possible transport for hosts that support MCP
tools. `Custom tool plugin` means adding tools; it does not replace a host's built-in tools.

## Host support

Rows are sorted with open-source hosts first, then by host name alphabetically.

<!-- generated: host-matrix — edit docs/hosts.jsonc, then run `bun run docs:matrix` -->

| Host | Version checked | Open source | Native search provider | Native fetch override | Best path | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Cline | 0.0.13 | Yes (Apache-2.0) | No | No | MCP server or custom tool plugin | No adapter yet |
| Codex | 0.163.0 | Yes (Apache-2.0) | No | No | MCP server | Supported |
| OpenCode | 2.0.32 | Yes (MIT) | Yes | Yes | native websearch provider or native tool/fetch override | Supported |
| Pi | 1.3.0 | Yes (MIT) | No | No | extension API or MCP server | Supported |
| Claude Code | 2.1.303 | No | No | No | MCP server | No adapter yet |
| Cursor | 2026.10.08 | No | No | No | MCP server | No adapter yet |
| Devin | 3000.11.92 | No | No | No | MCP server | No adapter yet |
| GitHub Copilot | 1.0.98 | No | No | No | MCP server | No adapter yet |

<!-- /generated: host-matrix -->

`Open source` refers to the CLI/client code at the checked version, verified from the
project repositories on 2026-10-19. It does not cover the hosted model service. Cline and
Codex are Apache-2.0; OpenCode and Pi are MIT. Claude Code and
Cursor are proprietary. GitHub Copilot CLI and Devin CLI publish installers and docs, not
source code, under proprietary terms.

OpenCode, Pi, and Codex have supported setup guides and installer host modules. The
MCP server in `src/mcp/` provides a possible stdio path for the remaining hosts, but
protocol compatibility alone does not establish a tested host setup. For those rows,
`No adapter yet` means no supported host-specific adapter or setup guide is shipped.
All version locks live in [hosts.jsonc](hosts.jsonc), the single
source of truth for this table; OpenCode is pinned to the adapter's tested target, not
necessarily the latest OpenCode release. Control tiers per host and capability — optional,
preferred, or forced routing — are researched in [control-matrix.md](research/control-matrix.md),
whose per-host reference also carries MCP registration and rules files.

## Host notes

One line per host. The [per-host reference](research/control-matrix.md#per-host-reference) carries
the details: built-in web tools and their kill switches, MCP registration, and rules files.

- **OpenCode v2** — Uses OpenCode's native plugin API and
  exposes both a websearch provider and a fetch tool/override. See
  [OpenCode v2](agents/opencode-v2.md).
- **Claude Code** — Ships built-in `WebSearch` and `WebFetch` tools. See
  [Claude Code](research/control-matrix.md#claude-code).
- **Codex** — Ships a built-in `web_search` tool. Supported through the MCP server; see
  [Codex](agents/codex.md) and [Codex in the per-host reference](research/control-matrix.md#codex).
- **Cursor** — Uses the same `mcp.json` servers as the editor; ships built-in web search
  and `WebFetch` tools. See [Cursor](research/control-matrix.md#cursor).
- **GitHub Copilot** — Ships a built-in `web_fetch` tool, and web search via the bundled
  GitHub MCP server. See [GitHub Copilot](research/control-matrix.md#github-copilot).
- **Cline** — Ships a built-in `fetch_web_content` tool. See
  [Cline](research/control-matrix.md#cline).
- **Devin** — Ships built-in `web_search` and `webfetch` tools. See
  [Devin](research/control-matrix.md#devin).
- **Pi** — No built-in web tools; a TypeScript extension API plus MCP. Supported through
  the native extension adapter (the recommended path), with the MCP server as the fallback;
  see [Pi](agents/pi.md) and [Pi in the per-host reference](research/control-matrix.md#pi).

## Upgrading existing installs

For an installation managed by `init`:

1. Run `npx deepseek-web-retrieval@latest list` from the original project directory,
   using the same home and `XDG_CONFIG_HOME` as the original installation.
2. Run `npx deepseek-web-retrieval@latest init` with the original `--host`, `--scope`,
   `--search`, and `--fetch` values, changing only the settings you intend to change.
   Review the plan and repeat with `--apply`; re-init preserves the original snapshots
   needed for uninstall. A global install can still claim shared configuration from a
   particular project, so keep the original working directory for upgrades.
3. Refresh the package in the host and start or reload a session as described in its
   guide. For Pi's extension path, use `pi update --extensions`. To pin the host's
   package to the exact version being run, pass `--pin` to init (it writes
   `deepseek-web-retrieval@X.Y.Z` into the registration); upgrading a pinned install
   means re-running init with the newer CLI, since updating the CLI alone does not
   move an independently pinned host package. `--package` still overrides the ref
   entirely.

When upgrading from 0.4.0, Pi's default changes from MCP to the native extension.
Pass `--path mcp` explicitly to retain MCP, or `--path extension` to migrate; the plan
shows the old path's removals and retains the original uninstall snapshots. OpenCode's
native plugin and Codex's MCP path remain the same. Standalone MCP installs no longer
require OpenCode or Pi SDKs; native adapters use the SDKs provided by their hosts.

Keep install records and ownership sidecars: deleting them loses recovery information
and can cause a later init to refuse an existing registration. If an operation was
interrupted, follow the [recovery guidance](design/installer-design.md#persistence-and-concurrent-operations)
before retrying. For manual installations, update the package reference or checkout and
follow the host guide rather than adopting the config through init.

Code importing the core's removed `formatFetchContent` helper must migrate to
`formatFetchedContent`, which returns both `content` and `truncated`.

## Available paths and future hosts

- **MCP server** — shipped in `src/mcp/` (the fallback path in the [Pi](agents/pi.md) guide
  and the path in the [Codex](agents/codex.md) guide); the broadest route for hosts that
  support MCP tools. Protocol compatibility across these hosts is researched in
  [mcp-compatibility.md](research/mcp-compatibility.md).
- **Native extension adapters** — the Pi extension adapter ships in `src/pi/`; a host whose
  extension point can register tools directly gets a native path alongside MCP.
- **Host-specific guides** — added as requests and testing land; the server itself is
  host-agnostic.

## Sources

- OpenCode: [plugin API](https://opencode.ai/v2/docs/build/plugins)
- Claude Code: [MCP](https://code.claude.com/docs/en/mcp),
  [tools reference](https://code.claude.com/docs/en/tools-reference)
- Codex: [MCP](https://learn.chatgpt.com/docs/extend/mcp),
  [CLI](https://learn.chatgpt.com/docs/codex/cli),
  [config reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- Cursor: [MCP](https://cursor.com/docs/mcp),
  [CLI changelog](https://cursor.com/docs/cli/changelog)
- Copilot CLI: [repository](https://github.com/github/copilot-cli),
  [MCP docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- Cline: [MCP](https://docs.cline.bot/mcp/mcp-overview),
  [tools reference](https://docs.cline.bot/tools-reference/all-cline-tools)
- Devin CLI: [extensibility](https://docs.devin.ai/cli/extensibility/index),
  [MCP](https://docs.devin.ai/cli/extensibility/mcp/overview)
- Pi: [extensions](https://pi.dev/docs/latest/extensions),
  [MCP](https://pi.dev/docs/latest/mcp)

Version sources:

- npm: [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code),
  [Codex](https://www.npmjs.com/package/@openai/codex),
  [Cline CLI](https://www.npmjs.com/package/@cline/cli),
  [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
- Releases: [Copilot CLI](https://github.com/github/copilot-cli/releases)
- Changelogs: [Cursor CLI](https://cursor.com/docs/cli/changelog),
  [Devin CLI](https://docs.devin.ai/cli/changelog),
  [Pi](https://pi.dev/changelog)
- OpenCode: the adapter's tested target, locked in [hosts.jsonc](hosts.jsonc)

## Evaluating a host

Check the host's documentation for these questions:

1. Can a plugin register a custom websearch provider?
2. Can a plugin add a custom tool, or replace the built-in fetch tool?
3. Does the host support MCP servers?
4. Can the host call an external CLI or HTTP tool?
5. Which rules or instruction files does the host read, and can they steer tool preference?
6. Which built-in web tools does it ship, and can each be disabled or denied?

Record the answers in the per-host reference in
[research/control-matrix.md](research/control-matrix.md#per-host-reference). Add a link from
the README Usage section only after the adapter ships. To request evaluation for another
host, [open an issue](https://github.com/gwokhou/deepseek-web-retrieval/issues) with links
to its plugin, tool, or MCP documentation.

## Why the distinction matters

Some agents expose a native websearch provider, some only let you add tools, and some only
support MCP. A "yes" for one mechanism does not mean the others are supported. The adapter
code and docs need to match the mechanism the host actually provides.

## Adding an adapter

- Register the host and its version lock in [hosts.jsonc](hosts.jsonc), then regenerate
  the host table with `bun run docs:matrix`.
- Put shared retrieval logic in `src/core/`.
- Put host-specific glue in `src/<agent>/`, or in `src/mcp/` for the cross-host MCP server.
- Document setup and usage in `docs/agents/<agent>.md`.
- Link the guide from the README Usage section.
