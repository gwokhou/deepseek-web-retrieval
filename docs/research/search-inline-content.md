# Search with inline content: `need_content` facts

This note answers one question: if DeepSeek's Search API were called with
`need_content: true` (today the repo hardcodes `false`), what would the response provably
contain, what would it cost, how large could it get, and where does that collide with
per-host output caps? It extends
[search-api-defaults.md](search-api-defaults.md) — which surveyed factory defaults — with the
one question that survey did not ask: which vendors ship search-with-inline-content as the
default architecture versus opt-in, and with what per-result content budget. It records facts
only; the closing section lines the facts up against the current two-tool design (search
summary-only plus a separate fetch tool) without recommending for or against it.

**Research baseline: 2026-10-23.** Claims are cited to primary sources only: official
DeepSeek documentation (api-docs.deepseek.com, English and 中文 pages, plus the official FAQ
bundle), other vendors' official documentation and SDK/API references, and OpenAI Codex
source at the repo's locked tag. Secondhand blogs are excluded. Where no primary source pins
a fact — most importantly the size of `content` — that is stated as such: an undocumented
size is itself a decision-relevant fact.

## What `need_content=true` provably returns

From the official Search & Fetch guide, the parameter and its response field, verbatim:

| Item | 中文 | English |
| --- | --- | --- |
| `need_content` (request) | “是否在 content 中返回网页正文，为 false 时 content 恒为空字符串。” | "Whether to return page content in content, which is always an empty string when false." |
| `content` (search response) | “网页正文，need_content 为 false 或正文缺失时为空字符串。” | "The page content, which is empty when need_content is false or when the content is unavailable." |

