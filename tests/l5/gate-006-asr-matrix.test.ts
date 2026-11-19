import { test } from "node:test";
import assert from "node:assert/strict";
import { MixedModeError, buildAsrMatrix, type TrialRecord } from "../../src/stats/index.js";
import { trial } from "./support/records.js";

// P4-GATE-006 (stretch). Oracle (ledger): a dashboard artefact shows ASR with Wilson intervals per family and server.
// LibreChat only in this plan. OpenHands is out of scope; OpenClaw has its own L4 report.
const attack = (host: string, servers: string[], succeeded: boolean, i: number, over: Partial<TrialRecord> = {}): TrialRecord =>
  trial({ caseId: "P4-MCP-INJ-001", trial: i, host, servers, attackSucceeded: succeeded, ...over });

test("P4-GATE-006: ASR per host, server and family has a Wilson interval", () => {
  const records = [
    ...Array.from({ length: 10 }, (_, i) => attack("librechat", ["nextcloud"], i === 0, i)), // 1 of 10
    ...Array.from({ length: 10 }, (_, i) => attack("librechat", ["outline"], false, i)), // 0 of 10
  ];
  const m = buildAsrMatrix(records);
  assert.equal(m.cells.length, 2);
  assert.deepEqual(m.cells[0], { host: "librechat", server: "nextcloud", family: "MCP-INJ", attacks: 10, successes: 1, asr: 0.1, wilson: { lower: 0.0179, upper: 0.4042 } });
  assert.deepEqual(m.cells[1]?.wilson, { lower: 0, upper: 0.2775 });
});

test("P4-GATE-006: records without attackSucceeded are ignored; a record with two servers counts once per server", () => {
  const records = [attack("librechat", ["nextcloud", "outline"], true, 0), trial({ caseId: "P4-MCP-INJ-001", host: "librechat", servers: ["twenty"] })];
  const m = buildAsrMatrix(records);
  assert.deepEqual(m.cells.map((c) => c.server), ["nextcloud", "outline"]);
  assert.ok(m.cells.every((c) => c.attacks === 1 && c.successes === 1));
});

test("P4-GATE-006: stub and nightly records are never mixed", () => {
  assert.throws(() => buildAsrMatrix([attack("librechat", ["a"], true, 0), attack("librechat", ["a"], true, 1, { mode: "nightly" })]), MixedModeError);
});

test(
  "P4-GATE-006: the dashboard HTML renders the matrix",
  { skip: "blocked: the dashboard HTML is rendered by scripts/p4-nightly.mjs (not in this lane) and real host x server data needs L3 records" },
  () => undefined,
);
