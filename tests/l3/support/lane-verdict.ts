// The verdict of one measured lane (a case's k trials), from the trial statuses alone. No runner, no product: unit tested.
//
// A lane is conclusive when at least one trial got a model answer (pass or fail). It is inconclusive when there are no trials,
// or every trial is partial (quota, or the provider did not answer). An inconclusive lane never reports pass: the job fails
// with the provider error. Mixed partial and conclusive trials are conclusive; the partial trials stay recorded as partial.
import type { TrialStatus } from "../../../src/stats/status.js";

export type LaneVerdict = "conclusive" | "inconclusive";

export function laneVerdict(statuses: readonly TrialStatus[]): LaneVerdict {
  if (statuses.length === 0) return "inconclusive";
  return statuses.every((s) => s === "partial") ? "inconclusive" : "conclusive";
}
