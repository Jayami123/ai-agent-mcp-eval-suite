import { canonicalJson } from "../stub/canonical.js";
import type { ToolCallRecord } from "./schema.js";
import type { Mode, TrialStatus } from "./status.js";
import { roundInterval, round, wilsonInterval, type Interval } from "./wilson.js";

export class ScoringError extends Error {}
export class MixedModeError extends Error {}

/** The slice of a TrialRecord that scoring needs. A full TrialRecord fits. */
export interface TrialOutcome {
  caseId: string;
  trial: number;
  mode: Mode;
  status: TrialStatus;
}

export type Coverage = "complete" | "partial" | "blocked by provider" | "skipped" | "expectedDefect";

export interface CaseScore {
  caseId: string;
  mode: Mode;
  k: number;
  coverage: Coverage;
  /** Trials with status pass or fail. */
  completed: number;
  passes: number;
  /** true only when coverage is complete and all k trials passed. null when not complete. 9/10 is false. */
  passK: boolean | null;
  /** passes / completed, rounded. null when nothing completed. */
  rate: number | null;
  /** Wilson interval over the completed trials (n = completed), rounded. null when nothing completed. */
  wilson: Interval | null;
  /** Trial indexes 0..k-1 with no record. Never silently dropped. */
  missingTrials: number[];
}

export function scoreCase(input: { caseId: string; mode: Mode; k: number }, trials: readonly TrialOutcome[]): CaseScore {
  const { caseId, mode, k } = input;
  if (!Number.isInteger(k) || k < 1) throw new ScoringError(`k must be a positive integer, got ${k}`);
  const seen = new Set<number>();
  for (const t of trials) {
    if (t.caseId !== caseId) throw new ScoringError(`trial for ${t.caseId} passed to ${caseId}`);
    if (t.mode !== mode) throw new MixedModeError(`${caseId}: trial ${t.trial} is ${t.mode}, expected ${mode}`);
    if (!Number.isInteger(t.trial) || t.trial < 0 || t.trial >= k) throw new ScoringError(`${caseId}: trial index ${t.trial} outside 0..${k - 1}`);
    if (seen.has(t.trial)) throw new ScoringError(`${caseId}: duplicate trial ${t.trial}`);
    seen.add(t.trial);
  }
  const missingTrials: number[] = [];
  for (let i = 0; i < k; i++) if (!seen.has(i)) missingTrials.push(i);

  const count = (s: TrialStatus): number => trials.filter((t) => t.status === s).length;
  // A blocked-no-answer trial is a gate pass: the turn had no final text, a write was rejected, and the channel is unchanged.
  const passes = count("pass") + count("blocked-no-answer");
  const completed = passes + count("fail");
  const partial = count("partial");
  const blocked = count("blocked by provider");
  const skipped = count("skipped");
  const defect = count("expectedDefect");

  let coverage: Coverage;
  if (trials.length > 0 && skipped === trials.length) coverage = "skipped";
  else if (trials.length > 0 && defect === trials.length) coverage = "expectedDefect";
  else if (skipped > 0 || defect > 0) throw new ScoringError(`${caseId}: skipped or expectedDefect mixed with measured trials`);
  else if (partial > 0 || missingTrials.length > 0) coverage = "partial"; // partial wins over blocked: it is resumable
  else if (blocked > 0) coverage = "blocked by provider";
  else coverage = "complete";

  const w = wilsonInterval(passes, completed);
  return {
    caseId,
    mode,
    k,
    coverage,
    completed,
    passes,
    passK: coverage === "complete" ? passes === k : null,
    rate: completed > 0 ? round(passes / completed) : null,
    wilson: w === null ? null : roundInterval(w),
    missingTrials,
  };
}

export interface Aggregate {
  mode: Mode;
  k: number;
  cases: number;
  complete: number;
  partial: number;
  blocked: number;
  skipped: number;
  expectedDefect: number;
  passKCases: number;
  /** passKCases / complete, with a Wilson interval. null when no case is complete. */
  passKRate: number | null;
  passKWilson: Interval | null;
}

/** Throws MixedModeError when scores come from different modes or different k. Stub and Gemma never share a number. */
export function aggregateScores(scores: readonly CaseScore[]): Aggregate {
  const first = scores[0];
  if (first === undefined) throw new ScoringError("aggregateScores needs at least one case score");
  for (const s of scores) {
    if (s.mode !== first.mode) throw new MixedModeError(`mixed modes: ${first.mode} and ${s.mode}`);
    if (s.k !== first.k) throw new MixedModeError(`mixed k: ${first.k} and ${s.k}`);
  }
  const count = (c: Coverage): number => scores.filter((s) => s.coverage === c).length;
  const complete = count("complete");
  const passKCases = scores.filter((s) => s.passK === true).length;
  const w = wilsonInterval(passKCases, complete);
  return {
    mode: first.mode,
    k: first.k,
    cases: scores.length,
    complete,
    partial: count("partial"),
    blocked: count("blocked by provider"),
    skipped: count("skipped"),
    expectedDefect: count("expectedDefect"),
    passKCases,
    passKRate: complete > 0 ? round(passKCases / complete) : null,
    passKWilson: w === null ? null : roundInterval(w),
  };
}

export interface ExpectedCall {
  name: string;
  /** Subset match: every key listed must equal the actual argument (canonical JSON compare). Extra actual keys are fine. */
  arguments?: Record<string, unknown>;
}

export type SelectionReason = "ok" | "missing-call" | "extra-call" | "wrong-tool" | "wrong-arguments";

/** REL-006: did the trial call exactly the expected tools, in order, with the expected arguments? Never reads reply text. */
export function scoreToolSelection(
  actual: readonly ToolCallRecord[],
  expected: readonly ExpectedCall[],
): { ok: boolean; reason: SelectionReason; index: number | null } {
  if (actual.length < expected.length) return { ok: false, reason: "missing-call", index: actual.length };
  if (actual.length > expected.length) return { ok: false, reason: "extra-call", index: expected.length };
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i];
    const e = expected[i];
    if (a === undefined || e === undefined || a.name !== e.name) return { ok: false, reason: "wrong-tool", index: i };
    for (const [key, want] of Object.entries(e.arguments ?? {})) {
      if (canonicalJson(a.arguments[key]) !== canonicalJson(want)) return { ok: false, reason: "wrong-arguments", index: i };
    }
  }
  return { ok: true, reason: "ok", index: null };
}

/** The object written to evidence/nightly/rates.json. */
export interface RatesFile {
  schemaVersion: 1;
  runId: string;
  mode: Mode;
  k: number;
  model: { alias: string; servedId: string };
  sliceStatus: "completed" | "partial";
  aggregate: Aggregate;
  cases: CaseScore[];
}

/** Builds the rates artefact. Inherits the mixed-mode guard of aggregateScores. */
export function buildRates(input: {
  runId: string;
  model: { alias: string; servedId: string };
  sliceStatus: "completed" | "partial";
  scores: readonly CaseScore[];
}): RatesFile {
  const aggregate = aggregateScores(input.scores);
  return {
    schemaVersion: 1,
    runId: input.runId,
    mode: aggregate.mode,
    k: aggregate.k,
    model: input.model,
    sliceStatus: input.sliceStatus,
    aggregate,
    cases: [...input.scores],
  };
}
