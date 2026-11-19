import { CASE_ID_PATTERN } from "./case-ids.js";
import { MAX_QUARANTINE_DAYS } from "./thresholds.js";
import type { TrialStatus } from "./status.js";

export interface QuarantineEntry {
  caseId: string;
  reason: string;
  /** ISO date YYYY-MM-DD the case was quarantined. */
  since: string;
  /** ISO date after which the entry no longer protects the case. null needs a named reviewer. */
  expires: string | null;
  /** A role such as "owner", never a personal name. Required when expires is null. */
  reviewer: string | null;
}

export type Trigger = "pull_request" | "push" | "schedule" | "workflow_dispatch";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days from a to b for two ISO dates, using UTC so time zones cannot move the answer. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Problems with the list as written. [] means valid. `today` is passed in: this module never reads the clock. */
export function validateQuarantine(entries: readonly QuarantineEntry[], today: string, maxDays: number = MAX_QUARANTINE_DAYS): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const tag = e.caseId;
    if (!CASE_ID_PATTERN.test(e.caseId)) errors.push(`${tag}: bad case id`);
    if (e.reason.trim() === "") errors.push(`${tag}: reason is empty`);
    if (seen.has(e.caseId)) errors.push(`${tag}: duplicate entry`);
    seen.add(e.caseId);
    if (!ISO_DATE.test(e.since) || (e.expires !== null && !ISO_DATE.test(e.expires))) {
      errors.push(`${tag}: since or expires is not an ISO date (YYYY-MM-DD)`);
      continue;
    }
    if (e.expires === null) {
      if (e.reviewer === null || e.reviewer.trim() === "") errors.push(`${tag}: no expiry and no named reviewer`);
      continue;
    }
    if (e.expires < e.since) errors.push(`${tag}: expires is before since`);
    else if (daysBetween(e.since, e.expires) > maxDays) errors.push(`${tag}: expires is more than ${maxDays} days after since`);
    if (e.expires < today) errors.push(`${tag}: expired on ${e.expires}: review or remove`);
  }
  return errors;
}

/** An entry protects its case while it has not expired, or forever while it has a named reviewer and no expiry. */
export function activeQuarantine(entries: readonly QuarantineEntry[], today: string): Set<string> {
  const active = new Set<string>();
  for (const e of entries) {
    if (e.expires === null ? e.reviewer !== null && e.reviewer.trim() !== "" : today <= e.expires) active.add(e.caseId);
  }
  return active;
}

export interface RunPlan {
  run: string[];
  skipped: Array<{ caseId: string; reason: string }>;
}

/** Pull request, push and schedule skip quarantined cases and say why. workflow_dispatch runs them. */
export function selectRunnable(caseIds: readonly string[], entries: readonly QuarantineEntry[], today: string, trigger: Trigger): RunPlan {
  if (trigger === "workflow_dispatch") return { run: [...caseIds], skipped: [] };
  const active = activeQuarantine(entries, today);
  const run: string[] = [];
  const skipped: RunPlan["skipped"] = [];
  for (const id of caseIds) {
    const entry = active.has(id) ? entries.find((e) => e.caseId === id) : undefined;
    if (entry === undefined) run.push(id);
    else skipped.push({ caseId: id, reason: `quarantined: ${entry.reason} (until ${entry.expires ?? `reviewed by ${entry.reviewer ?? "?"}`})` });
  }
  return { run, skipped };
}

export interface GateOutcome {
  /** Case ids whose failure counts against the PR gate. */
  gateFailures: string[];
  /** Quarantined cases that failed or were skipped, with the reason. Always shown in the report. */
  quarantinedReport: Array<{ caseId: string; status: TrialStatus; reason: string; expires: string | null }>;
}

/** A quarantined failure does not fail the gate and still appears in the report. An expired entry protects nothing. */
export function applyQuarantineToGate(
  results: ReadonlyArray<{ caseId: string; status: TrialStatus }>,
  entries: readonly QuarantineEntry[],
  today: string,
): GateOutcome {
  const active = activeQuarantine(entries, today);
  const gateFailures: string[] = [];
  const quarantinedReport: GateOutcome["quarantinedReport"] = [];
  for (const r of results) {
    const entry = active.has(r.caseId) ? entries.find((e) => e.caseId === r.caseId) : undefined;
    if (entry !== undefined) quarantinedReport.push({ caseId: r.caseId, status: r.status, reason: entry.reason, expires: entry.expires });
    else if (r.status === "fail") gateFailures.push(r.caseId);
  }
  return { gateFailures, quarantinedReport };
}
