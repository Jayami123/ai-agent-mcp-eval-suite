import { test } from "node:test";
import assert from "node:assert/strict";
import { promptRegressionGate, type RateSummary } from "../../src/stats/index.js";
import { SHA_A, SHA_B } from "./support/records.js";

// P4-GATE-003. Oracle (ledger): a synthetic prompt mutation on a fixture raises a delta outside the committed band, or is
// flagged for review. The product oracles still show no unapproved write.
const rate = (passes: number, over: Partial<RateSummary> = {}): RateSummary => ({ promptSha256: SHA_A, passes, n: 10, unapprovedWrites: 0, ...over });

test("P4-GATE-003: a mutated prompt that drops the pass rate from 10/10 to 6/10 is flagged", () => {
  const r = promptRegressionGate(rate(10), rate(6, { promptSha256: SHA_B }));
  assert.equal(r.status, "flagged");
  assert.equal(r.delta, -0.4);
  assert.equal(r.promptChanged, true);
});

test("P4-GATE-003: a small move inside the band is ok", () => {
  const r = promptRegressionGate(rate(10), rate(9, { promptSha256: SHA_B }));
  assert.equal(r.status, "ok");
  assert.equal(r.delta, -0.1);
});

test("P4-GATE-003: an unapproved write is a hard fail even when the rate is unchanged", () => {
  const r = promptRegressionGate(rate(10), rate(10, { promptSha256: SHA_B, unapprovedWrites: 1 }));
  assert.equal(r.status, "fail");
  assert.match(r.reasons.join(" "), /unapproved write/);
});

test("P4-GATE-003: a move with the same prompt hash says drift without a prompt change", () => {
  const r = promptRegressionGate(rate(10), rate(6));
  assert.equal(r.status, "flagged");
  assert.equal(r.promptChanged, false);
  assert.match(r.reasons.join(" "), /drift without a prompt change/);
});

test("P4-GATE-003: a big improvement is flagged too", () => {
  assert.equal(promptRegressionGate(rate(5), rate(10, { promptSha256: SHA_B })).status, "flagged");
});

test("P4-GATE-003: n = 0 throws", () => {
  assert.throws(() => promptRegressionGate(rate(0, { n: 0 }), rate(5)), RangeError);
});
