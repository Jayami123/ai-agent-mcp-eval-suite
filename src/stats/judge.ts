import { HOLDOUT_MIN_ITEMS, KAPPA_MIN, ORDER_SWAP_MAX_FLIP_RATE } from "./thresholds.js";
import { round } from "./wilson.js";

export interface LabelPair {
  human: string;
  judge: string;
}

/** Cohen's kappa for two raters over any set of labels. null when undefined (no items, or both raters used one identical label). */
export function cohensKappa(pairs: readonly LabelPair[]): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const human = new Map<string, number>();
  const judge = new Map<string, number>();
  let agree = 0;
  for (const p of pairs) {
    if (p.human === p.judge) agree++;
    human.set(p.human, (human.get(p.human) ?? 0) + 1);
    judge.set(p.judge, (judge.get(p.judge) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const label of new Set([...human.keys(), ...judge.keys()])) {
    pe += ((human.get(label) ?? 0) / n) * ((judge.get(label) ?? 0) / n);
  }
  if (pe === 1) return null;
  return (po - pe) / (1 - pe);
}

/** What the calibration run stores. The artefact is written by the nightly script to evidence/judge/calibration.json. */
export interface CalibrationArtefact {
  schemaVersion: 1;
  kappa: number | null;
  items: number;
  threshold: number;
  holdoutSha256: string;
  promptSha256: string;
  judgeModelId: string;
}

export interface CalibrationDecision {
  usable: boolean;
  reason: string;
}

/** The judge may be used as a gate only if kappa >= threshold on at least HOLDOUT_MIN_ITEMS labelled items. Default is NOT usable. */
export function evaluateCalibration(
  pairs: readonly LabelPair[],
  ids: { holdoutSha256: string; promptSha256: string; judgeModelId: string },
  opts: { threshold?: number; minItems?: number } = {},
): { decision: CalibrationDecision; artefact: CalibrationArtefact } {
  const threshold = opts.threshold ?? KAPPA_MIN;
  const minItems = opts.minItems ?? HOLDOUT_MIN_ITEMS;
  const raw = cohensKappa(pairs);
  // Compare the rounded value so float noise cannot decide a gate (the [[8,2],[2,8]] table is 0.6000000000000001).
  const kappa = raw === null ? null : round(raw);
  const artefact: CalibrationArtefact = {
    schemaVersion: 1,
    kappa,
    items: pairs.length,
    threshold,
    holdoutSha256: ids.holdoutSha256,
    promptSha256: ids.promptSha256,
    judgeModelId: ids.judgeModelId,
  };
  return { decision: decide(artefact, minItems), artefact };
}

/** The judge is usable only with a stored calibration whose fingerprints match what is about to run. No artefact means not usable. */
export function judgeGate(
  artefact: CalibrationArtefact | null,
  current: { holdoutSha256: string; promptSha256: string; judgeModelId: string },
  opts: { threshold?: number; minItems?: number } = {},
): CalibrationDecision {
  if (artefact === null) return { usable: false, reason: "no calibration artefact" };
  if (needsRecalibration(artefact, current) || artefact.holdoutSha256 !== current.holdoutSha256) {
    return { usable: false, reason: "judge prompt, model or hold-out changed: recalibrate" };
  }
  return decide({ ...artefact, threshold: opts.threshold ?? artefact.threshold }, opts.minItems ?? HOLDOUT_MIN_ITEMS);
}

function decide(a: CalibrationArtefact, minItems: number): CalibrationDecision {
  if (a.kappa === null) return { usable: false, reason: "kappa is undefined for this hold-out" };
  if (a.items < minItems) return { usable: false, reason: `only ${a.items} labelled items, need at least ${minItems}` };
  if (a.kappa < a.threshold) return { usable: false, reason: `kappa ${a.kappa} is below the threshold ${a.threshold}` };
  return { usable: true, reason: `kappa ${a.kappa} >= ${a.threshold} on ${a.items} items` };
}

/** True when the judge prompt or the judge model differs from the calibrated one. STAT-007: recalibrate after a change. */
export function needsRecalibration(
  artefact: Pick<CalibrationArtefact, "promptSha256" | "judgeModelId">,
  current: { promptSha256: string; judgeModelId: string },
): boolean {
  return artefact.promptSha256 !== current.promptSha256 || artefact.judgeModelId !== current.judgeModelId;
}

/** One item judged twice: candidates in order A then B, and again in order B then A. Verdicts name the winner: "A" or "B" or "tie" by candidate identity, not by position. */
export interface SwapItem {
  id: string;
  forward: string;
  swapped: string;
}

export interface OrderSwapResult {
  status: "not-used" | "stable" | "unstable";
  items: number;
  flips: number;
  flipRate: number | null;
  flippedIds: string[];
}

/** Share of items whose verdict changes when the candidate order is swapped. Zero items means the judge is not used: status "not-used", which passes. */
export function orderSwapStability(items: readonly SwapItem[], maxFlipRate: number = ORDER_SWAP_MAX_FLIP_RATE): OrderSwapResult {
  if (items.length === 0) return { status: "not-used", items: 0, flips: 0, flipRate: null, flippedIds: [] };
  const flipped = items.filter((i) => i.forward !== i.swapped);
  const flipRate = round(flipped.length / items.length);
  return {
    status: flipRate <= maxFlipRate ? "stable" : "unstable",
    items: items.length,
    flips: flipped.length,
    flipRate,
    flippedIds: flipped.map((i) => i.id),
  };
}
