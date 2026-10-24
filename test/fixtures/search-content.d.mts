import type { DeepSeekSearchResult } from "../../src/core/types";

export interface ContentBudgetCase {
  readonly id: string;
  readonly pattern: string;
  readonly bodyChars: number;
  readonly count?: number;
  readonly fallback?: boolean;
  readonly contentMaxChars?: number;
  readonly summaryMaxChars?: number;
  readonly titleChars?: number;
  readonly titlePadding?: number;
  readonly expectedBytes?: number;
}
export const PI_MCP_OUTPUT_BYTES: number;
export const CONTENT_BUDGET_CASES: readonly ContentBudgetCase[];
export function budgetCase(id: string): ContentBudgetCase | undefined;
export function contentBudgetResults(scenario: ContentBudgetCase, count?: number): DeepSeekSearchResult[];
