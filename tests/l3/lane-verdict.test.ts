import { test } from "node:test";
import assert from "node:assert/strict";
import { laneVerdict } from "./support/lane-verdict.js";

test("measured lane: every trial partial is inconclusive, never a pass", () => {
  assert.equal(laneVerdict(["partial", "partial"]), "inconclusive");
  assert.equal(laneVerdict(["partial"]), "inconclusive");
});

test("measured lane: no trials is inconclusive", () => {
  assert.equal(laneVerdict([]), "inconclusive");
});

test("measured lane: mixed partial and pass is conclusive", () => {
  assert.equal(laneVerdict(["partial", "pass"]), "conclusive");
  assert.equal(laneVerdict(["pass", "partial", "pass"]), "conclusive");
});

test("measured lane: mixed partial and fail is conclusive", () => {
  assert.equal(laneVerdict(["partial", "fail"]), "conclusive");
});

test("measured lane: all conclusive trials are conclusive", () => {
  assert.equal(laneVerdict(["pass", "pass"]), "conclusive");
  assert.equal(laneVerdict(["fail", "pass"]), "conclusive");
});
