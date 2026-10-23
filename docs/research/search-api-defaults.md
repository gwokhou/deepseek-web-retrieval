# Search and fetch API defaults across vendors

This note answers one question: what are the **factory defaults** — the values applied when a
caller passes nothing — of the mature AI-native web-search and web-fetch APIs? It exists
because this repo layers its own client-side defaults on top of the DeepSeek Search/Fetch API,
and the original values (`maxResults=5` on an API `count` of 10, `minRerank=1.5`,
`minAuthority=2`, `allowUnknownAuthority=false`, `maxRetries=0`, `timeout=30s`, fetch
truncation at 16,000 characters, summary truncation at 1,200, response-body cap 5 MiB) were
challenged as arbitrary. The pages below are the benchmark against which the repo's defaults
are grounded; based on this survey the search-side defaults were changed on 2026-10-21 to
`maxResults=10`, `minRerank=0`, `minAuthority=0`, `allowUnknownAuthority=true` (filters stay
available as opt-ins). It records facts only; the closing section lines the repo's values up
against them without recommending changes.

**Research baseline:** 2026-10-21. Claims are cited to primary sources only: official vendor
documentation and official SDK source (GitHub repos and published npm/PyPI packages). Secondhand
blogs and tutorials are excluded. "Default" means the value in force when the parameter is
omitted — not the allowed range, and not an example value. Where no default is published, that
is stated as such rather than guessed.

The five questions asked of every product:

