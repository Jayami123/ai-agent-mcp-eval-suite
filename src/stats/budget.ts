import { BUDGET } from "./thresholds.js";
import type { TrialRecord } from "./schema.js";

export interface Budget {
  tokensPerTrial: number;
  latencyMsPerTrial: number;
}

export interface CaseBudgetRow {
  caseId: string;
  trials: number;
  tokensTotal: number;
  tokensMax: number;
  latencyMsP50: number;
  latencyMsMax: number;
  modelIds: string[];
  overBudget: boolean;
  /** Plain sentences, for example "tokens 14000 over 12000". An annotation, never a failure. */
  annotations: string[];
}

export interface BudgetReport {
  rows: CaseBudgetRow[];
  recordsIn: number;
  /** Invariant: sum of rows[].trials + missingUsage.length === recordsIn. Nothing disappears. */
  missingUsage: string[];
}

/** Nearest-rank percentile of an ascending list. p in (0, 100]. Empty list returns 0. */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  return sortedAscending[Math.max(0, rank - 1)] ?? 0;
}

/** One row per case: tokens, latency and model ids. Over budget is an annotation. A record with unusable usage is listed in missingUsage, not dropped. */
export function budgetReport(records: readonly TrialRecord[], budget: Budget = BUDGET): BudgetReport {
  const groups = new Map<string, TrialRecord[]>();
  for (const r of records) groups.set(r.caseId, [...(groups.get(r.caseId) ?? []), r]);
  const usable = (r: TrialRecord): boolean =>
    [r.usage?.promptTokens, r.usage?.completionTokens, r.usage?.latencyMs].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
  const missingUsage: string[] = [];
  const rows: CaseBudgetRow[] = [];
  for (const [caseId, rs] of groups) {
    const good = rs.filter(usable);
    for (const r of rs) if (!usable(r)) missingUsage.push(`${r.caseId}#${r.trial}`);
    if (good.length === 0) continue;
    const tokens = good.map((r) => r.usage.promptTokens + r.usage.completionTokens);
    const latency = good.map((r) => r.usage.latencyMs).sort((a, b) => a - b);
    const tokensMax = Math.max(...tokens);
    const latencyMsMax = Math.max(...latency);
    const annotations: string[] = [];
    if (tokensMax > budget.tokensPerTrial) annotations.push(`tokens ${tokensMax} over ${budget.tokensPerTrial}`);
    if (latencyMsMax > budget.latencyMsPerTrial) annotations.push(`latency ${latencyMsMax} ms over ${budget.latencyMsPerTrial} ms`);
    rows.push({
      caseId,
      trials: good.length,
      tokensTotal: tokens.reduce((a, b) => a + b, 0),
      tokensMax,
      latencyMsP50: percentile(latency, 50),
      latencyMsMax,
      modelIds: [...new Set(good.map((r) => r.model.servedId).filter((id) => id !== ""))].sort(),
      overBudget: annotations.length > 0,
      annotations,
    });
  }
  return { rows, recordsIn: records.length, missingUsage };
}
