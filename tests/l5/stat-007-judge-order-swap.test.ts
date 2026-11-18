import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCalibration, judgeGate, needsRecalibration, orderSwapStability, type SwapItem } from "../../src/stats/index.js";
import { SHA_A, SHA_B } from "./support/records.js";

// P4-STAT-007. Oracle (ledger): swapping candidate order does not change the committed labels beyond the agreed tolerance.
// Re-calibrate after a prompt or model change. When no judge is used the check passes as not-used.
const items = (n: number, flips: number): SwapItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, forward: "A", swapped: i < flips ? "B" : "A" }));

test("P4-STAT-007: no items means the judge is not used and the check passes", () => {
  assert.equal(orderSwapStability([]).status, "not-used");
});

test("P4-STAT-007: identical verdicts after the swap are stable", () => {
  const r = orderSwapStability(items(20, 0));
  assert.equal(r.status, "stable");
  assert.equal(r.flipRate, 0);
});

test("P4-STAT-007: 1 flip in 20 is within the 10% tolerance, 3 in 20 is not and lists the ids", () => {
  assert.equal(orderSwapStability(items(20, 1)).status, "stable");
  const bad = orderSwapStability(items(20, 3));
  assert.equal(bad.status, "unstable");
  assert.equal(bad.flipRate, 0.15);
  assert.deepEqual(bad.flippedIds, ["item-0", "item-1", "item-2"]);
});

test("P4-STAT-007: a changed judge prompt or model id needs recalibration; the same ones do not", () => {
  const a = { promptSha256: SHA_A, judgeModelId: "m1" };
  assert.equal(needsRecalibration(a, { promptSha256: SHA_A, judgeModelId: "m1" }), false);
  assert.equal(needsRecalibration(a, { promptSha256: SHA_B, judgeModelId: "m1" }), true);
  assert.equal(needsRecalibration(a, { promptSha256: SHA_A, judgeModelId: "m2" }), true);
});

test("P4-STAT-007: judgeGate refuses a stored calibration whose fingerprints no longer match", () => {
  const ids = { holdoutSha256: SHA_A, promptSha256: SHA_A, judgeModelId: "m1" };
  const labels = [...Array.from({ length: 10 }, () => ({ human: "pass", judge: "pass" })), ...Array.from({ length: 10 }, () => ({ human: "fail", judge: "fail" }))];
  const { artefact } = evaluateCalibration(labels, ids);
  assert.equal(judgeGate(artefact, ids).usable, true);
  const after = judgeGate(artefact, { ...ids, promptSha256: SHA_B });
  assert.equal(after.usable, false);
  assert.match(after.reason, /recalibrate/);
});
