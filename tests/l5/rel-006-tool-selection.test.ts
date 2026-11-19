import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { scoreCase, scoreToolSelection, trialFromStubEntries, validateTrial, type ExpectedCall, type TrialRecord } from "../../src/stats/index.js";
import { SHA_A } from "./support/records.js";
import { runFixtureOnce, startStub } from "./support/stub.js";

// P4-MCP-REL-006. Oracle (ledger): for a seed task with a known correct tool sequence, report pass^k and a Wilson interval
// over k isolated trials. A measured quality case, not a hard security gate: no pass-rate threshold is asserted here.
const ID = "P4-MCP-REL-006";
const EXPECTED: ExpectedCall[] = [{ name: "search_records", arguments: { query: "fake-alpha" } }];
const call = (name: string, args: Record<string, unknown> = {}) => ({ name, arguments: args });

test("P4-MCP-REL-006: the expected call sequence scores ok", () => {
  assert.deepEqual(scoreToolSelection([call("search_records", { query: "fake-alpha", limit: 5 })], EXPECTED), { ok: true, reason: "ok", index: null });
});

test("P4-MCP-REL-006: each wrong shape gets its own reason", () => {
  assert.deepEqual(scoreToolSelection([], EXPECTED), { ok: false, reason: "missing-call", index: 0 });
  assert.equal(scoreToolSelection([call("search_records", { query: "fake-alpha" }), call("extra")], EXPECTED).reason, "extra-call");
  assert.deepEqual(scoreToolSelection([call("delete_record", { query: "fake-alpha" })], EXPECTED), { ok: false, reason: "wrong-tool", index: 0 });
  assert.equal(scoreToolSelection([call("search_records", { query: "other" })], EXPECTED).reason, "wrong-arguments");
});

test("P4-MCP-REL-006: extra argument keys are allowed, a different value is not", () => {
  assert.equal(scoreToolSelection([call("search_records", { query: "fake-alpha", limit: 99, extra: true })], EXPECTED).ok, true);
  assert.equal(scoreToolSelection([call("search_records", { query: "fake-beta" })], EXPECTED).ok, false);
});

test("P4-MCP-REL-006: stub plumbing, k = 10 trials through the in-process stub, give valid records and pass^k true", async () => {
  const stub = await startStub();
  try {
    const records: TrialRecord[] = [];
    for (let i = 0; i < 10; i++) {
      const run = await runFixtureOnce(stub.port, "smoke-search-001");
      const rec = trialFromStubEntries(run.entries, { caseId: ID, trial: i, k: 10, promptSha256: SHA_A, servedModelId: run.servedModelId, latencyMs: run.latencyMs });
      records.push({ ...rec, status: scoreToolSelection(rec.toolCalls, EXPECTED).ok ? "pass" : "fail" });
    }
    for (const r of records) assert.equal(validateTrial(r, "l1").ok, true);
    const score = scoreCase({ caseId: ID, mode: "stub", k: 10 }, records);
    assert.equal(score.passK, true);
    assert.deepEqual(score.wilson, { lower: 0.7225, upper: 1 });
  } finally {
    await stub.close();
  }
  // Plumbing only: the stub always returns the planned call, so this says nothing about Gemma.
});

test(
  "P4-MCP-REL-006: measured Gemma run reports k, passes, pass^k and a Wilson interval",
  { skip: process.env["P4_LLM_MODE"] === "nightly" ? false : "needs P4_LLM_MODE=nightly (nightly workflow only)" },
  () => {
    const rates = JSON.parse(readFileSync(path.resolve(process.cwd(), "evidence/nightly/rates.json"), "utf8")) as {
      mode: string;
      cases: Array<{ caseId: string; k: number; passes: number; passK: boolean | null; rate: number | null; wilson: unknown }>;
    };
    assert.equal(rates.mode, "nightly");
    const c = rates.cases.find((x) => x.caseId === ID);
    assert.ok(c, `${ID} is missing from rates.json`);
    // No pass-rate threshold: this is a measured quality case. It must be reported with its k and interval.
    assert.ok(Number.isInteger(c.k) && Number.isInteger(c.passes));
    assert.ok("passK" in c && "rate" in c && "wilson" in c);
  },
);
