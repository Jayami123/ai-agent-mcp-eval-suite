import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateScores, buildRates, MixedModeError, ScoringError, scoreCase } from "../../src/stats/index.js";
import { trials } from "./support/records.js";

// P4-STAT-003. Oracle (ledger): a synthetic set of trial outcomes produces the expected pass^k.
// A 9/10 run is not reported as a pass^k success.
const ID = "P4-MCP-REL-006";
const input = { caseId: ID, mode: "stub", k: 10 } as const;

test("P4-STAT-003: 10 of 10 passes is pass^k true", () => {
  const s = scoreCase(input, trials(ID, 10, { pass: 10 }));
  assert.equal(s.passK, true);
  assert.equal(s.coverage, "complete");
});

test("P4-STAT-003: 9 of 10 is NOT a pass^k success, and the rate and interval are still reported", () => {
  const s = scoreCase(input, trials(ID, 10, { pass: 9, fail: 1 }));
  assert.equal(s.passK, false);
  assert.equal(s.passes, 9);
  assert.equal(s.rate, 0.9);
  assert.deepEqual(s.wilson, { lower: 0.5958, upper: 0.9821 });
});

test("P4-STAT-003: 0 of 10 is pass^k false with a complete coverage", () => {
  const s = scoreCase(input, trials(ID, 10, { fail: 10 }));
  assert.equal(s.passK, false);
  assert.equal(s.coverage, "complete");
});

test("P4-STAT-003: an incomplete case has no pass^k (null), even if every finished trial passed", () => {
  const s = scoreCase(input, trials(ID, 10, { pass: 6, partial: 4 }));
  assert.equal(s.passK, null);
  assert.equal(s.coverage, "partial");
  assert.equal(s.completed, 6);
});

test("P4-STAT-003: missing trial records are listed, never dropped", () => {
  const s = scoreCase(input, trials(ID, 10, { pass: 8 }));
  assert.deepEqual(s.missingTrials, [8, 9]);
  assert.equal(s.coverage, "partial");
});

test("P4-STAT-003: blocked by provider is neither pass nor fail", () => {
  const s = scoreCase(input, trials(ID, 10, { pass: 9, "blocked by provider": 1 }));
  assert.equal(s.coverage, "blocked by provider");
  assert.equal(s.passK, null);
});

test("P4-STAT-003: bad input throws (duplicate trial index, index >= k, k < 1, wrong case id)", () => {
  const dup = [...trials(ID, 2, { pass: 2 }), ...trials(ID, 1, { pass: 1 })];
  assert.throws(() => scoreCase({ ...input, k: 2 }, dup), ScoringError);
  assert.throws(() => scoreCase({ ...input, k: 1 }, trials(ID, 2, { pass: 2 })), ScoringError);
  assert.throws(() => scoreCase({ ...input, k: 0 }, []), ScoringError);
  assert.throws(() => scoreCase(input, trials("P4-STAT-004", 1, { pass: 1 })), ScoringError);
});

test("P4-STAT-003: stub and nightly scores are never aggregated into one number", () => {
  const stub = scoreCase(input, trials(ID, 10, { pass: 10 }));
  const night = scoreCase({ ...input, mode: "nightly" }, trials(ID, 10, { pass: 10 }, { mode: "nightly" }));
  assert.throws(() => aggregateScores([stub, night]), MixedModeError);
});

test("P4-STAT-003: aggregate counts cases by coverage and gives the case-level pass^k rate with an interval", () => {
  const a = scoreCase(input, trials(ID, 10, { pass: 10 }));
  const b = scoreCase({ ...input, caseId: "P4-STAT-004" }, trials("P4-STAT-004", 10, { pass: 9, fail: 1 }));
  const agg = aggregateScores([a, b]);
  assert.equal(agg.cases, 2);
  assert.equal(agg.complete, 2);
  assert.equal(agg.passKCases, 1);
  assert.equal(agg.passKRate, 0.5);
});

test("P4-STAT-003: buildRates carries mode, k, model and the aggregate, and refuses mixed modes", () => {
  const a = scoreCase(input, trials(ID, 10, { pass: 10 }));
  const rates = buildRates({ runId: "r1", model: { alias: "p4-stub", servedId: "p4-stub" }, sliceStatus: "completed", scores: [a] });
  assert.equal(rates.mode, "stub");
  assert.equal(rates.k, 10);
  assert.equal(rates.aggregate.passKCases, 1);
  const n = scoreCase({ ...input, mode: "nightly" }, trials(ID, 10, { pass: 10 }, { mode: "nightly" }));
  assert.throws(() => buildRates({ runId: "r1", model: { alias: "x", servedId: "x" }, sliceStatus: "completed", scores: [a, n] }), MixedModeError);
});
