import { formatSearchResults, toStructuredResult } from "../src/core/format";
import { resolveSearchOptions, withPerCallCount } from "../src/core/options";
import { processResults } from "../src/core/search";
import { type ContentBudgetCase, contentBudgetResults } from "./fixtures/search-content.mjs";

/** One expected output shared across formatting, adapter, and real-host checks. */
export function budgetOutput(scenario: ContentBudgetCase) {
  const options = withPerCallCount(
    resolveSearchOptions({
      searchContentMaxChars: scenario.contentMaxChars,
      maxSummaryChars: scenario.summaryMaxChars,
    }),
    scenario.count,
  );
  const raw = contentBudgetResults(scenario);
  const results = processResults(raw, options);
  const text = formatSearchResults(results);
  return { raw, options, results, text, structured: { results: results.map(toStructuredResult) } };
}

/** Full result blocks, not just URL presence: a surviving heading can hide a cut body. */
export function resultIntegrity(received: string, expected: ReturnType<typeof budgetOutput>) {
  const complete: number[] = [];
  const visibleUrls: number[] = [];
  const missingUrls: number[] = [];
  for (let i = 0; i < expected.results.length; i++) {
    const result = expected.results[i];
    if (!result) continue;
    const block = formatSearchResults([result]).replace(/^1\./, `${i + 1}.`);
    if (received.includes(block)) complete.push(i + 1);
    if (received.includes(result.url)) visibleUrls.push(i + 1);
    else missingUrls.push(i + 1);
  }
  return { complete, visibleUrls, missingUrls };
}
