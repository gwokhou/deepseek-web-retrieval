// Run only inside the pinned e2e container, beside the host CLI it mocks.
// Serves the three upstreams the keyless session scenarios need, with zero
// dependencies: the DeepSeek retrieval endpoints (/v1/tools/search|fetch) and
// an OpenAI-compatible chat completions endpoint whose two-round script drives
// a real host session loop — round one issues a tool call, round two turns the
// tool result into the final answer, so a scenario passes only when the tool
// result actually reached the model. Every request is appended to a JSONL log
// the host-side scenario asserts against (path, Authorization, body).
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { budgetCase, contentBudgetResults } from "../fixtures/search-content.mjs";

const args = process.argv.slice(2);
const port = Number(option(args, "--port") ?? "8791");
const logFile = option(args, "--log");

export const FETCH_TITLE = "Example Domain";
export const FETCH_CONTENT =
  "# Example Domain\n\nThis domain is for use in illustrative examples in documents. (mock-upstream e2e)";
export const SEARCH_URL = "https://mock.example/e2e-search";
export const SEARCH_CONTENT_NEEDLE = "need_content e2e body needle";

function option(list, name) {
  const index = list.indexOf(name);
  return index === -1 ? undefined : list[index + 1];
}

function log(entry) {
  if (!logFile) return;
  appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
}

/** The needles a round-two tool result must contain, by planned call. */
function needleFor(call) {
  if (call.arguments?.query?.startsWith("budget:")) return "https://mock.example/budget/01";
  if (call.name === "deepseek_fetch" || call.name === "webfetch") return FETCH_TITLE;
  if (call.arguments?.need_content === true) return SEARCH_CONTENT_NEEDLE;
  return SEARCH_URL;
}

/** Round one: which tool call the script issues, keyed off the user prompt. */
function plannedCall(lastUserText, tools = []) {
  const text = lastUserText.toLowerCase();
  const scenario = budgetCase(/budget:([a-z0-9-]+)/.exec(text)?.[1]);
  if (scenario) {
    // Use the host's advertised name: native Pi is unprefixed; MCP is namespaced.
    const name = tools.map((tool) => tool.function?.name).find((name) => name?.endsWith("deepseek_web_search"));
    if (!name)
      throw new Error(
        `budget mock: search tool was not advertised: ${JSON.stringify(tools.map((tool) => tool.function?.name ?? tool.name))}`,
      );
    return {
      name,
      arguments: {
        query: `budget:${scenario.id}`,
        need_content: true,
        ...(scenario.count === undefined ? {} : { count: scenario.count }),
      },
    };
  }
  if (text.includes("deepseek_fetch")) {
    return { name: "deepseek_fetch", arguments: { url: "https://example.com" } };
  }
  if (text.includes("deepseek_web_search") && text.includes("need_content")) {
    return { name: "deepseek_web_search", arguments: { query: "example domain", need_content: true } };
  }
  if (text.includes("deepseek_web_search")) {
    return { name: "deepseek_web_search", arguments: { query: "example domain" } };
  }
  if (text.includes("websearch")) {
    // OpenCode's built-in websearch tool, backed by the plugin's deepseek provider.
    return { name: "websearch", arguments: { query: "example domain" } };
  }
  return undefined;
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => (typeof part?.text === "string" ? part.text : "")).join(" ");
  }
  return "";
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messageText(messages[i]);
  }
  return "";
}

function toolMessages(messages) {
  return messages.filter((message) => message?.role === "tool");
}