([指南](https://api-docs.deepseek.com/zh-cn/guides/search) ·
[guide](https://api-docs.deepseek.com/guides/search), checked 2026-10-23.)

Three facts follow, all of them absences:

1. **No size bound of any kind is documented for `content`.** The same guide gives "通常"
   sizing for the other two text fields — `snippet` "通常为 100～200 字符" ("typically 100 to
   200 characters"), `summary` "通常为 600～800 字符" ("typically 600 to 800 characters") —
   but has **no analogous statement** for `content`: no "通常" range, no maximum, no
   truncation rule, no server-side character cap. An undocumented content size is the
   single most decision-relevant fact in this note.
2. **No format statement for search `content`.** The Fetch API's `content` field is
   explicitly Markdown — "The fetched page content as Markdown text." /
   “抓取后的 Markdown 正文” — but the Search API's `content` field carries no format
   statement. Whether search-side `content` is the same Markdown rendering the Fetch
   endpoint returns, or something else, is not documented. “正文缺失时为空字符串”
   ("or when the content is unavailable") implies per-result content can be missing
   independently of `need_content`, which matches the Fetch API's own empty-content failure
   mode; no recovery behavior is specified for search.
3. **No `need_content` × `count` interaction is documented.** The only sentence linking a
   request parameter to result shape is about count and price (below); nothing says content
   is returned for only the top N results, or that `count` behaves differently under
   `need_content`.

## Billing and rate limits

**Billing is per successful request, and `need_content` is never mentioned in connection
with price.** Verbatim from the guide and pricing page:

- “Search 和 Fetch 按请求次数计费，不按 token 或返回结果条数计费” — Search and Fetch are
  billed per request, **not by token or by number of results returned**
  ([指南](https://api-docs.deepseek.com/zh-cn/guides/search)).
- "count only controls how many results are returned and does not affect the per-request
  price." / “count 只控制返回的结果条数，不影响单次请求的价格。” (same guide, both languages.)
- Price: Search and Fetch are each "Per 1,000 successful requests $0.75"
  ([pricing](https://api-docs.deepseek.com/quick_start/pricing); the 中文 pages state
  每 1,000 次成功请求 5 元). A request is billable "only when it returns HTTP 200 and
  produces a result" (Search must return non-empty `results`; Fetch must return page
  content); failures, empty results, and timeouts are free.
- Neither the guide, the pricing page, nor the official FAQ
  (`static.deepseek.com/faq`, whose embedded question set was inspected — it contains zero
  entries about the Search/Fetch API) mentions `need_content` as a price modifier. Under
  the documented model, a `need_content: true` search is one request at the Search
  per-request price; there is no token-metered billing tier for Search/Fetch to move into.

One dated note on the pricing page (verbatim, EN): "when you use the DeepSeek API through
DeepSeek Harness, Claude Code, or Codex," server-side tool calls already hit the Search and
Fetch APIs; "These calls are currently free of charge;" — “这部分 Search/Fetch 接口调用目前未计费，
并将于北京时间 2026 年 11 月 1 日 00:00 起按次收取调用费用” (per-request billing for those
server-side-tool calls starts 00:00 Beijing time on 2026-11-01 — nine days after this note's
baseline). This note concerns the repo's direct `/v1/tools/search` calls, which follow the
per-request price above, not those chat-completions-internal tool calls.

**Rate limits are per endpoint and independent; `need_content` is not mentioned.** Search
100 QPS, Fetch 25 QPS per account; “Search 和 Fetch 分别独立限速，互不占用额度” ("traffic to
one does not consume the other's quota"); “除了账号级限制，Fetch 还针对目标域名有 QPS 限制”
(Fetch additionally has an unspecified per-domain QPS limit)
([guide](https://api-docs.deepseek.com/guides/search)). A `need_content: true` call is a
Search-endpoint call; no page documents it counting against anything but the Search quota.

## Official guidance on `need_content` vs the Fetch endpoint

None exists. The guide gives only the two positioning sentences — Search “按 query 搜索网页，
返回结构化结果”, Fetch “抓取单个网页，以 Markdown 文本返回页面内容” — with no use-case,
latency, or cost trade-off statement, in either language. (Checked 2026-10-23; also absent
from the FAQ.)

## Vendor architectures: who ships content-bearing search by default

Extending [search-api-defaults.md](search-api-defaults.md) (which established the defaults)
with the architecture reading. "Inline by default" means the caller gets page bodies in the
search response without setting any parameter.

| Vendor | Content inline by default? | Opt-in mechanism | Per-result content budget knob | Separate fetch tool? |
| --- | --- | --- | --- | --- |
| **Tavily** | Partial — default response carries per-result `content` of **relevance chunks**: `chunks_per_source` **3** chunks of ~500 chars (~1,500 chars/result) | Full body via `include_raw_content` (default **false**; accepts `markdown`/`text`/`true`) | Chunk count only (`chunks_per_source` 1–3, sizes `content`, **not** `raw_content`); no knob limits `raw_content` size in `/search` | Yes — `/extract` (up to 20 URLs; `extract_depth` basic/advanced; no per-URL cap; ~800-char chunks only when `query` is given) |
| **Exa** | No — `contents.text` defaults **false** | `contents.text: true` in the **same** `POST /search` body | **`maxCharacters`** (1–1,000,000, no published default) plus `verbosity` `compact`/`standard`/`full` | Yes — `/contents` endpoint by result ID/URL |
| **You.com** | No — “Omit `extraction` for a plain search that returns snippets only” | `extraction.full_page` (“crawls each result and returns the page content”) | **None for `full_page`** (only `crawl_timeout`); the `highlights` mode has a response-wide `total_max_tokens` budget of **8192** (1,024–8,192) | No dedicated fetch endpoint documented on `/v1/search` |
| **Perplexity** | No — Search API results are `title`/`url`/`snippet`/`date` only | Token budgets: `max_tokens` ("Maximum total webpage content tokens to return across all search results") and **`max_tokens_per_page`** ("Maximum webpage content tokens to extract from each result page"), on both the Search API and the Agent API `web_search` tool; **no default published** for either ("the default budgets apply"); on the Search API the extracted text surfaces through `snippet` | **`max_tokens_per_page`** (min 1, max 1,000,000, no default) | Yes — Agent API "Fetch URL Content" tool ("Fetch full content from known URLs") |
| **Anthropic** | Not caller-visible — `web_search` results carry `url`/`title`/`page_age` plus `encrypted_content` (“Encrypted content that you must pass back in multi-turn conversations”); the model reads content in its context, the caller cannot | `response_inclusion` (`"full"` default / `"excluded"`) only controls whether consumed search blocks are echoed in the response — it is not a content-size knob | **None** (dynamic filtering on `web_search_20260209+` has Claude write code to filter results before they reach context, but no caller-set budget) | Yes — `web_fetch` with token-based `max_content_tokens` (no published default) |
| **Firecrawl** | No — search returns `title`/`description`/`url` (+ `highlights`, default true) | `scrapeOptions` (default `{}`): "Include `scrapeOptions` with `formats: [{"type": "markdown"}] to get complete markdown content for each search result" | **None** for content size (`onlyMainContent` default true trims boilerplate, not length) | Collapsed into search via `scrapeOptions`; standalone `/scrape` endpoint also exists |
| **Jina** (`s.jina.ai`) | **Yes — the only default-content architecture surveyed**: "Reader searches the web, fetches the top 5 results, visits each URL, and applies `r.jina.ai` to it"; result count is fixed at 5, not a parameter | None needed (content is the product) | **`x-token-budget`** header, no default (parsed only when sent) — a global budget, not per-result | Same product (`r.jina.ai`) serves plain fetch |
| **DeepSeek (subject of this note)** | No — `need_content` defaults **false** | `need_content: true` | **None documented** (see above) | Yes — Fetch API, Markdown, no documented size cap |

The split, stated plainly: of the eight architectures surveyed, exactly one (Jina
`s.jina.ai`) ships content-bearing search as the default, and it pins the result count at 5.
Every other vendor makes inline content opt-in (Tavily `raw_content`, Exa `contents.text`,
You.com `extraction`, Firecrawl `scrapeOptions`, Perplexity token budgets) or keeps page
content out of the caller's hands entirely (Anthropic `encrypted_content`). Where budgets
exist they are per-result character caps (Exa `maxCharacters`) or per-result token caps
(Perplexity `max_tokens_per_page`); Tavily and You.com ship full-content modes with **no**
per-result size knob at all — the two closest analogues to DeepSeek's `need_content`.

Sources: [Tavily /search](https://docs.tavily.com/documentation/api-reference/endpoint/search) ·
[Tavily /extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract) ·
[Exa /search](https://exa.ai/docs/reference/search) ·
[You.com /v1/search](https://you.com/docs/api-reference/search/v1-search) ·
[Perplexity /search](https://docs.perplexity.ai/api-reference/search-post) ·
[Perplexity Agent web_search](https://docs.perplexity.ai/docs/agent-api/tools/web-search) ·
[Anthropic web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) ·
[Anthropic web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) ·
[Firecrawl /search](https://docs.firecrawl.dev/api-reference/endpoint/search) ·
[Jina reader README](https://github.com/jina-ai/reader/blob/main/README.md) — all checked
2026-10-23; Tavily/Exa/You.com/Jina defaults cross-checked against
[search-api-defaults.md](search-api-defaults.md).

## Volume math against host caps

**Assumptions, labeled as such (not source-backed):** a typical article page body rendered
to Markdown is ~2,000–10,000 characters (assumption; it is consistent with this repo's own
calibration that 16,000 chars is a sensible budget for one *fetched* page, but no vendor
publishes a typical body size); English text ≈ 1 byte and CJK ≈ 3 bytes per UTF-8 char;
English ≈ 4 chars per token and CJK ≈ 1–1.5 chars per token (rough tokenizer conventions,
assumptions).

With `count=10` (the repo's default, and DeepSeek's) and `need_content: true`:

- **Response size, order of magnitude:** 10 × 2k–10k chars of body ≈ **20k–100k chars**,
  plus ~1k chars of metadata per result (title/url/snippet/summary/scores) → roughly
  **30k–110k chars**, i.e. **~30–110 KB** for English pages and up to **~330 KB** if pages
  are CJK-heavy. A single malformed huge page (a pasted log, a link farm) can exceed this
  unboundedly — there is no documented server-side cap (the key fact above).
- **Pi, MCP path: collides at the low end of the assumption.** Text results over **20 KB**
  are middle-truncated (full text saved to a file) and the per-request timeout is **60 s**
  ([control-matrix.md](control-matrix.md)). Even 10 × 2k-char bodies plus metadata (~30 KB)
  exceeds 20 KB. Staying under 20 KB at count=10 requires ≲**1.8k chars of content per
  result** after metadata. Caveat from the same note: the *shipped* Pi adapter is the native
  extension, whose results bypass the MCP layer — "neither the 20 KB truncation nor the 60 s
  request timeout applies"; the cap binds the MCP fallback path only.
- **Claude Code: collides at the high end.** Tool output is capped at **25k tokens** by
  default (`MAX_MCP_OUTPUT_TOKENS`), oversized text saved to a file
  ([control-matrix.md](control-matrix.md)). 30k–110k English chars ≈ 8k–28k tokens —
  brushing or overflowing the cap at the top of the assumed range; CJK at 1–1.5 chars/token
  ≈ 20k–110k tokens — overflowing from the middle of the range up. Staying under 25k tokens
  at count=10 requires ≲**2.5k tokens (~10k English chars) per result**.
- **Codex: collides by policy, magnitude unpublished.** Codex truncates tool output by a
  per-model, server-provided truncation policy (bytes or tokens — "Server-provided
  truncation policy metadata for a model"), using **middle truncation**, with a 20%
  serialization allowance added (`with_serialization_allowance` = policy × 1.2); no default
  number is published in the repo or config reference (the only literal in source,
  `bytes(10_000)`, is a `#[cfg(test)]` fixture). The per-tool override
  `mcp_servers.<id>.tools.<tool>.output_token_limit` exists ("Token budget for one MCP
  tool's output, before the standard 20% serialization allowance")
  ([config reference](https://learn.chatgpt.com/docs/config-file/config-reference);
  [mcp_types.rs at rust-v0.163.0](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/mcp_types.rs)).
  [control-matrix.md](control-matrix.md) records Codex's 300 s MCP tool timeout — latency,
  not size, is that host's documented ceiling.
- **The binding constraint is Pi's 20 KB**, roughly an order of magnitude tighter than
  Claude Code's 25k-token default: a per-result content budget in the **~1k–2k char**
  range keeps count=10 under every published cap; reusing the repo's fetch budget (16,000
  chars) *per search result* would reach 160k chars per response — 8× Pi's cap and ~40k
  tokens on Claude Code.
- **The repo's own 5 MiB `MAX_RESPONSE_BYTES` is not the binding constraint** at these
  assumptions (10 results would need to average ~500 KB each to reach it), but note it
  **rejects** oversized bodies with an error rather than truncating
  ([transport.ts](../../src/core/transport.ts) `readResponseText`), and with no documented
  server-side cap, a pathological page could trip it.

## What this means for this repo

Fact-by-fact alignment with the current code. No recommendation is made here; the
maintainer decides.

- **The toggle point is one hardcoded literal.** `searchWeb` posts `need_content: false`
  ([client.ts](../../src/core/client.ts)); everything else about a content-bearing mode
  would be new surface.
- **Today's pipeline would silently drop the content.** `DeepSeekSearchResult`
  ([types.ts](../../src/core/types.ts)) has no `content` field, and `processResults`
  ([search.ts](../../src/core/search.ts)) maps `SearchResult.content` from
  `summary ?? snippet` only — a `need_content` response's page bodies would be received and
  discarded, unbilled-for-nothing but also unrendered.
- **The only per-result clamp in the search path is `maxSummaryChars` (1,200)** — a
  summary/snippet budget. `fetchMaxChars` (16,000) and `formatFetchedContent`'s
  truncation-marker logic apply exclusively to the fetch tool path. There is **no per-result
  page-content budget knob of any kind**; the vendor table above shows the two shapes such
  a knob takes elsewhere (Exa's per-result `maxCharacters`, Perplexity's per-result
  `max_tokens_per_page`).
- **`MAX_RESPONSE_BYTES` (5 MiB) is the only existing guard a need_content response meets**,
  and it errors rather than truncates — the one host cap it protects against is the
  undocumented-content-size scenario at its pathological extreme.
- **Text rendering flattens structure.** `formatSearchResults` ([format.ts](../../src/core/format.ts))
  renders each result's `content` with newlines replaced by single spaces — sized for a
  1,200-char summary. Multi-thousand-character Markdown bodies in the text content block
  would lose heading/list structure; the `structuredContent` mirror preserves it as-is.
- **The two facts that make this decision unusual:** DeepSeek documents **no size bound and
  no per-result budget knob** for `need_content` content (unlike Exa/Perplexity, whose
  opt-in modes ship with budget parameters), and **no vendor but Jina ships
  content-bearing search by default** — with Jina pinning count at 5, exactly the
  count-shrinking direction the Pi 20 KB arithmetic above pushes toward.

## Sources

- DeepSeek: [Search & Fetch guide (EN)](https://api-docs.deepseek.com/guides/search) ·
  [网页搜索与抓取 (ZH)](https://api-docs.deepseek.com/zh-cn/guides/search) ·
  [Pricing](https://api-docs.deepseek.com/quick_start/pricing) ·
  [FAQ (static.deepseek.com/faq)](https://static.deepseek.com/faq/index.html?lang=en) —
  question set inspected from the app bundle, 2026-10-23
- Tavily: [search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search) ·
  [extract endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/extract)
- Exa: [search reference](https://exa.ai/docs/reference/search)
- You.com: [POST /v1/search reference](https://you.com/docs/api-reference/search/v1-search)
- Perplexity: [Search API reference](https://docs.perplexity.ai/api-reference/search-post) ·
  [Agent API web_search tool](https://docs.perplexity.ai/docs/agent-api/tools/web-search)
- Anthropic: [web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) ·
  [web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)
- Firecrawl: [search endpoint](https://docs.firecrawl.dev/api-reference/endpoint/search)
- Jina: [reader README](https://github.com/jina-ai/reader/blob/main/README.md)
- Codex: [config reference](https://learn.chatgpt.com/docs/config-file/config-reference) ·
  [mcp_types.rs at rust-v0.163.0](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/mcp_types.rs) ·
  [openai_models.rs at rust-v0.163.0](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/protocol/src/openai_models.rs) ·
  [output truncation lib at rust-v0.163.0](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/utils/output-truncation/src/lib.rs)
- Repo: [search-api-defaults.md](search-api-defaults.md) ·
  [control-matrix.md](control-matrix.md) ·
  [constants.ts](../../src/core/constants.ts) · [client.ts](../../src/core/client.ts) ·
  [search.ts](../../src/core/search.ts) · [format.ts](../../src/core/format.ts) ·
  [transport.ts](../../src/core/transport.ts)
