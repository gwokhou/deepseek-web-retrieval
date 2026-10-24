// Shared by Bun formatting/adapter tests and the dependency-free Node mock.
// Deliberately synthetic: these measure output budgets, not upstream page sizes.
export const PI_MCP_OUTPUT_BYTES = 20 * 1024;

export const CONTENT_BUDGET_CASES = [
  { id: "latin-default", pattern: "a", bodyChars: 1500 },
  { id: "cjk-default", pattern: "中", bodyChars: 1500 },
  { id: "cjk-large", pattern: "中", bodyChars: 1500, count: 50 },
  { id: "mixed-default", pattern: "中A😀文B", bodyChars: 1501 },
  { id: "fallback-default", pattern: "中", bodyChars: 1500, fallback: true, contentMaxChars: 500 },
  { id: "fallback-budget", pattern: "中", bodyChars: 1500, fallback: true, contentMaxChars: 500, summaryMaxChars: 500 },
  { id: "cjk-count-four", pattern: "中", bodyChars: 1500, count: 4 },
  { id: "cjk-budget-500", pattern: "中", bodyChars: 1500, contentMaxChars: 500 },
  { id: "multiline-default", pattern: "中\n", bodyChars: 1500 },
  { id: "long-metadata", pattern: "中", bodyChars: 1500, contentMaxChars: 500, titleChars: 1000 },
  // The formatting test pins these to threshold - 1, threshold, threshold + 1.
  { id: "near-below", pattern: "中", bodyChars: 600, titlePadding: 1410, expectedBytes: 20479 },
  { id: "near-exact", pattern: "中", bodyChars: 600, titlePadding: 1411, expectedBytes: 20480 },
  { id: "near-above", pattern: "中", bodyChars: 600, titlePadding: 1412, expectedBytes: 20481 },
];

export function budgetCase(id) {
  return CONTENT_BUDGET_CASES.find((item) => item.id === id);
}

function sizedBody(index, size, pattern, label = "正文") {
  const start = `${label}${index}首`;
  const end = `${label}${index}尾`;
  const length = size - Array.from(start + end).length;
  return start + Array.from(pattern.repeat(size)).slice(0, length).join("") + end;
}

export function contentBudgetResults(scenario, count = scenario.count ?? 10) {
  return Array.from({ length: count }, (_, i) => {
    const index = String(i + 1).padStart(2, "0");
    const result = {
      url: `https://mock.example/budget/${index}`,
      title: `结果 ${index}${"题".repeat(scenario.titleChars ?? 0)}${i === 0 ? "x".repeat(scenario.titlePadding ?? 0) : ""}`,
      summary: scenario.fallback ? sizedBody(index, 1250, "摘", "摘要") : `摘要 ${index}`,
      snippet: `片段 ${index}`,
      content: sizedBody(index, scenario.bodyChars, scenario.pattern),
      rerank_score: 2.5,
      authority: 4,
      site_name: "测试",
      date: "2026-10-24T00:00:00Z",
    };
    if (scenario.fallback) {
      switch (i % 5) {
        case 0:
          delete result.content;
          break;
        case 1:
          result.content = null;
          break;
        case 2:
          result.content = "";
          break;
        case 3:
          result.content = " \n \t ";
          delete result.summary;
          break;
      }
    }
    return result;
  });
}
