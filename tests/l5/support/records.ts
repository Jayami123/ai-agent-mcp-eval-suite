import type { TrialRecord } from "../../../src/stats/index.js";
import type { TrialStatus } from "../../../src/stats/index.js";

export const SHA_A = "a".repeat(64);
export const SHA_B = "b".repeat(64);

/** A valid stub-mode record. Override any field. */
export function trial(over: Partial<TrialRecord> = {}): TrialRecord {
  return {
    schemaVersion: 1,
    caseId: "P4-MCP-REL-006",
    trial: 0,
    k: 10,
    mode: "stub",
    host: "stub",
    status: "pass",
    reason: "",
    model: { alias: "p4-stub", servedId: "p4-stub" },
    promptSha256: SHA_A,
    toolCalls: [{ name: "search_records", arguments: { query: "fake-alpha", limit: 5 } }],
    approvals: [],
    snapshots: [],
    usage: { promptTokens: 0, completionTokens: 0, latencyMs: 1 },
    servers: [],
    ...over,
  };
}

/** Records numbered from 0 in the order of the counts keys: trials("P4-X-001", 10, { pass: 9, fail: 1 }). `over` applies to all. */
export function trials(
  caseId: string,
  k: number,
  counts: Partial<Record<TrialStatus, number>>,
  over: Partial<TrialRecord> = {},
): TrialRecord[] {
  const out: TrialRecord[] = [];
  for (const [status, n] of Object.entries(counts) as Array<[TrialStatus, number]>) {
    for (let i = 0; i < n; i++) out.push(trial({ caseId, k, trial: out.length, status, ...over }));
  }
  return out;
}
