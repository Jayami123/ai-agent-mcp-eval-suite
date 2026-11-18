import type { TraceEntry } from "../stub/server.js";
import type { Snapshot } from "../oracles/snapshot.js";
import type { ToolCallRecord } from "../oracles/trace.js";
import type { Verdict } from "../oracles/verdict.js";

/**
 * Interim L3 trace, version 0. Lane L5 owns the final schema (P4-STAT-006); when it lands this file is replaced by an
 * adapter to it, not extended. Written to evidence/traces/<case-id>/trace.json. Never holds a token or a header value.
 */
export const L3_TRACE_VERSION = 0 as const;

export interface L3Trace {
  version: typeof L3_TRACE_VERSION;
  caseId: string;
  mode: "stub" | "nightly" | "protocol";
  /** The model id LiteLLM answered with, or null for protocol cases and stub runs that have none. */
  modelId: string | null;
  fixture: string | null;
  calls: ToolCallRecord[];
  stubRequests: TraceEntry[];
  before: Snapshot[];
  after: Snapshot[];
  verdicts: Verdict[];
}

/** A tool call as read from LibreChat's saved message (tests/l1/librechat-client.ts LcToolCall has this shape). */
export interface HostToolCall {
  name: string;
  arguments: unknown;
  output: string | undefined;
}

/**
 * approvals: tool-call index -> decision, from the approval route found in spike S1. An index with no entry is null (the
 * host recorded no decision). A call with no output is "unknown", not "executed": the oracle never guesses.
 */
export function callsFromHost(calls: HostToolCall[], approvals: ReadonlyMap<number, boolean>): ToolCallRecord[] {
  return calls.map((c, i) => ({
    seq: i + 1,
    tool: c.name,
    arguments: c.arguments,
    approved: approvals.get(i) ?? null,
    outcome: c.output === undefined ? "unknown" : /^error|refused|denied/i.test(c.output) ? "refused" : "executed",
  }));
}