1. Search-result count default (the analogue of this repo's `maxResults`/API `count`).
2. Any **client-side relevance/authority filtering** default (the analogue of
   `minRerank`/`minAuthority`/`allowUnknownAuthority`) — in particular, does anyone drop
   results by authority in the client?
3. HTTP retry default at the SDK layer.
4. Request timeout default (SDK and API layer).
5. Fetched-content truncation default (character limits, byte caps).

## Tavily

API defaults from the official OpenAPI reference for `POST /search`
([docs](https://docs.tavily.com/documentation/api-reference/endpoint/search)):

| Parameter | Default when omitted | Source |
| --- | --- | --- |
| `max_results` | **10** (min 0, max 20) | [API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search) |
| `search_depth` | **`basic`** (vs `advanced`/`fast`/`ultra-fast`) | same |
| `chunks_per_source` | **3** (chunks of ~500 chars `basic`/`fast`, ~800 `advanced`) | same |
| `topic` | **`general`** | same |
| `include_answer` / `include_raw_content` / `include_images` | **false** | same |
| `auto_parameters` | **false** | same |
| `include_domains` / `exclude_domains` | **empty** | same |
| `include_domains_mode` | **`restrict`** ("`include_domains` acts as a hard filter unless set to `prefer`") | same |

No relevance score, authority tier, or any other per-result quality signal is returned or
filterable in the client — ranking is server-side and opaque.

SDK layer ([tavily-python, master](https://github.com/tavily-ai/tavily-python/blob/master/tavily/tavily.py)):
`max_results` and `search_depth` default to `None` (so the API defaults above apply); `search`
has `timeout: float = 60` clamped to `min(timeout, 120)` seconds; `extract` defaults to 30 s and
`crawl` to 150 s. The client posts through a plain `requests.Session` with no retry adapter —
the only retry-related code parses a `retry_after_seconds` field out of error payloads.

## Exa

API defaults from the official OpenAPI spec
([reference](https://exa.ai/docs/reference/search)):

| Parameter | Default when omitted | Source |
| --- | --- | --- |
| `numResults` | **10** (max 100) | [reference](https://exa.ai/docs/reference/search); the [search quickstart](https://exa.ai/docs/search/quickstart) states it in prose: "Search returns up to 10 results by default" |
| `type` | **`auto`** | [reference](https://exa.ai/docs/reference/search) |
| `contents.text` (boolean form) | **false** — "If true, returns full page text with default settings. If false, disables text return." | same |
| `contents.text.verbosity` | **`compact`** | same |
| `contents.highlights` (boolean form) | **false** | same |
| `moderation` | **false** | same |
| `contents.livecrawlTimeout` | **10000 ms** | same |
| `contents.text.maxCharacters` | **no published default** (max 1,000,000); the [contents quickstart](https://exa.ai/docs/contents/quickstart) frames it as opt-in: "Full pages can be large, so use `maxCharacters` when you need a limit" | both |

Like Tavily, Exa exposes no per-result authority/score field and no client filter for one;
`moderation` (off by default) is content-moderation, not authority.

## Perplexity

The Sonar chat-completions API was retired on 2026-09-27; the live products are the Search API
and the Agent API ([migration guide](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview)).

Search API (`POST /search`,
[reference](https://docs.perplexity.ai/api-reference/search-post); the
[quickstart](https://docs.perplexity.ai/docs/search/quickstart) restates it):

| Parameter | Default when omitted | Source |
| --- | --- | --- |
| `max_results` | **10** (1–20) | [quickstart](https://docs.perplexity.ai/docs/search/quickstart): "`max_results` accepts values from 1 to 20 and defaults to 10" |
| `search_type` | **`web`** | [reference](https://docs.perplexity.ai/api-reference/search-post) |

Agent API `web_search` tool ([tool guide](https://docs.perplexity.ai/docs/agent-api/tools/web-search),
[schema](https://docs.perplexity.ai/api-reference/agent-post)): `max_results` accepts 1–50 and
`max_tokens`/`max_tokens_per_page` cap search context, but none of the three publishes a numeric
default — "When omitted, the default budget applies" is all the docs say. The one published
tool-count default in the same schema is `image_search.max_results`: **5** (1–30)
([reference](https://docs.perplexity.ai/api-reference/agent-post)). The retired Sonar
`web_search_options.search_context_size` has no named-size successor; the
[migration table](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to) maps it
to the token budgets above, and the current docs no longer state its old default. No
authority/score filtering exists on any of these surfaces.

## Firecrawl

API defaults from the official OpenAPI references
([search](https://docs.firecrawl.dev/api-reference/endpoint/search),
[scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape)):

| Parameter | Default when omitted | Source |
| --- | --- | --- |
| search `limit` | **10** (1–100; per source type when multiple `sources`) | [search reference](https://docs.firecrawl.dev/api-reference/endpoint/search) |
| search `sources` | **`["web"]`** | same |
| search `timeout` | **60000 ms** | same |
| search `highlights` | **true** | same |
| scrape `timeout` | **60000 ms** (min 1 s, max 300 s) | [scrape reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape) |
| scrape `onlyMainContent` | **true** | same |
| scrape `maxAge` (cache freshness window) | **172800000 ms (2 days)** | same |

No character or byte truncation default is published for scraped content. No authority/score
filter exists.

SDK layer (`@mendable/firecrawl-js` 4.50.0, npm tarball with registry provenance;
[source](https://www.npmjs.com/package/@mendable/firecrawl-js)): `maxRetries` defaults to
**3** (`options.maxRetries ?? 3`), retrying **only HTTP 502** with exponential backoff
(`backoffFactor` 0.5 s × 2^attempt); `timeoutMs` defaults to **300000 ms (5 min)**.

## Jina Reader (r.jina.ai / s.jina.ai)

Official product page ([jina.ai/reader](https://jina.ai/reader/)) and official repo
([jina-ai/reader](https://github.com/jina-ai/reader)):

| Behavior | Default | Source |
| --- | --- | --- |
| Search-mode result count (`s.jina.ai`) | **fixed 5** — "Reader searches the web, fetches the top 5 results, visits each URL, and applies `r.jina.ai` to it"; no count parameter is exposed | [repo README](https://github.com/jina-ai/reader/blob/main/README.md); the [product page](https://jina.ai/reader/) likewise: "it returns a list of five entries" |
| `x-timeout` | **no default set** — optional header, integer seconds, max 180; when absent the option stays `null` (no client-side deadline) | [README](https://github.com/jina-ai/reader/blob/main/README.md) and [`crawler-options.ts`](https://github.com/jina-ai/reader/blob/main/src/dto/crawler-options.ts) (`instance.timeout ??= null`) |
| `x-token-budget` | **no default** (parsed only when sent) | [`crawler-options.ts`](https://github.com/jina-ai/reader/blob/main/src/dto/crawler-options.ts) |
| Content truncation | none published | — |

No relevance/authority filter; no retry logic documented.

## Anthropic web_search / web_fetch server tools

Current docs live at
[web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool),
[web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool),
and the [server tools guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools).

| Parameter | Default when omitted | Source |
| --- | --- | --- |
| `web_search.max_uses` | optional; no numeric default published ("limits the number of searches performed"; guidance: "Simple factual queries typically use 1–3 searches") | [web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) |
| `web_fetch.max_uses` | optional; **"There is currently no default limit."** | [web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) |
| `web_fetch.max_content_tokens` | optional token cap; **no default value published** (doc example: 100000) — "If the fetched content exceeds this limit, the tool truncates it … applies to text content, not to binary content such as PDFs" | [web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) |
| `web_fetch` URL length | hard max **250 characters** | same (error `url_too_long`) |
| `web_fetch` content types | text, HTML, PDF only; `robots.txt` and private addresses respected server-side | same |
| `web_fetch.use_cache` | **true** | same |
| `web_fetch.citations` | **disabled by default** | same |
| `response_inclusion` (both tools) | **`"full"`** | both |
| Result count / authority filter | **neither exists** — the model decides how many searches to run; no score or authority field is returned | both |

A widely repeated pair of numbers — "truncate to 20,000 characters" and "5 MiB" — is **not in
the current official docs** (checked 2026-10-21), nor in the November 2025 snapshot of the same
page on the Internet Archive; the published truncation mechanism is the token-based
`max_content_tokens` parameter above, with no published default.

SDK layer (official repos, default branch):

| SDK | Default timeout | Default max retries | Source |
| --- | --- | --- | --- |
| anthropic-sdk-typescript | **10 minutes** (`options.timeout ?? BaseAnthropic.DEFAULT_TIMEOUT`) | **2** (`options.maxRetries ?? 2`) | [`client.ts`](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts) |
| anthropic-sdk-python | **600 s total, 5 s connect** (`httpx.Timeout(timeout=10 * 60, connect=5.0)`) | **2** (`DEFAULT_MAX_RETRIES = 2`) | [`_constants.py`](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/_constants.py) |

## OpenAI Responses web_search

From the official guide
([Web search tool](https://platform.openai.com/docs/guides/tools-web-search)):

| Parameter | Default when omitted | Source |
| --- | --- | --- |
| Result count | **not exposed** — no count parameter; the docs note the size setting "does not set an exact token count or guarantee a specific number of sources or citations" | [guide](https://platform.openai.com/docs/guides/tools-web-search) |
| `search_context_size` | **`medium`** — "Use `low` for simple lookups, `medium` for a balanced default, and `high` …" | [guide](https://platform.openai.com/docs/guides/tools-web-search) |
| `external_web_access` | **true** (live access) | [guide](https://platform.openai.com/docs/guides/tools-web-search) |
| `return_token_budget` | **`default`** — "Uses the standard returned-token budget … the same behavior as omitting `return_token_budget`" (numeric value unpublished) | [guide](https://platform.openai.com/docs/guides/tools-web-search) |

No relevance/authority score or filter is exposed on any web-search surface.

SDK layer (official repos, default branch):

| SDK | Default timeout | Default max retries | Source |
| --- | --- | --- | --- |
| openai-node | **600000 ms (10 min)** (`OpenAI.DEFAULT_TIMEOUT = 600000`) | **2** (`@param {number} [opts.maxRetries=2]`) | [`client.ts`](https://github.com/openai/openai-node/blob/master/src/client.ts) |
| openai-python | **600 s total, 5 s connect** (`httpx.Timeout(timeout=600, connect=5.0)`) | **2** (`DEFAULT_MAX_RETRIES = 2`); initial retry delay 0.5 s, max 8 s | [`_constants.py`](https://github.com/openai/openai-python/blob/main/src/openai/_constants.py) |

## Brave Search API

From the official Web Search API query documentation
([docs](https://api-dashboard.search.brave.com/app/documentation/web-search/query)):

| Parameter | Default when omitted | Source |
| --- | --- | --- |
| `count` | **20** — "Maximum number of results per page (max 20, default 20). The actual number of results returned may be less than count." | [docs](https://api-dashboard.search.brave.com/app/documentation/web-search/query) |
| `offset` | 0 (0-based, max 9) | same |

No relevance/authority filter beyond `safesearch`-style content controls; ranking is
server-side.

## Linkup

From the official OpenAPI reference
([search reference](https://docs.linkup.so/pages/documentation/endpoints/search/reference))
and the official Python SDK source
([linkup-python-sdk](https://github.com/LinkupPlatform/linkup-python-sdk/blob/main/src/linkup/_client.py)):

| Parameter | Default when omitted | Source |
| --- | --- | --- |
| `depth` | **no published default** — enum `flash`/`fast`/`standard`/`deep`; the spec's prose calls `fast` "the recommended default for most agentic applications" without declaring an omission default. The SDK makes `depth` a required argument | [reference](https://docs.linkup.so/pages/documentation/endpoints/search/reference), [`_client.py`](https://github.com/LinkupPlatform/linkup-python-sdk/blob/main/src/linkup/_client.py) |
| `maxResults` | **no published default** (min 1; schema example: 5) | [reference](https://docs.linkup.so/pages/documentation/endpoints/search/reference) |
| `includeImages` / `includeInlineCitations` / `includeSources` | **false** | same |
| SDK `timeout` | **None — "the request will have no timeout"** | [`_client.py`](https://github.com/LinkupPlatform/linkup-python-sdk/blob/main/src/linkup/_client.py) |

The SDK has no retry loop for transient failures (its one retry path is the x402 payment
handshake). No relevance/authority filter exists.

## You.com

The API documentation is still public at
[you.com/docs](https://you.com/docs/api-reference/search/v1-search). Defaults for
`POST /v1/search` ([reference](https://you.com/docs/api-reference/search/v1-search)):

| Parameter | Default when omitted | Source |
| --- | --- | --- |
| `count` | **10** — per section (`web` and `news`) | [reference](https://you.com/docs/api-reference/search/v1-search) |
| `safesearch` | **`moderate`** | same |
| `crawl_timeout` | **10 s** (1–60) | same |
| `livecrawl_formats` (deprecated) | **`["html"]`** | same |
| `extraction.highlights.total_max_tokens` | **8192 tokens** (range 1024–8192; "Omit it to get the default budget of 8192") | same |
| `extraction.full_page.extraction_formats` | **`["markdown"]`** | same |
| Result content | **snippets by default**; highlights/full-page are opt-in via `extraction` | same |

`moderate` safesearch is a content-moderation filter, not an authority filter; no
relevance/authority score is exposed.

## What DeepSeek itself claims

The challenge quote attributed to the DeepSeek docs — an "AI 原生的通用搜索引擎" that
"通过严格的识别机制进行过滤，确保向用户与 LLM 呈现权威可信的信息" — is **not present** on
<https://api-docs.deepseek.com/guides/search> (checked 2026-10-21, English and 中文 pages).
The closest positioning sentences actually on the page:

- EN: "It is powered by DeepSeek's in-house search engine."
  ([guide](https://api-docs.deepseek.com/guides/search))
- ZH: "该接口由 DeepSeek 自研搜索引擎提供支持。"
  ([指南](https://api-docs.deepseek.com/zh-cn/guides/search))

So the official docs claim an in-house engine but make **no published claim of server-side
quality filtering**. What they do publish, verbatim
([指南](https://api-docs.deepseek.com/zh-cn/guides/search)):

- `rerank_score`: "排序分数，0～3 分，综合考虑相关性、权威性、时效性等维度，**大于等于 1.5 分为优质结果**。"
- `authority`: "网页权威性，0～4（**-1 表示未知**），**大于等于 3 为极权威结果**。"
- Request defaults: `count` "否 / 默认值 10 / 返回条数，1～50"; `need_content` "否 / false";
  `ori_question` optional ("触发搜索的用户原始问题，1～128 个字符").
- `localization` (checked 2026-10-23): documented as "用于优先返回本地化搜索结果的 IP
  地址" — an IP address used to prefer geo-localized results, optional, default empty. The
  docs pin nothing beyond "IP 地址"; this repo accepts exactly what `net.isIP` validates
  (IPv4 or IPv6) and drops anything else at option resolution.
- Query operators (checked 2026-10-23): the `query` "会原样传递给搜索服务" and supports
  `site:` / `-site:` / `lang:` (e.g. `lang:zh,en`) plus the time filters `after:` ("将结果限制在指定日期之后发布的网页")
  and `before:` ("将结果限制在指定日期之前发布的网页") — each taking a year or a date, with the
  doc examples "DeepSeek after:2025 或 DeepSeek after:2025-01-01" and
  "DeepSeek before:2026 或 DeepSeek before:2026-06-01".
- Response sizing: `snippet` "短摘要 … 通常为 100～200 字符"; `summary` "长摘要 … 通常为 600～800 字符".

Two follow-up notes examine the request parameters this section lists only as defaults:
[search-inline-content.md](search-inline-content.md) covers `need_content: true` — what
provably returns, what it costs, how large it can get, and where that collides with
per-host output caps — and [ori-question-sourcing.md](ori-question-sourcing.md) covers
`ori_question` — the per-host channels that could supply a value (the MCP and Pi adapters
now send it; OpenCode's websearch provider path has no input channel at its lock).

## What this means for this repo's defaults

Fact-by-fact alignment of the repo's client-side defaults
(`src/core/constants.ts`) against the surveyed factory defaults. No recommendation is made
here; the table only lines up what the industry ships.

| Repo default | Industry factory defaults observed above |
| --- | --- |
| API `count=10`, client `maxResults=10` (post-dedup cap; `5` before 2026-10-21) | API-level count defaults: Tavily 10, Exa 10, Perplexity Search API 10, Firecrawl 10, You.com 10 (per section), Brave 20. Post-filter caps are uncommon; a fixed 5 exists at Jina (`s.jina.ai` top 5, not configurable) and Perplexity's `image_search` tool (default 5). Linkup's schema example is 5 but no default is published. OpenAI and Anthropic expose no count at all |
| `minRerank=0`, `minAuthority=0`, `allowUnknownAuthority=true` — no client-side filtering (previously `1.5`/`2`/`false`) | **No surveyed product filters search results client-side by relevance score or authority.** The only published thresholds for DeepSeek's own fields are the docs' quality labels (≥1.5 "优质", ≥3 "极权威") — labels, not filters. The closest shipped analogues are domain allow/block lists (Tavily, Exa, Perplexity, You.com, Anthropic, Brave) and You.com's `safesearch: moderate` default, which is content moderation, not authority |
| `maxRetries=2` — changed from `0` on 2026-10-23: this package runs as an agent tool, where a transient failure left un-retried falls to the model re-issuing the whole billed tool call, the failure profile of the model-API SDKs in this row (2, both languages) rather than of the split search-API SDKs; the default followed the model-SDK column | Official model-API SDKs: OpenAI 2, Anthropic 2 (both languages). Search-API SDKs: firecrawl-js 3 (502 only), tavily-python 0, Linkup SDK 0 |
| `timeout=30s` (search and fetch, 1–120 s range, covers body read) | Search/scrape API timeouts: Firecrawl 60 s (scrape max 300 s), Tavily SDK search 60 s (cap 120 s) / extract 30 s, You.com `crawl_timeout` 10 s, Linkup SDK no timeout, Jina `x-timeout` unset by default (max 180 s). Model-API SDKs: OpenAI and Anthropic 10 minutes |
| Fetch truncation 16,000 chars | Exa: page text **off** by default (`contents.text: false`), opt-in `maxCharacters` with no published default; DeepSeek itself: `need_content: false` by default; Anthropic `web_fetch`: token-based `max_content_tokens`, no published default (example 100000), no char/MiB figure in current docs; You.com highlights budget 8192 tokens; Firecrawl and Jina publish no truncation default |
| Summary truncation 1,200 chars | DeepSeek's own field doc says `summary` is "通常为 600～800 字符"; no surveyed vendor ships a client-side summary cap (they return snippets/highlights sized server-side: Exa verbosity `compact`, You.com highlights budget) |
| Response body cap 5 MiB | No surveyed product publishes a response-body byte cap; the only published byte-adjacent limits are Anthropic's URL length (250 chars) and content-type whitelist, and Exa's `maxCharacters` ceiling of 1,000,000 characters |
| Filter markers (`minRerank`/`minAuthority` matching) | Nothing to compare: no surveyed vendor returns a per-result authority tier at all — DeepSeek's `rerank_score`/`authority` response fields are the outlier, which is what makes client-side thresholds possible here and nowhere else in this survey |

## Sources

- DeepSeek: [Search & Fetch guide (EN)](https://api-docs.deepseek.com/guides/search) ·
  [网页搜索与抓取 (ZH)](https://api-docs.deepseek.com/zh-cn/guides/search)
- Tavily: [search API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search) ·
  [tavily-python source](https://github.com/tavily-ai/tavily-python/blob/master/tavily/tavily.py)
- Exa: [search reference (OpenAPI)](https://exa.ai/docs/reference/search) ·
  [search quickstart](https://exa.ai/docs/search/quickstart) ·
  [contents quickstart](https://exa.ai/docs/contents/quickstart)
- Perplexity: [Search API quickstart](https://docs.perplexity.ai/docs/search/quickstart) ·
  [Search API reference](https://docs.perplexity.ai/api-reference/search-post) ·
  [Agent API web_search tool](https://docs.perplexity.ai/docs/agent-api/tools/web-search) ·
  [Agent API schema](https://docs.perplexity.ai/api-reference/agent-post) ·
  [Sonar migration guide](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to)
- Firecrawl: [search reference](https://docs.firecrawl.dev/api-reference/endpoint/search) ·
  [scrape reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape) ·
  [npm @mendable/firecrawl-js](https://www.npmjs.com/package/@mendable/firecrawl-js)
- Jina: [reader product page](https://jina.ai/reader/) ·
  [jina-ai/reader README](https://github.com/jina-ai/reader/blob/main/README.md) ·
  [crawler-options.ts](https://github.com/jina-ai/reader/blob/main/src/dto/crawler-options.ts)
- Anthropic: [web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) ·
  [web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) ·
  [server tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools) ·
  [anthropic-sdk-typescript client.ts](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts) ·
  [anthropic-sdk-python _constants.py](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/_constants.py)
- OpenAI: [web search tool guide](https://platform.openai.com/docs/guides/tools-web-search) ·
  [openai-node client.ts](https://github.com/openai/openai-node/blob/master/src/client.ts) ·
  [openai-python _constants.py](https://github.com/openai/openai-python/blob/main/src/openai/_constants.py)
- Brave: [Web Search API query docs](https://api-dashboard.search.brave.com/app/documentation/web-search/query)
- Linkup: [search reference (OpenAPI)](https://docs.linkup.so/pages/documentation/endpoints/search/reference) ·
  [linkup-python-sdk _client.py](https://github.com/LinkupPlatform/linkup-python-sdk/blob/main/src/linkup/_client.py)
- You.com: [POST /v1/search reference](https://you.com/docs/api-reference/search/v1-search)
