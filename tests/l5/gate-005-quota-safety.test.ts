import { test } from "node:test";
import assert from "node:assert/strict";
import { CursorMismatchError, classifyProviderError, createThrottle, parseCursor, parseMode, runSlice, scoreCase, serializeCursor } from "../../src/stats/index.js";
import { fakeDeps } from "./support/records.js";

// P4-GATE-005. Oracle (ledger): quota stop gives partial. A safety-filter refusal is blocked by provider, neither pass nor
// fail. The resume cursor is written so the next dispatch continues.
test("P4-GATE-005: 429 or RESOURCE_EXHAUSTED after all retries is partial", () => {
  assert.equal(classifyProviderError("provider returned 429", 3, 3).status, "partial");
  assert.equal(classifyProviderError('{"status":"RESOURCE_EXHAUSTED"}', 3, 3).status, "partial");
});

test("P4-GATE-005: a rate limit before the retries are used up is a fail, not partial", () => {
  const v = classifyProviderError("429", 2, 3);
  assert.equal(v.status, "fail");
  assert.match(v.reason, /retries not used up/);
});

test("P4-GATE-005: a safety refusal is blocked by provider", () => {
  assert.equal(classifyProviderError("finish_reason content_filter", 1, 3).status, "blocked by provider");
  assert.equal(classifyProviderError("blocked: SAFETY", 1, 3).status, "blocked by provider");
  assert.equal(classifyProviderError("the model was unsafe", 1, 3).status, "fail");
});

test("P4-GATE-005: any other error is fail, including 503 UNAVAILABLE, and 1429 is not a rate limit", () => {
  assert.equal(classifyProviderError("503 UNAVAILABLE", 3, 3).status, "fail");
  assert.equal(classifyProviderError("error 1429 in stream", 3, 3).status, "fail");
  assert.equal(classifyProviderError("", 1, 3).status, "ok");
});

test("P4-GATE-005: a blocked trial does not stop the slice and the case is neither pass nor fail", async () => {
  const input = { runId: "r1", mode: "stub", k: 3, planned: ["P4-MCP-REL-006"], measured: new Set<string>() } as const;
  const r = await runSlice(input, fakeDeps(["pass", "blocked", "pass"]).deps);
  assert.equal(r.records.length, 3);
  assert.equal(r.jobVerdict, "green");
  const score = scoreCase({ caseId: "P4-MCP-REL-006", mode: "stub", k: 3 }, r.records.map((x) => ({ ...x, k: 3 })));
  assert.equal(score.coverage, "blocked by provider");
  assert.equal(score.passK, null);
});

test("P4-GATE-005: the resume cursor round-trips and a cursor for another mode, k or case list is refused", async () => {
  const input = { runId: "r1", mode: "stub", k: 2, planned: ["P4-MCP-REL-006", "P4-STAT-004"], measured: new Set<string>() } as const;
  const r = await runSlice(input, fakeDeps(["pass", "quota"]).deps);
  const text = serializeCursor(r.cursor);
  assert.ok(text.endsWith("\n"));
  const expect = { mode: "stub", k: 2, planned: input.planned } as const;
  assert.deepEqual(parseCursor(text, expect), r.cursor);
  assert.throws(() => parseCursor(text, { ...expect, mode: "nightly" }), CursorMismatchError);
  assert.throws(() => parseCursor(text, { ...expect, k: 10 }), CursorMismatchError);
  assert.throws(() => parseCursor(text, { ...expect, planned: ["P4-STAT-004"] }), CursorMismatchError);
});

test("P4-GATE-005: the throttle allows two heavy turns per window and makes the third wait", () => {
  const t = createThrottle();
  assert.equal(t.waitMs(0), 0);
  t.record(6000, 0);
  assert.equal(t.waitMs(500), 0);
  t.record(6000, 1000);
  assert.equal(t.waitMs(2000), 58_000);
  assert.equal(t.waitMs(60_000), 0);
});

test("P4-GATE-005: parseMode defaults to stub and rejects unknown values", () => {
  assert.equal(parseMode(undefined), "stub");
  assert.equal(parseMode(""), "stub");
  assert.equal(parseMode("nightly"), "nightly");
  assert.throws(() => parseMode("prod"), /stub or nightly/);
});
