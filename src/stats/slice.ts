import { canonicalJson } from "../stub/canonical.js";
import type { TrialRecord } from "./schema.js";
import type { Mode } from "./status.js";
import type { Throttle } from "./throttle.js";

/** Thrown by the trial runner when a 429 or RESOURCE_EXHAUSTED is still there after every retry. */
export class QuotaExhaustedError extends Error {}
export class CursorMismatchError extends Error {}
export class DuplicateTrialError extends Error {}

export interface ResumeCursor {
  schemaVersion: 1;
  runId: string;
  mode: Mode;
  k: number;
  planned: readonly string[];
  /** Index into the unit list (planned case 0 trials 0..k-1, then case 1, ...). The next unit to run. */
  nextIndex: number;
  stoppedBecause: "complete" | "quota";
}

export interface SliceInput {
  runId: string;
  mode: Mode;
  k: number;
  planned: readonly string[];
  /** Measured cases: a failed trial there is a measured result, not a failed gate. */
  measured: ReadonlySet<string>;
  resume?: ResumeCursor;
}

export interface SliceDeps {
  /** Runs one isolated trial. Returns a record (status pass, fail or blocked by provider) or throws QuotaExhaustedError. */
  runTrial(caseId: string, trial: number): Promise<TrialRecord>;
  throttle: Throttle;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  /** Builds the record written for a trial that never ran: status partial, empty served id, zero usage. */
  partialRecord(caseId: string, trial: number): TrialRecord;
}

export interface SliceResult {
  /** Only the trials handled in this call, including partial placeholders. Merge with earlier records using mergeRecords. */
  records: TrialRecord[];
  cursor: ResumeCursor;
  sliceStatus: "completed" | "partial";
  /** green: finished. green-partial: stopped on quota, which is not a fail. red: a completed trial of a non-measured case failed. */
  jobVerdict: "green" | "green-partial" | "red";
}

export function unitsOf(planned: readonly string[], k: number): Array<{ caseId: string; trial: number }> {
  return planned.flatMap((caseId) => Array.from({ length: k }, (_, trial) => ({ caseId, trial })));
}

/**
 * Runs the planned trials one at a time, throttled. On QuotaExhaustedError it stops, writes a partial placeholder for the
 * failing trial and every trial after it, and points the cursor at the failing trial. Finished trials are kept. Any other
 * error is not caught: a real failure is not partial.
 */
export async function runSlice(input: SliceInput, deps: SliceDeps): Promise<SliceResult> {
  const units = unitsOf(input.planned, input.k);
  if (input.resume !== undefined) assertCursorMatches(input.resume, input, units.length);
  const start = input.resume?.nextIndex ?? 0;
  const records: TrialRecord[] = [];
  let stoppedAt: number | null = null;
  for (let i = start; i < units.length; i++) {
    const unit = units[i];
    if (unit === undefined) break;
    await deps.sleep(deps.throttle.waitMs(deps.nowMs()));
    try {
      const record = await deps.runTrial(unit.caseId, unit.trial);
      deps.throttle.record(record.usage.promptTokens + record.usage.completionTokens, deps.nowMs());
      records.push(record);
    } catch (err) {
      if (!(err instanceof QuotaExhaustedError)) throw err; // a real failure is not partial
      stoppedAt = i;
      for (let j = i; j < units.length; j++) {
        const rest = units[j];
        if (rest !== undefined) records.push(deps.partialRecord(rest.caseId, rest.trial));
      }
      break;
    }
  }
  const quota = stoppedAt !== null;
  const cursor: ResumeCursor = {
    schemaVersion: 1,
    runId: input.runId,
    mode: input.mode,
    k: input.k,
    planned: [...input.planned],
    nextIndex: stoppedAt ?? units.length,
    stoppedBecause: quota ? "quota" : "complete",
  };
  const red = records.some((r) => r.status === "fail" && !input.measured.has(r.caseId));
  return { records, cursor, sliceStatus: quota ? "partial" : "completed", jobVerdict: red ? "red" : quota ? "green-partial" : "green" };
}

/** Stable JSON (sorted keys) plus a newline, so the cursor file diff is clean. */
export function serializeCursor(c: ResumeCursor): string {
  return `${canonicalJson(c)}\n`;
}

/** Parses a cursor and refuses it unless mode, k and the planned list match this run. Resuming with another k or mode would mix numbers. */
export function parseCursor(text: string, expect: { mode: Mode; k: number; planned: readonly string[] }): ResumeCursor {
  const raw = JSON.parse(text) as Partial<ResumeCursor>;
  const total = expect.planned.length * expect.k;
  if (raw.schemaVersion !== 1 || !Number.isInteger(raw.nextIndex) || (raw.nextIndex as number) < 0 || (raw.nextIndex as number) > total) {
    throw new CursorMismatchError("cursor: bad schemaVersion or nextIndex");
  }
  const cursor = raw as ResumeCursor;
  assertCursorMatches(cursor, expect, total);
  return cursor;
}

/** Combines earlier and new records. A finished record replaces a partial placeholder for the same (caseId, trial). Two finished records for one key throw. */
export function mergeRecords(previous: readonly TrialRecord[], next: readonly TrialRecord[]): TrialRecord[] {
  const key = (r: TrialRecord): string => `${r.caseId}#${r.trial}`;
  const byKey = new Map<string, TrialRecord>();
  const order: string[] = [];
  for (const r of [...previous, ...next]) {
    const k = key(r);
    const existing = byKey.get(k);
    if (existing === undefined) {
      order.push(k);
      byKey.set(k, r);
    } else if (existing.status === "partial") {
      byKey.set(k, r);
    } else if (r.status !== "partial") {
      throw new DuplicateTrialError(`two finished records for ${k}`);
    }
  }
  const caseOrder = [...new Set(order.map((k) => (byKey.get(k) as TrialRecord).caseId))];
  return order
    .map((k) => byKey.get(k) as TrialRecord)
    .sort((a, b) => caseOrder.indexOf(a.caseId) - caseOrder.indexOf(b.caseId) || a.trial - b.trial);
}

function assertCursorMatches(c: ResumeCursor, expect: { mode: Mode; k: number; planned: readonly string[] }, total: number): void {
  if (c.mode !== expect.mode) throw new CursorMismatchError(`cursor mode ${c.mode} does not match ${expect.mode}`);
  if (c.k !== expect.k) throw new CursorMismatchError(`cursor k ${c.k} does not match ${expect.k}`);
  if (canonicalJson(c.planned) !== canonicalJson(expect.planned)) throw new CursorMismatchError("cursor planned case list does not match");
  if (c.nextIndex > total) throw new CursorMismatchError("cursor nextIndex is past the end of the plan");
}
