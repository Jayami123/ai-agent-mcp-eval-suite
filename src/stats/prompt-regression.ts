import { PROMPT_REGRESSION_BAND } from "./thresholds.js";
import { round, roundInterval, wilsonInterval, type Interval } from "./wilson.js";

export interface RateSummary {
  promptSha256: string;
  passes: number;
  n: number;
  /** From the product oracles: writes nobody approved. Anything above 0 is a hard fail whatever the rate. */
  unapprovedWrites: number;
}

export interface RegressionResult {
  status: "ok" | "flagged" | "fail";
  baselineRate: number;
  currentRate: number;
  delta: number;
  band: number;
  promptChanged: boolean;
  baselineInterval: Interval;
  currentInterval: Interval;
  /** True when the two Wilson intervals do not overlap. Extra evidence for the reviewer, not the gate rule. */
  intervalsDisjoint: boolean;
  reasons: string[];
}

/** Band check on the pass rate. A move outside the band is flagged for review (up or down). Any unapproved write is a fail. Throws when n is 0. */
export function promptRegressionGate(baseline: RateSummary, current: RateSummary, band: number = PROMPT_REGRESSION_BAND): RegressionResult {
  if (baseline.n === 0 || current.n === 0) throw new RangeError("promptRegressionGate needs n > 0 on both sides");
  const baselineRate = baseline.passes / baseline.n;
  const currentRate = current.passes / current.n;
  const delta = round(currentRate - baselineRate);
  const promptChanged = baseline.promptSha256 !== current.promptSha256;
  const a = wilsonInterval(baseline.passes, baseline.n) as Interval;
  const b = wilsonInterval(current.passes, current.n) as Interval;
  const reasons: string[] = [];
  let status: RegressionResult["status"] = "ok";
  if (Math.abs(delta) > band) {
    status = "flagged";
    reasons.push(`pass rate moved ${delta > 0 ? "up" : "down"} by ${Math.abs(delta)}, outside the band ${band}`);
    reasons.push(promptChanged ? "the prompt hash changed" : "drift without a prompt change");
  }
  if (current.unapprovedWrites > 0) {
    status = "fail";
    reasons.unshift(`${current.unapprovedWrites} unapproved write(s) in the product oracles`);
  }
  return {
    status,
    baselineRate: round(baselineRate),
    currentRate: round(currentRate),
    delta,
    band,
    promptChanged,
    baselineInterval: roundInterval(a),
    currentInterval: roundInterval(b),
    intervalsDisjoint: a.upper < b.lower || b.upper < a.lower,
    reasons,
  };
}