function chunk(delta, finishReason) {
  return {
    id: "chatcmpl-mock-e2e",
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model: "mock-chat",
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
  };
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function handleChat(res, bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    sendJson(res, 400, { error: { message: "mock: invalid JSON" } });
    return;
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = toolMessages(messages);
  const call = plannedCall(lastUserText(messages), body.tools);

  let message;
  let finishReason;
  if (tools.length === 0 && call !== undefined) {
    // Round one: issue the planned tool call.
    message = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_mock_e2e",
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        },
      ],
    };
    finishReason = "tool_calls";
    log({ kind: "chat", round: "tool-call", tool: call.name, arguments: call.arguments });
  } else if (tools.length > 0) {
    // Round two: the tool result must carry the needle, and the final answer
    // quotes it — so the scenario's assertion fails loudly when it does not.
    const result = messageText(tools[tools.length - 1]);
    const expected = call !== undefined ? needleFor(call) : SEARCH_URL;
    const answer = result.includes(expected)
      ? expected
      : `MOCK-UPSTREAM tool result did not contain "${expected}": ${result.slice(0, 300)}`;
    message = { role: "assistant", content: answer };
    finishReason = "stop";
    if (call?.arguments?.query?.startsWith("budget:")) {
      // Keep the complete text for boundary assertions; the old 2,000-character
      // diagnostic excerpt cannot prove that middle or final results arrived.
      const savedPath = /^\[Full output: (.+) \(read it with offset\/limit\)\]$/m.exec(result)?.[1];
      const saved = savedPath ? readFileSync(savedPath) : undefined;
      log({
        kind: "chat",
        round: "final",
        toolResult: result,
        toolResultBytes: Buffer.byteLength(result),
        ...(saved
          ? { savedOutputBytes: saved.length, savedOutputSha256: createHash("sha256").update(saved).digest("hex") }
          : {}),
      });
    } else {
      log({ kind: "chat", round: "final", toolResult: result.slice(0, 2000) });
    }
  } else {
    message = { role: "assistant", content: "MOCK-UPSTREAM no planned tool call for this prompt" };
    finishReason = "stop";
    log({ kind: "chat", round: "unplanned" });
  }

  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const frames = [
      chunk({ role: "assistant" }),
      message.content !== null ? chunk({ content: message.content }) : chunk({ tool_calls: message.tool_calls }),
      chunk({}, finishReason),
    ];
    for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`);
    // pi's OpenAI client asks for usage in streaming (stream_options.include_usage).
    res.write(`data: ${JSON.stringify({ ...chunk({}, undefined), choices: [], usage })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }
  sendJson(res, 200, {
    id: "chatcmpl-mock-e2e",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "mock-chat",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage,
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    // HTTP chunks may split a CJK/emoji code point in the larger budget cases.
    // StringDecoder behind setEncoding preserves it across chunk boundaries.
    req.setEncoding("utf8");
    req.on("data", (part) => {
      text += part;
    });
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/v1/tools/search")) {
      const body = JSON.parse(await readBody(req));
      log({ kind: "search", auth: req.headers.authorization ?? null, body });
      const scenario = budgetCase(body.query?.replace(/^budget:/, ""));
      if (scenario) {
        const results = contentBudgetResults(scenario, body.count);
        if (body.need_content !== true) for (const result of results) delete result.content;
        sendJson(res, 200, { results });
        return;
      }
      // The page body rides along only when the call asked for it, mirroring
      // the real API: a digest response carries no content field at all.
      const result = {
        url: SEARCH_URL,
        title: "Mock Search Result",
        snippet: "mock search needle for the keyless e2e session",
        rerank_score: 2.5,
        authority: 4,
        site_name: "Mock",
      };
      if (body.need_content === true) {
        result.content = `# Mock Page\n\n${SEARCH_CONTENT_NEEDLE}\n\n- a structural point`;
      }
      sendJson(res, 200, { results: [result] });
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/v1/tools/fetch")) {
      const body = JSON.parse(await readBody(req));
      log({ kind: "fetch", auth: req.headers.authorization ?? null, body });
      sendJson(res, 200, { title: FETCH_TITLE, content: FETCH_CONTENT });
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
      handleChat(res, await readBody(req));
      return;
    }
    sendJson(res, 404, { error: { message: `mock: no route for ${req.method} ${url.pathname}` } });
  } catch (error) {
    sendJson(res, 500, { error: { message: `mock: ${String(error)}` } });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock-upstream listening on http://127.0.0.1:${port}`);
});
