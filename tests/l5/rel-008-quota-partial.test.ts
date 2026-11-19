import { test } from "node:test";
import assert from "node:assert/strict";
import { runSlice, validateTrial } from "../../src/stats/index.js";
import { fakeDeps } from "./support/records.js";

// P4-MCP-REL-008. Oracle (ledger): a synthetic 429 or a real quota stop marks the remaining trials partial in the artefact.
// The job is not a hard fail. Already-finished trials keep their results.
const input = { runId: "r1", mode: "stub", k: 2, planned: ["P4-MCP-REL-006", "P4-STAT-004"], measured: new Set<string>() } as const;

test("P4-MCP-REL-008: a synthetic 429 marks the remaining trials partial in the artefact", async () => {
  const r = await runSlice(input, fakeDeps(["pass", "quota"]).deps);
  assert.deepEqual(r.records.map((x) => x.status), ["pass", "partial", "partial", "partial"]);
  for (const rec of r.records) assert.equal(validateTrial(rec, "l1").ok, true);
});

test("P4-MCP-REL-008: the job is not a hard fail", async () => {
  const r = await runSlice(input, fakeDeps(["quota"]).deps);
  assert.equal(r.jobVerdict, "green-partial");
  assert.equal(r.sliceStatus, "partial");
});

test("P4-MCP-REL-008: already finished trials keep their results", async () => {
  const r = await runSlice(input, fakeDeps(["pass", "fail", "quota"]).deps);
  assert.deepEqual(r.records.slice(0, 2).map((x) => x.status), ["pass", "fail"]);
});

test("P4-MCP-REL-008: a plain error from the runner is not turned into partial", async () => {
  await assert.rejects(runSlice(input, fakeDeps(["boom"]).deps), /boom/);
});
