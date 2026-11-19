import { test } from "node:test";
import assert from "node:assert/strict";
import { DuplicateTrialError, GOLDEN_SET, mergeRecords, parseCaseId, runSlice, scoreCase } from "../../src/stats/index.js";
import { fakeDeps, trial } from "./support/records.js";

// P4-GATE-001. Oracle (ledger): the committed golden-set nightly slice either finishes with published rates or stops on
// quota with status partial. Already-finished trials are kept.
const planned = ["P4-STAT-003", "P4-STAT-004", "P4-MCP-REL-006"];
const base = { runId: "r1", mode: "stub", k: 2, planned, measured: new Set<string>() } as const;

test("P4-GATE-001: GOLDEN_SET is non-empty, unique and every id is well formed", () => {
  assert.ok(GOLDEN_SET.length > 0);
  assert.equal(new Set(GOLDEN_SET).size, GOLDEN_SET.length);
  for (const id of GOLDEN_SET) assert.notEqual(parseCaseId(id), null, id);
});

test("P4-GATE-001: a slice that finishes is completed and green, and the cursor says complete", async () => {
  const { deps } = fakeDeps([]);
  const r = await runSlice(base, deps);
  assert.equal(r.sliceStatus, "completed");
  assert.equal(r.jobVerdict, "green");
  assert.equal(r.records.length, 6);
  assert.deepEqual([r.cursor.stoppedBecause, r.cursor.nextIndex], ["complete", 6]);
});

test("P4-GATE-001: a slice that hits quota is partial and green-partial, and finished trials keep their results", async () => {
  const { deps } = fakeDeps(["pass", "pass", "pass", "quota"]);
  const r = await runSlice(base, deps);
  assert.equal(r.sliceStatus, "partial");
  assert.equal(r.jobVerdict, "green-partial");
  assert.deepEqual(r.records.map((x) => x.status), ["pass", "pass", "pass", "partial", "partial", "partial"]);
  assert.equal(r.cursor.nextIndex, 3);
});

test("P4-GATE-001: resuming from the cursor runs only the remaining trials and mergeRecords gives a complete set", async () => {
  const first = await runSlice(base, fakeDeps(["pass", "pass", "pass", "quota"]).deps);
  const second = fakeDeps([]);
  const resumed = await runSlice({ ...base, resume: first.cursor }, second.deps);
  assert.equal(resumed.records.length, 3);
  assert.deepEqual(second.calls, ["P4-STAT-004#1", "P4-MCP-REL-006#0", "P4-MCP-REL-006#1"]);
  const merged = mergeRecords(first.records, resumed.records);
  assert.equal(merged.length, 6);
  for (const id of planned) {
    const score = scoreCase({ caseId: id, mode: "stub", k: 2 }, merged.filter((m) => m.caseId === id));
    assert.equal(score.coverage, "complete", id);
  }
});

test("P4-GATE-001: mergeRecords throws on two finished records for one trial", () => {
  assert.throws(() => mergeRecords([trial()], [trial()]), DuplicateTrialError);
});
