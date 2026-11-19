import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrialsJsonl, trialFromL1GemmaRecord, trialFromStubEntries, validateTrial } from "../../src/stats/index.js";
import { SHA_A, trial } from "./support/records.js";

// P4-STAT-006. Oracle (ledger): every run artefact validates against the committed trace schema, including the model id
// LiteLLM logged and the approvals and state snapshots. Missing approvals or snapshots fail the job.
const state = { name: "mail-store", sha256: SHA_A };

test("P4-STAT-006: a valid stub record passes the l1 profile", () => {
  assert.deepEqual(validateTrial(trial(), "l1"), { ok: true, errors: [] });
});

test("P4-STAT-006: missing model id fails (served id empty on a trial that reached the model)", () => {
  const v = validateTrial(trial({ model: { alias: "p4-stub", servedId: "" } }), "l1");
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith("model.servedId")));
});

test("P4-STAT-006: a partial trial that never ran may have an empty served id", () => {
  assert.equal(validateTrial(trial({ status: "partial", model: { alias: "p4-stub", servedId: "" } }), "l1").ok, true);
});

test("P4-STAT-006: a missing approvals key fails, an empty approvals array passes", () => {
  const { approvals: _dropped, ...rest } = trial();
  const v = validateTrial(rest, "l1");
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith("approvals")));
  assert.equal(validateTrial(trial({ approvals: [] }), "l1").ok, true);
});

test("P4-STAT-006: the state profile needs a before and an after snapshot on a completed trial", () => {
  const none = validateTrial(trial({ snapshots: [] }), "state");
  assert.equal(none.ok, false);
  assert.ok(none.errors.some((e) => e.startsWith("snapshots")));
  const onlyBefore = validateTrial(trial({ snapshots: [{ ...state, phase: "before" }] }), "state");
  assert.equal(onlyBefore.ok, false);
  const both = validateTrial(trial({ snapshots: [{ ...state, phase: "before" }, { ...state, phase: "after" }] }), "state");
  assert.equal(both.ok, true);
});

test("P4-STAT-006: mode and model alias must agree, and a nightly record cannot be answered by the stub", () => {
  assert.equal(validateTrial(trial({ mode: "nightly" }), "l1").ok, false); // alias still p4-stub
  const v = validateTrial(trial({ mode: "nightly", model: { alias: "p4-nightly", servedId: "p4-stub" } }), "l1");
  assert.ok(v.errors.some((e) => e.includes("answered by the stub")));
});

test("P4-STAT-006: every problem is reported, not only the first", () => {
  const v = validateTrial({ schemaVersion: 2, caseId: "nope" }, "l1");
  assert.ok(v.errors.length >= 3);
});

test("P4-STAT-006: parseTrialsJsonl accepts valid lines and names the bad line", () => {
  const good = JSON.stringify(trial());
  assert.equal(parseTrialsJsonl(`${good}\n${good}\n`, "l1").length, 2);
  assert.throws(() => parseTrialsJsonl(`${good}\n{"schemaVersion":1}\n`, "l1"), /line 2/);
});

test("P4-STAT-006: L1 stub entries map to a valid record, tool calls in seq order", () => {
  const entries = [
    { seq: 2, fixture: "f", turn: 1, toolsOffered: [], stream: false, toolResults: [], toolCalls: [{ name: "second", arguments: {} }], content: null },
    { seq: 1, fixture: "f", turn: 0, toolsOffered: [], stream: false, toolResults: [], toolCalls: [{ name: "first", arguments: { a: 1 } }], content: null },
  ];
  const rec = trialFromStubEntries(entries, { caseId: "P4-STAT-001", trial: 0, k: 5, promptSha256: SHA_A, servedModelId: "p4-stub", latencyMs: 3 });
  assert.deepEqual(rec.toolCalls.map((c) => c.name), ["first", "second"]);
  assert.equal(validateTrial(rec, "l1").ok, true);
});

test("P4-STAT-006: an L1 Gemma record maps to a valid nightly record when served id and usage are supplied", () => {
  const rec = trialFromL1GemmaRecord(
    { status: "pass", model: "p4-nightly", trajectory: [{ name: "list_object_metadata_names_mcp_twenty", arguments: {} }], reason: "ok" },
    { caseId: "P4-MCP-REL-006", trial: 0, k: 10, promptSha256: SHA_A, servedModelId: "gemma-4-31b-it", latencyMs: 900, usage: { promptTokens: 5000, completionTokens: 40 } },
  );
  assert.equal(rec.mode, "nightly");
  assert.deepEqual(validateTrial(rec, "l1"), { ok: true, errors: [] });
});
