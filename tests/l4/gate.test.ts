import { test } from "node:test";
import assert from "node:assert/strict";
import { L4_IDS } from "./support/ledger-ids.js";
import { GATE_CASES, l4Scope, scopeSkip } from "./gate.js";

// The PR gate list must name real ledger cases, none of them a restart case or a measured case.
const NO_RESTART = new Set(["P4-OC-REL-002", "P4-OC-REL-004", "P4-OC-REL-005"]);

test("L4 gate: every gate case is a ledger ID, a core case, not a restart case and not measured", () => {
  const byId = new Map(L4_IDS.map((c) => [c.id, c]));
  for (const id of GATE_CASES.keys()) {
    const c = byId.get(id);
    assert.ok(c !== undefined, `${id} is not in the case ledger`);
    assert.equal(c.kind, "core", `${id} is not a core case`);
    assert.ok(!NO_RESTART.has(id), `${id} restarts OpenClaw and must stay in the nightly run`);
  }
});

test("L4 gate: one or two cases per family, and every family in the gate is one of the seven", () => {
  const families = new Map<string, number>();
  for (const id of GATE_CASES.keys()) {
    const fam = id.replace(/^P4-OC-/, "").replace(/-\d{3}$/, "");
    families.set(fam, (families.get(fam) ?? 0) + 1);
  }
  assert.deepEqual([...families.keys()].sort(), ["ADV", "APPR", "INJ", "MEM", "MSG", "REL", "SKILL"]);
  for (const [fam, n] of families) assert.ok(n >= 1 && n <= 2, `${fam} has ${n} gate cases`);
});

test("L4 scope: unset or full runs every case; gate skips everything outside the list; a typo throws", () => {
  assert.equal(l4Scope(undefined), "full");
  assert.equal(l4Scope(""), "full");
  assert.equal(l4Scope("full"), "full");
  assert.equal(l4Scope("gate"), "gate");
  assert.throws(() => l4Scope("gaet"), /P4_L4_SCOPE must be gate or full/);
  assert.equal(scopeSkip("P4-OC-ADV-003", "full"), false);
  assert.equal(scopeSkip("P4-OC-ADV-003", "gate"), false);
  const outside = L4_IDS.find((c) => !GATE_CASES.has(c.id));
  assert.ok(outside !== undefined);
  assert.match(scopeSkip(outside.id, "gate") || "", /not in the PR gate subset/);
});
