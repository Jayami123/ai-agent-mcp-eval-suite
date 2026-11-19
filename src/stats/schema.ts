import { TRIAL_STATUSES, type Mode, type TrialStatus } from "./status.js";

export const TRACE_SCHEMA_VERSION = 1 as const;

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
}

/** One approval decision the host recorded. The key must exist even when there were none (empty array). */
export interface ApprovalRecord {
  tool: string;
  decision: "approved" | "denied" | "not-asked";
  argumentsSha256: string;
}

export interface StateSnapshot {
  name: string;
  phase: "before" | "after";
  sha256: string;
}

export interface UsageRecord {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

/** One isolated trial of one case. The same shape serves L1 now and L2 to L4 later. */
export interface TrialRecord {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  caseId: string;
  trial: number;
  k: number;
  mode: Mode;
  /** "stub", "librechat", "openclaw" or a later host. */
  host: string;
  status: TrialStatus;
  reason: string;
  model: { alias: string; servedId: string };
  promptSha256: string;
  toolCalls: ToolCallRecord[];
  approvals: ApprovalRecord[];
  snapshots: StateSnapshot[];
  usage: UsageRecord;
  /** MCP servers or products involved, for the ASR matrix. */
  servers: string[];
  /** Security cases only: did the attack succeed in this trial. */
  attackSucceeded?: boolean;
}

/** "l1": snapshots may be empty (plumbing records). "state": completed trials need a before and an after snapshot. */
export type TraceProfile = "l1" | "state";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const CASE_ID = /^P4-[A-Z]+(?:-[A-Z]+)?-\d{3}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Collects every problem, not just the first. Error texts are stable: tests match on them. */
export function validateTrial(raw: unknown, profile: TraceProfile): ValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["record: not an object"] };
  const r = raw;

  if (r["schemaVersion"] !== TRACE_SCHEMA_VERSION) errors.push("schemaVersion: must be 1");
  const caseId = r["caseId"];
  if (typeof caseId !== "string" || !CASE_ID.test(caseId)) errors.push("caseId: must look like P4-<FAMILY>-<NNN>");
  const k = r["k"];
  const trial = r["trial"];
  if (!Number.isInteger(k) || (k as number) < 1) errors.push("k: positive integer required");
  if (!Number.isInteger(trial) || (trial as number) < 0 || (typeof k === "number" && (trial as number) >= k)) errors.push("trial: integer in 0..k-1 required");
  const mode = r["mode"];
  if (mode !== "stub" && mode !== "nightly") errors.push("mode: must be stub or nightly");
  if (typeof r["host"] !== "string" || r["host"] === "") errors.push("host: non-empty string required");
  const status = r["status"];
  if (typeof status !== "string" || !(TRIAL_STATUSES as readonly string[]).includes(status)) errors.push("status: not a known status");
  if (typeof r["reason"] !== "string") errors.push("reason: string required");
  if (typeof r["promptSha256"] !== "string" || !SHA256.test(r["promptSha256"])) errors.push("promptSha256: 64 hex characters required");

  // The trial reached the model unless it was partial (never ran) or skipped.
  const ran = status !== "partial" && status !== "skipped";

  const model = r["model"];
  if (!isObj(model)) errors.push("model: object {alias, servedId} required");
  else {
    const alias = model["alias"];
    const served = model["servedId"];
    if (typeof alias !== "string" || alias === "") errors.push("model.alias: non-empty string required");
    if (typeof served !== "string") errors.push("model.servedId: string required");
    else if (ran && served === "") errors.push("model.servedId: required (the model id LiteLLM logged)");
    if (mode === "stub" && alias !== "p4-stub") errors.push("model.alias: stub mode must use p4-stub");
    if (mode === "nightly" && alias !== "p4-nightly") errors.push("model.alias: nightly mode must use p4-nightly");
    if (mode === "nightly" && ran && served === "p4-stub") errors.push("model.servedId: a nightly record was answered by the stub");
  }

  const toolCalls = r["toolCalls"];
  if (!Array.isArray(toolCalls)) errors.push("toolCalls: array required");
  else {
    toolCalls.forEach((c: unknown, i: number) => {
      if (!isObj(c) || typeof c["name"] !== "string" || c["name"] === "" || !isObj(c["arguments"])) {
        errors.push(`toolCalls[${i}]: {name non-empty string, arguments object} required`);
      }
    });
  }

  const approvals = r["approvals"];
  if (!Array.isArray(approvals)) errors.push("approvals: array required (empty when none)");
  else {
    approvals.forEach((a: unknown, i: number) => {
      const ok =
        isObj(a) &&
        typeof a["tool"] === "string" &&
        a["tool"] !== "" &&
        (a["decision"] === "approved" || a["decision"] === "denied" || a["decision"] === "not-asked") &&
        typeof a["argumentsSha256"] === "string" &&
        SHA256.test(a["argumentsSha256"]);
      if (!ok) errors.push(`approvals[${i}]: {tool, decision approved|denied|not-asked, argumentsSha256 hex} required`);
    });
  }

  const snapshots = r["snapshots"];
  if (!Array.isArray(snapshots)) errors.push("snapshots: array required");
  else {
    let before = 0;
    let after = 0;
    snapshots.forEach((sn: unknown, i: number) => {
      const ok =
        isObj(sn) &&
        typeof sn["name"] === "string" &&
        sn["name"] !== "" &&
        (sn["phase"] === "before" || sn["phase"] === "after") &&
        typeof sn["sha256"] === "string" &&
        SHA256.test(sn["sha256"]);
      if (!ok) errors.push(`snapshots[${i}]: {name, phase before|after, sha256 hex} required`);
      else if (sn["phase"] === "before") before++;
      else after++;
    });
    if (profile === "state" && ran && (before === 0 || after === 0)) {
      errors.push("snapshots: need at least one before and one after snapshot (profile state)");
    }
  }

  const usage = r["usage"];
  if (!isObj(usage)) errors.push("usage: object {promptTokens, completionTokens, latencyMs} required");
  else {
    for (const field of ["promptTokens", "completionTokens", "latencyMs"]) {
      const v = usage[field];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) errors.push(`usage.${field}: finite number >= 0 required`);
    }
  }

  const servers = r["servers"];
  if (!Array.isArray(servers) || !servers.every((x: unknown) => typeof x === "string")) errors.push("servers: array of strings required");
  if (r["attackSucceeded"] !== undefined && typeof r["attackSucceeded"] !== "boolean") errors.push("attackSucceeded: boolean when present");

  return { ok: errors.length === 0, errors };
}
