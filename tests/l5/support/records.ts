import { createThrottle, QuotaExhaustedError, type SliceDeps } from "../../../src/stats/index.js";
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

// ---- slice runner fakes ----

export type Scripted = "pass" | "fail" | "blocked" | "quota" | "boom";

/** A runner that follows a script of outcomes, one per trial, and a fake clock that never really waits. */
export function fakeDeps(script: Scripted[], over: { tokens?: number } = {}): { deps: SliceDeps; waits: number[]; calls: string[] } {
  const waits: number[] = [];
  const calls: string[] = [];
  let now = 0;
  let step = 0;
  const deps: SliceDeps = {
    async runTrial(caseId, t) {
      calls.push(`${caseId}#${t}`);
      const outcome = script[step++] ?? "pass";
      if (outcome === "quota") throw new QuotaExhaustedError("429 after retries");
      if (outcome === "boom") throw new Error("boom");
      const status = outcome === "blocked" ? "blocked by provider" : outcome;
      return trial({ caseId, trial: t, k: 2, status, usage: { promptTokens: over.tokens ?? 0, completionTokens: 0, latencyMs: 1 } });
    },
    throttle: createThrottle(),
    nowMs: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    partialRecord: (caseId, t) => trial({ caseId, trial: t, k: 2, status: "partial", model: { alias: "p4-stub", servedId: "" } }),
  };
  return { deps, waits, calls };
}
