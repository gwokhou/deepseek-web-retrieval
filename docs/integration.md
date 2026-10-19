# Integration model

[DeepSeek Web Retrieval](../README.md) is not tied to one host. Whether a coding agent can
use it depends on that agent's extension points.

**Research baseline:** 2026-10-19. This matrix covers CLI/terminal agents only; IDE and
editor extension surfaces are out of scope. Versions are the latest stable CLI release
checked on that date unless noted otherwise. `No` means no documented native provider or
override was found in the checked version; several hosts still ship built-in web tools.
MCP tools can add equivalent tools, but do not replace built-ins.

## Mechanisms

| Mechanism | Search | Fetch | Requires | Current implementation |
| --- | --- | --- | --- | --- |
| Native websearch provider | Yes | No | Host plugin API | OpenCode v2 adapter |
| Native tool / fetch override | No | Yes | Host tool API | OpenCode v2 adapter |
| Custom tool plugin | Yes | Yes | Host plugin API | Cline CLI/SDK and Pi; no adapter yet |
| MCP server | Yes | Yes | Host MCP client | Not shipped |
| CLI/HTTP wrapper | Yes | Yes | Host can call external tools | Not shipped |

MCP is a protocol, not an agent. It is one possible transport for hosts that support MCP
tools. `Custom tool plugin` means adding tools; it does not replace a host's built-in tools.

## Host support

Rows are sorted with open-source hosts first, then by host name alphabetically.

| Host | Version checked | Open source | Native search provider | Native fetch override | Best path | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Cline | 0.0.13 | Yes (Apache-2.0) | No | No | MCP or plugin | No adapter yet |
| Codex | 0.163.0 | Yes (Apache-2.0) | No | No | MCP server | No adapter yet |
| Continue | 1.5.47 | Yes (Apache-2.0) | No | No | MCP server | No adapter yet |
| Gemini | 0.64.0 | Yes (Apache-2.0) | No | No | MCP server | No adapter yet |
| OpenCode | 2.0.32 | Yes (MIT) | Yes | Yes | Native plugin API | Supported |
| Pi | 1.3.0 | Yes (MIT) | No | No | MCP or extension | No adapter yet |
| Claude Code | 2.1.303 | No | No | No | MCP server | No adapter yet |
| Cursor | 2026.10.08 | No | No | No | MCP server | No adapter yet |
| Devin | 3000.11.92 | No | No | No | MCP server | No adapter yet |
| GitHub Copilot | 1.0.98 | No | No | No | MCP server | No adapter yet |

`Open source` refers to the CLI/client code at the checked version, verified from the
project repositories on 2026-10-19. It does not cover the hosted model service. Cline,
Codex, Continue, and Gemini CLI are Apache-2.0; OpenCode and Pi are MIT. Claude Code and
Cursor are proprietary. GitHub Copilot CLI and Devin CLI publish installers and docs, not
source code, under proprietary terms.

`No adapter yet` means a documented integration path exists, but this project has not
shipped an adapter for that host. OpenCode is pinned to the adapter's tested target
(2.0.32), not necessarily the latest OpenCode release.

## Host notes

- **OpenCode v2** — The only shipped adapter. It uses OpenCode's native plugin API and
  exposes both a websearch provider and a fetch tool/override. See
  [OpenCode v2](opencode-v2.md).
- **Claude Code** — Ships built-in `WebSearch` and `WebFetch` tools. No documented native
  provider or override; MCP servers can add tools, and hooks can block calls but do not
  replace the fetch implementation.
- **Codex** — MCP servers can add tools. No documented native websearch provider or fetch
  override.
- **Gemini** — Gemini CLI ships built-in `google_web_search` and `web_fetch` tools. No
  documented native provider or override; MCP servers and extensions can add tools.
- **Cursor** — Cursor CLI uses the same `mcp.json` servers as the editor. No documented
  native provider or fetch override.
