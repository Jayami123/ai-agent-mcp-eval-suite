import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetReport, percentile, type TrialRecord } from "../../src/stats/index.js";
import { trial } from "./support/records.js";

// P4-GATE-004. Oracle (ledger): each nightly artefact includes tokens, latency and the model id per case. A budget overage
// is a report annotation, not a silent drop of results.
const withUsage = (i: number, prompt: number, completion: number, latencyMs: number, over: Partial<TrialRecord> = {}): TrialRecord =>
  trial({ trial: i, usage: { promptTokens: prompt, completionTokens: completion, latencyMs }, model: { alias: "p4-nightly", servedId: "gemma-4-31b-it" }, mode: "nightly", ...over });

test("P4-GATE-004: each case row carries tokens, latency and the model id", () => {
  const report = budgetReport([withUsage(0, 4000, 100, 1000), withUsage(1, 5000, 200, 3000), withUsage(2, 4500, 100, 2000)]);
  const row = report.rows[0];
  assert.equal(row?.trials, 3);
  assert.equal(row?.tokensTotal, 13_900);
  assert.equal(row?.tokensMax, 5200);
  assert.equal(row?.latencyMsP50, 2000);
  assert.equal(row?.latencyMsMax, 3000);
  assert.deepEqual(row?.modelIds, ["gemma-4-31b-it"]);
  assert.equal(row?.overBudget, false);
});

test("P4-GATE-004: an overage is annotated and is not a failure", () => {
  const report = budgetReport([withUsage(0, 13_000, 500, 130_000)]);
  const row = report.rows[0];
  assert.equal(row?.overBudget, true);
  assert.deepEqual(row?.annotations, ["tokens 13500 over 12000", "latency 130000 ms over 120000 ms"]);
});

test("P4-GATE-004: a record without usable usage is listed in missingUsage and nothing is dropped", () => {
  const bad = withUsage(1, 0, 0, 0, { usage: { promptTokens: Number.NaN, completionTokens: 0, latencyMs: 1 } });
  const report = budgetReport([withUsage(0, 100, 10, 5), bad, withUsage(2, 100, 10, 5)]);
  assert.deepEqual(report.missingUsage, ["P4-MCP-REL-006#1"]);
  assert.equal(report.rows.reduce((n, r) => n + r.trials, 0) + report.missingUsage.length, report.recordsIn);
});

test("P4-GATE-004: rows keep first-seen case order, and percentile uses nearest rank", () => {
  const report = budgetReport([withUsage(0, 1, 1, 1, { caseId: "P4-STAT-004" }), withUsage(0, 1, 1, 1, { caseId: "P4-STAT-003" })]);
  assert.deepEqual(report.rows.map((r) => r.caseId), ["P4-STAT-004", "P4-STAT-003"]);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([], 50), 0);
});
