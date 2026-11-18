import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTraceDeterminism, trialFromStubEntries, validateTrial } from "../../src/stats/index.js";
import { SHA_A, trial } from "./support/records.js";
import { runFixtureOnce, startStub } from "./support/stub.js";

// P4-STAT-001. Oracle (ledger): k repeated stub runs produce byte-identical tool-call traces for a fixed fixture.
// Any difference fails the PR gate. The raw-HTTP proof is tests/l1/stub-determinism.test.ts; this closes the case at record level.
const K = 5;

test("P4-STAT-001: k = 5 runs of smoke-search-001 through the in-process stub give byte-identical tool_calls", async () => {
  const stub = await startStub();
  try {
    const records = [];
    for (let i = 0; i < K; i++) {
      const run = await runFixtureOnce(stub.port, "smoke-search-001");
      records.push(
        trialFromStubEntries(run.entries, { caseId: "P4-STAT-001", trial: i, k: K, promptSha256: SHA_A, servedModelId: run.servedModelId, latencyMs: run.latencyMs }),
      );
    }
    assert.deepEqual(checkTraceDeterminism(records), { identical: true, trials: K, firstDifference: null });
    for (const r of records) assert.equal(validateTrial(r, "l1").ok, true);
    assert.equal(records[0]?.toolCalls[0]?.name, "search_records");
  } finally {
    await stub.close();
  }
});

const five = (mutate?: (i: number) => Record<string, unknown>) =>
  Array.from({ length: K }, (_, i) => trial({ caseId: "P4-STAT-001", k: K, trial: i, toolCalls: [{ name: "t", arguments: mutate ? mutate(i) : { a: 1, b: 2 } }] }));

test("P4-STAT-001: one differing argument fails the gate and names the trial", () => {
  const r = checkTraceDeterminism(five((i) => ({ a: 1, b: i === 3 ? 99 : 2 })));
  assert.equal(r.identical, false);
  assert.equal(r.firstDifference, 3);
});

test("P4-STAT-001: key order does not matter, values do", () => {
  assert.equal(checkTraceDeterminism(five((i) => (i % 2 === 0 ? { a: 1, b: 2 } : { b: 2, a: 1 }))).identical, true);
});

test("P4-STAT-001: fewer than 2 records, mixed cases or mixed modes throw", () => {
  assert.throws(() => checkTraceDeterminism([trial()]), RangeError);
  assert.throws(() => checkTraceDeterminism([trial(), trial({ caseId: "P4-STAT-002", trial: 1 })]), RangeError);
  assert.throws(() => checkTraceDeterminism([trial(), trial({ mode: "nightly", trial: 1 })]), RangeError);
});
