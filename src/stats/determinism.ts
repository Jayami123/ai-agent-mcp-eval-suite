import { canonicalJson } from "../stub/canonical.js";
import type { TrialRecord } from "./schema.js";

export interface DeterminismResult {
  identical: boolean;
  trials: number;
  /** Index of the first trial whose tool_calls differ from trial 0. null when identical. */
  firstDifference: number | null;
}

/**
 * All records are repeated runs of one fixed case. Their tool_calls (canonical JSON, byte for byte) must match.
 * Throws when fewer than 2 records or when records belong to different cases or modes.
 */
export function checkTraceDeterminism(records: readonly TrialRecord[]): DeterminismResult {
  const first = records[0];
  if (first === undefined || records.length < 2) throw new RangeError("checkTraceDeterminism needs at least 2 records");
  const reference = canonicalJson(first.toolCalls);
  let firstDifference: number | null = null;
  for (const r of records) {
    if (r.caseId !== first.caseId) throw new RangeError(`mixed cases: ${first.caseId} and ${r.caseId}`);
    if (r.mode !== first.mode) throw new RangeError(`mixed modes: ${first.mode} and ${r.mode}`);
    if (firstDifference === null && canonicalJson(r.toolCalls) !== reference) firstDifference = r.trial;
  }
  return { identical: firstDifference === null, trials: records.length, firstDifference };
}
