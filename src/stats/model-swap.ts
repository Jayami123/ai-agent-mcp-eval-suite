import { APPROVED_MODELS, isApprovedModel } from "./config.js";
import { MixedModeError, scoreCase } from "./passk.js";
import { pairedDelta, type Pair, type PairedDelta } from "./paired.js";
import type { TrialRecord } from "./schema.js";

export interface ModelSwapResult {
  /** skipped: candidate not approved. dry-run: candidate and baseline are the same model (plumbing check). informational: two approved models compared. */
  decision: "skipped" | "dry-run" | "informational";
  /** Always false until the owner approves a second model and a later PR changes this on purpose. */
  blocking: false;
  reason: string;
  /** Attack success rate delta, paired on (caseId, trial). Security records only. */
  asr: PairedDelta | null;
  /** pass^k delta, paired on caseId, over cases complete in both sets. */
  passK: PairedDelta | null;
  pairedTrials: number;
  pairedCases: number;
  /** Keys present in one set only. Listed, never dropped silently. */
  unpaired: string[];
}

/**
 * Compares recorded baseline and candidate trials. Pure: it reads only the two arrays and never calls any model or network.
 * Throws MixedModeError when the sets are not both in the same mode. Throws when one set holds more than one served model id.
 */
export function modelSwapGate(input: {
  baseline: readonly TrialRecord[];
  candidate: readonly TrialRecord[];
  approvedModels?: readonly string[];
}): ModelSwapResult {
  const approved = input.approvedModels ?? APPROVED_MODELS;
  const base = input.baseline;
  const cand = input.candidate;
  const baseId = singleModelId(base, "baseline");
  const candId = singleModelId(cand, "candidate");
  const modes = new Set([...base, ...cand].map((r) => r.mode));
  if (modes.size > 1) throw new MixedModeError(`baseline and candidate modes differ: ${[...modes].join(", ")}`);
  const empty = { asr: null, passK: null, pairedTrials: 0, pairedCases: 0, unpaired: [] as string[], blocking: false as const };

  if (!isApprovedModel(candId, approved)) {
    return { ...empty, decision: "skipped", reason: `candidate model ${candId} is not approved: a second model is an owner decision` };
  }
  const decision = baseId === candId ? "dry-run" : "informational";

  // ASR, paired on (caseId, trial), security records only.
  const asr = (rs: readonly TrialRecord[]): Map<string, boolean> => {
    const m = new Map<string, boolean>();
    for (const r of rs) if (r.attackSucceeded !== undefined) m.set(`${r.caseId}#${r.trial}`, r.attackSucceeded);
    return m;
  };
  const unpaired: string[] = [];
  const asrPairs = pairMaps(asr(cand), asr(base), unpaired);

  // pass^k, paired on caseId, over cases complete in both sets.
  const passKs = (rs: readonly TrialRecord[]): Map<string, boolean> => {
    const m = new Map<string, boolean>();
    for (const id of new Set(rs.map((r) => r.caseId))) {
      const mine = rs.filter((r) => r.caseId === id);
      const first = mine[0];
      if (first === undefined) continue;
      const score = scoreCase({ caseId: id, mode: first.mode, k: first.k }, mine);
      if (score.passK !== null) m.set(id, score.passK);
    }
    return m;
  };
  const passPairs = pairMaps(passKs(cand), passKs(base), unpaired);

  return {
    decision,
    blocking: false,
    reason: decision === "dry-run" ? "same model on both sides: plumbing check on recorded fixtures" : "two approved models compared; informational only",
    asr: pairedDelta(asrPairs),
    passK: pairedDelta(passPairs),
    pairedTrials: asrPairs.length,
    pairedCases: passPairs.length,
    unpaired,
  };
}

function singleModelId(rs: readonly TrialRecord[], label: string): string {
  const ids = new Set(rs.filter((r) => r.model.servedId !== "").map((r) => r.model.servedId));
  if (ids.size !== 1) throw new RangeError(`${label} must hold exactly one served model id, found ${ids.size}`);
  return [...ids][0] as string;
}

/** Pairs two keyed maps. Keys on one side only are added to `unpaired` (prefixed by side), never dropped silently. */
function pairMaps(candidate: Map<string, boolean>, baseline: Map<string, boolean>, unpaired: string[]): Pair[] {
  const pairs: Pair[] = [];
  for (const [key, c] of candidate) {
    const b = baseline.get(key);
    if (b === undefined) unpaired.push(`candidate-only:${key}`);
    else pairs.push({ candidate: c, baseline: b });
  }
  for (const key of baseline.keys()) if (!candidate.has(key)) unpaired.push(`baseline-only:${key}`);
  return pairs;
}
