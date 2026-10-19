# Integration model

[DeepSeek Web Retrieval](../README.md) is not tied to one host. Whether a coding agent can
use it depends on that agent's extension points.

**Research baseline:** 2026-10-19. Versions are the latest stable CLI/agent release checked
on that date unless noted otherwise. For vendors with multiple surfaces, the CLI/terminal
agent was evaluated where available; Roo Code and Zed are extension/editor agents. `No`
means no documented native provider or override was found in the checked version; several
hosts still ship built-in web tools. MCP tools can add equivalent tools, but do not replace
built-ins.

## Mechanisms

| Mechanism | Search | Fetch | Requires | Current implementation |
| --- | --- | --- | --- | --- |
| Native websearch provider | Yes | No | Host plugin API | OpenCode v2 adapter |
| Native tool / fetch override | No | Yes | Host tool API | OpenCode v2 adapter |
| Custom tool plugin | Yes | Yes | Host plugin API | Cline CLI/SDK; no adapter yet |
| MCP server | Yes | Yes | Host MCP client | Not shipped |
| CLI/HTTP wrapper | Yes | Yes | Host can call external tools | Not shipped |

MCP is a protocol, not an agent. It is one possible transport for hosts that support MCP
tools. `Custom tool plugin` means adding tools; it does not replace a host's built-in tools.

## Host support

| Host | Version checked | Native search provider | Native fetch override | MCP | Best path | Status |
| --- | --- | --- | --- | --- | --- | --- |
| OpenCode v2 | 2.0.32 | Yes | Yes | Not needed | Native plugin API | Supported |
| Claude Code CLI | 2.1.303 | No | No | Yes | MCP server | No adapter yet |
| OpenAI Codex CLI | 0.163.0 | No | No | Yes | MCP server | No adapter yet |
| Gemini CLI | 0.64.0 | No | No | Yes | MCP server | No adapter yet |
| Cursor CLI | 2026.10.08 | No | No | Yes | MCP server | No adapter yet |
| GitHub Copilot CLI | 1.0.98 | No | No | Yes | MCP server | No adapter yet |
| Cline CLI | 0.0.13 | No | No | Yes | MCP or CLI plugin | No adapter yet |
| Continue CLI | 1.5.47 | No | No | Yes | MCP server | No adapter yet |
| Devin CLI (Windsurf) | 3000.11.92 | No | No | Yes | MCP server | No adapter yet |
| Zed | 1.24.2 | No | No | Yes | MCP server | No adapter yet |
| Roo Code | 3.54.0 | No | No | Yes | MCP server | No adapter yet |
| Aider | 0.86.2 | No | No | No | Manual `/web` only | Not supported |

`Not needed` for OpenCode means the native adapter does not require MCP. `No adapter yet`
means a documented integration path exists, but this project has not shipped an adapter for
that host. OpenCode is pinned to the adapter's tested target (2.0.32), not necessarily the
latest OpenCode release.

## Host notes

- **OpenCode v2** — The only shipped adapter. It uses OpenCode's native plugin API and
  exposes both a websearch provider and a fetch tool/override. See
  [OpenCode v2](opencode-v2.md).
- **Claude Code CLI** — Ships built-in `WebSearch` and `WebFetch` tools. No documented native
  provider or override; MCP servers can add tools, and hooks can block calls but do not
  replace the fetch implementation.
- **OpenAI Codex CLI** — MCP servers can add tools. No documented native websearch provider
  or fetch override.
- **Gemini CLI** — Ships built-in `google_web_search` and `web_fetch` tools. No documented
  native provider or override; MCP servers and extensions can add tools.
- **Cursor CLI** — MCP servers can add tools. No documented native provider or fetch
  override.
- **GitHub Copilot CLI** — MCP servers and plugins (which can bundle MCP servers) can add
  tools. No documented native provider or fetch override.
- **Cline CLI** — MCP works. Cline CLI/SDK plugins can add custom tools, but the built-in
  `fetch_web_content` tool is not replaced.
- **Continue CLI** — MCP servers can add tools. A built-in `search_web` tool exists, but it
  is not a custom provider, and there is no documented fetch override.
- **Devin CLI (Windsurf)** — MCP servers can add tools. Plugins bundle skills, rules, hooks,
  and MCP servers, not arbitrary custom tools. Windsurf Desktop/Cascade is a separate IDE
  surface and is not included in this row.
- **Zed** — MCP tools only. No documented native provider or fetch override.
- **Roo Code** — MCP tools only. No documented native provider or fetch override.
- **Aider** — No MCP client in 0.86.2; a native MCP client PR was closed without merging.
  `/web` is a user-invoked command, not a model-callable tool. No native tool API.

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
- Zed: [MCP](https://zed.dev/docs/ai/mcp)
- Roo Code: [MCP](https://docs.roocode.com/features/mcp/overview)
- Aider: [commands](https://aider.chat/docs/usage/commands.html),
  [closed MCP client PR](https://github.com/Aider-AI/aider/pull/5694)

Version sources:

- npm: [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code),
  [Codex](https://www.npmjs.com/package/@openai/codex),
  [Gemini CLI](https://www.npmjs.com/package/@google/gemini-cli),
  [Cline CLI](https://www.npmjs.com/package/@cline/cli),
  [Continue CLI](https://www.npmjs.com/package/@continuedev/cli)
- PyPI: [Aider](https://pypi.org/project/aider-chat/)
- Releases: [Copilot CLI](https://github.com/github/copilot-cli/releases),
  [Zed](https://github.com/zed-industries/zed/releases),
  [Roo Code](https://github.com/RooCodeInc/Roo-Code/releases)
- Changelogs: [Cursor CLI](https://cursor.com/docs/cli/changelog),
  [Devin CLI](https://docs.devin.ai/cli/changelog)
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