- **GitHub Copilot** — Copilot CLI supports MCP servers; plugins can bundle MCP servers.
  No documented native provider or fetch override.
- **Cline** — Cline CLI supports MCP. CLI/SDK plugins can add custom tools, but the built-in
  `fetch_web_content` tool is not replaced.
- **Continue** — Continue CLI supports MCP servers. A built-in `search_web` tool exists, but
  it is not a custom provider, and there is no documented fetch override.
- **Devin** — Devin CLI supports MCP servers. Plugins bundle skills, rules, hooks, and MCP
  servers, not arbitrary custom tools. Windsurf Desktop/Cascade is a separate IDE surface
  and is not included in this row.
- **Pi** — Pi 1.3.0 has native MCP support and a TypeScript extension API that can add
  custom tools. The core ships read/bash/edit/write tools; web search/fetch are added by
  extensions or MCP. No native websearch provider or fetch override.

## Sources

- OpenCode: [plugin API](https://opencode.ai/v2/docs/build/plugins)
- Claude Code: [MCP](https://code.claude.com/docs/en/mcp),
  [tools reference](https://code.claude.com/docs/en/tools-reference)
- Codex: [MCP](https://developers.openai.com/codex/mcp),
  [CLI](https://developers.openai.com/codex/cli)
- Gemini CLI: [tools reference](https://geminicli.com/docs/reference/tools/),
  [MCP](https://geminicli.com/docs/tools/mcp-server/)
- Cursor: [MCP](https://cursor.com/docs/mcp),
  [CLI changelog](https://cursor.com/docs/cli/changelog)
- Copilot CLI: [repository](https://github.com/github/copilot-cli),
  [MCP docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- Cline: [MCP](https://docs.cline.bot/mcp/mcp-overview),
  [tools reference](https://docs.cline.bot/tools-reference/all-cline-tools)
- Continue: [MCP](https://docs.continue.dev/customize/deep-dives/mcp),
  [agent tools](https://docs.continue.dev/ide-extensions/agent/how-it-works)
- Devin CLI: [extensibility](https://docs.devin.ai/cli/extensibility/index),
  [MCP](https://docs.devin.ai/cli/extensibility/mcp/overview)
- Pi: [extensions](https://pi.dev/docs/latest/extensions),
  [MCP](https://pi.dev/docs/latest/mcp)

Version sources:

- npm: [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code),
  [Codex](https://www.npmjs.com/package/@openai/codex),
  [Gemini CLI](https://www.npmjs.com/package/@google/gemini-cli),
  [Cline CLI](https://www.npmjs.com/package/@cline/cli),
  [Continue CLI](https://www.npmjs.com/package/@continuedev/cli),
  [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
- Releases: [Copilot CLI](https://github.com/github/copilot-cli/releases)
- Changelogs: [Cursor CLI](https://cursor.com/docs/cli/changelog),
  [Devin CLI](https://docs.devin.ai/cli/changelog),
  [Pi](https://pi.dev/changelog)
- OpenCode: `2.0.32` adapter target in this repository

## Evaluating a host

Check the host's documentation for these questions:

1. Can a plugin register a custom websearch provider?
2. Can a plugin add a custom tool, or replace the built-in fetch tool?
3. Does the host support MCP servers?
4. Can the host call an external CLI or HTTP tool?

Record the answers in `docs/<agent>.md`. Add a link from the README Usage section only after
the adapter ships. To request evaluation for another host,
[open an issue](https://github.com/gwokhou/deepseek-web-retrieval/issues) with links to its
plugin, tool, or MCP documentation.

## Why the distinction matters

Some agents expose a native websearch provider, some only let you add tools, and some only
support MCP. A "yes" for one mechanism does not mean the others are supported. The adapter
code and docs need to match the mechanism the host actually provides.

## Adding an adapter

- Put shared retrieval logic in `src/core/`.
- Put host-specific glue in `src/<agent>/`.
- Document setup and usage in `docs/<agent>.md`.
- Link the guide from the README Usage section.
