import { test } from "node:test";
import assert from "node:assert/strict";
import { cohensKappa, evaluateCalibration, judgeGate, round, type LabelPair } from "../../src/stats/index.js";
import { SHA_A, SHA_B } from "./support/records.js";

// P4-STAT-002. Oracle (ledger): the judge is not used as a gate until kappa on the labelled hold-out meets the committed
// threshold. The calibration artefact is stored. Synthetic labels only.
const pairs = (both: number, humanOnly: number, judgeOnly: number, neither: number): LabelPair[] => [
  ...Array.from({ length: both }, () => ({ human: "pass", judge: "pass" })),
  ...Array.from({ length: humanOnly }, () => ({ human: "pass", judge: "fail" })),
  ...Array.from({ length: judgeOnly }, () => ({ human: "fail", judge: "pass" })),
  ...Array.from({ length: neither }, () => ({ human: "fail", judge: "fail" })),
];
const ids = { holdoutSha256: SHA_A, promptSha256: SHA_A, judgeModelId: "judge-model-a" };

test("P4-STAT-002: kappa of the textbook table [[20,5],[10,15]] is 0.4", () => {
  assert.equal(round(cohensKappa(pairs(20, 5, 10, 15)) ?? NaN), 0.4);
});

test("P4-STAT-002: perfect agreement is 1, [[8,2],[2,8]] is 0.6, chance level is 0", () => {
  assert.equal(cohensKappa(pairs(10, 0, 0, 10)), 1);
  assert.equal(round(cohensKappa(pairs(8, 2, 2, 8)) ?? NaN), 0.6);
  assert.equal(cohensKappa(pairs(5, 5, 5, 5)), 0);
});

test("P4-STAT-002: kappa is null when it is undefined", () => {
  assert.equal(cohensKappa([]), null);
  assert.equal(cohensKappa(pairs(10, 0, 0, 0)), null);
});

test("P4-STAT-002: usable only at or above the threshold on enough items", () => {
  assert.equal(evaluateCalibration(pairs(8, 2, 2, 8), ids).decision.usable, true); // kappa 0.6 on 20 items
  assert.equal(evaluateCalibration(pairs(20, 5, 10, 15), ids).decision.usable, false); // kappa 0.4
  const few = evaluateCalibration(pairs(4, 0, 0, 6), ids); // kappa 1 on 10 items
  assert.equal(few.decision.usable, false);
  assert.match(few.decision.reason, /10 labelled items/);
});

test("P4-STAT-002: with no calibration artefact the judge is not usable", () => {
  assert.deepEqual(judgeGate(null, ids), { usable: false, reason: "no calibration artefact" });
});

test("P4-STAT-002: the artefact records kappa, items, threshold, hashes and the judge model id", () => {
  assert.deepEqual(evaluateCalibration(pairs(8, 2, 2, 8), ids).artefact, {
    schemaVersion: 1,
    kappa: 0.6,
    items: 20,
    threshold: 0.6,
    holdoutSha256: SHA_A,
    promptSha256: SHA_A,
    judgeModelId: "judge-model-a",
  });
  assert.equal(judgeGate(evaluateCalibration(pairs(8, 2, 2, 8), ids).artefact, ids).usable, true);
  assert.equal(judgeGate(evaluateCalibration(pairs(8, 2, 2, 8), ids).artefact, { ...ids, holdoutSha256: SHA_B }).usable, false);
});
