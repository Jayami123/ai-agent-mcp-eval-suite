import { test } from "node:test";
import assert from "node:assert/strict";
import { QUARANTINE, applyQuarantineToGate, selectRunnable, validateQuarantine, type QuarantineEntry } from "../../src/stats/index.js";

// P4-STAT-005. Oracle (ledger): a case marked quarantined does not fail the PR gate, appears in the report with its reason,
// and is still runnable on dispatch. Quarantine entries expire or require a named review.
const TODAY = "2026-11-18";
const ID = "P4-MCP-REL-006";
const entry = (over: Partial<QuarantineEntry> = {}): QuarantineEntry => ({
  caseId: ID,
  reason: "flaky tool order on the free tier",
  since: "2026-11-10",
  expires: "2026-12-05",
  reviewer: null,
  ...over,
});

test("P4-STAT-005: a quarantined failure does not fail the PR gate and appears in the report with reason and expiry", () => {
  const out = applyQuarantineToGate([{ caseId: ID, status: "fail" }], [entry()], TODAY);
  assert.deepEqual(out.gateFailures, []);
  assert.deepEqual(out.quarantinedReport, [{ caseId: ID, status: "fail", reason: "flaky tool order on the free tier", expires: "2026-12-05" }]);
});

test("P4-STAT-005: an unquarantined failure still fails the gate", () => {
  assert.deepEqual(applyQuarantineToGate([{ caseId: "P4-STAT-003", status: "fail" }], [entry()], TODAY).gateFailures, ["P4-STAT-003"]);
});

test("P4-STAT-005: quarantined cases are skipped on pull_request, push and schedule, and run on workflow_dispatch", () => {
  for (const trigger of ["pull_request", "push", "schedule"] as const) {
    const plan = selectRunnable([ID, "P4-STAT-003"], [entry()], TODAY, trigger);
    assert.deepEqual(plan.run, ["P4-STAT-003"]);
    assert.equal(plan.skipped[0]?.caseId, ID);
    assert.match(plan.skipped[0]?.reason ?? "", /quarantined: flaky tool order/);
  }
  assert.deepEqual(selectRunnable([ID, "P4-STAT-003"], [entry()], TODAY, "workflow_dispatch").run, [ID, "P4-STAT-003"]);
});

test("P4-STAT-005: an expired entry no longer protects the case and validateQuarantine reports it", () => {
  const old = entry({ since: "2026-10-20", expires: "2026-11-17" });
  assert.deepEqual(applyQuarantineToGate([{ caseId: ID, status: "fail" }], [old], TODAY).gateFailures, [ID]);
  assert.match(validateQuarantine([old], TODAY).join("\n"), /expired on 2026-11-17/);
});

test("P4-STAT-005: no expiry is accepted only with a named reviewer", () => {
  assert.match(validateQuarantine([entry({ expires: null })], TODAY).join("\n"), /no expiry and no named reviewer/);
  const reviewed = entry({ expires: null, reviewer: "owner" });
  assert.deepEqual(validateQuarantine([reviewed], "2027-06-01"), []);
  assert.deepEqual(applyQuarantineToGate([{ caseId: ID, status: "fail" }], [reviewed], "2027-06-01").gateFailures, []);
});

test("P4-STAT-005: expiry more than 30 days after since is rejected, exactly 30 days is accepted", () => {
  assert.match(validateQuarantine([entry({ since: "2026-11-01", expires: "2026-12-02" })], TODAY).join("\n"), /more than 30 days/);
  assert.deepEqual(validateQuarantine([entry({ since: "2026-11-01", expires: "2026-12-01" })], TODAY), []);
});

test("P4-STAT-005: empty reason, bad case id, bad date format and duplicate ids are each reported", () => {
  const errors = validateQuarantine([entry({ reason: " " }), entry({ caseId: "nope" }), entry({ since: "18/11/2026" }), entry()], TODAY).join("\n");
  assert.match(errors, /reason is empty/);
  assert.match(errors, /bad case id/);
  assert.match(errors, /not an ISO date/);
  assert.match(errors, /duplicate entry/);
});

test("P4-STAT-005: the committed QUARANTINE list is valid today", () => {
  // The only test that reads the real date, so a stale committed entry fails CI. The date is read here, never in src/.
  assert.deepEqual(validateQuarantine(QUARANTINE, new Date().toISOString().slice(0, 10)), []);
});
