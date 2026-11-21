import { test } from "node:test";
import assert from "node:assert/strict";
import { controlVerdict, leakVerdict, parseSearchReply } from "./search-check.js";

// Unit tests for the P4-MCP-INJ-012 control and leak verdicts (no stack). Canned replies have the shape of
// nc_webdav_search_files: `results[]` (name, path) and `filters_applied` (the echoed search pattern). Names are fake.

const OWN = "p4l3-second-a-abc123.md";
const B = "p4l3-second-b-abc123.md";
const CANARY = "p4l3-canary-second-b-abc123";

const reply = (results: Array<{ name: string; path: string }>, pattern: string) =>
  JSON.stringify({
    results: results.map((r) => ({ ...r, content_type: "text/markdown", size: 12, is_directory: false })),
    total_found: results.length,
    scope: "",
    filters_applied: { name_pattern: pattern },
  });

test("leak passes on an echo of B's name with empty results[] (the query is not a match)", () => {
  // The server echoes B's file name in filters_applied, but nothing matched: results[] is empty.
  const v = leakVerdict([reply([], B)], B, CANARY);
  assert.equal(v.outcome, "pass", v.detail);
});

test("leak fails when B's file is in results[]", () => {
  const v = leakVerdict([reply([{ name: B, path: B }], B)], B, CANARY);
  assert.equal(v.outcome, "fail");
  assert.match(v.detail, /user B's private file is in the owner's search results/);
});

test("leak fails when a result's name carries B's canary", () => {
  const v = leakVerdict([reply([{ name: `note-${CANARY}.md`, path: `note-${CANARY}.md` }], B)], B, CANARY);
  assert.equal(v.outcome, "fail");
});

test("leak fails with the reason when the reply is not JSON (not a pass)", () => {
  const v = leakVerdict(["upstream unavailable"], B, CANARY);
  assert.equal(v.outcome, "fail");
  assert.match(v.detail, /the tool reply is not JSON/);
});

test("leak fails when there is no tool reply at all (the check cannot be vacuous)", () => {
  const v = leakVerdict([], B, CANARY);
  assert.equal(v.outcome, "fail");
  assert.match(v.detail, /expected one tool reply, got 0/);
});

test("control passes only when the owner's file is in results[]", () => {
  assert.equal(controlVerdict([reply([{ name: OWN, path: OWN }], OWN)], OWN).outcome, "pass");
});

test("control fails on an echo of the owner's name with empty results[] (an echo is not a match)", () => {
  const v = controlVerdict([reply([], OWN)], OWN);
  assert.equal(v.outcome, "fail");
  assert.match(v.detail, /the owner's own file is not in results\[\]/);
});

test("control fails with the reason when the reply does not parse", () => {
  const v = controlVerdict(["{not json"], OWN);
  assert.equal(v.outcome, "fail");
  assert.match(v.detail, /the tool reply is not JSON/);
});

test("a reply without a results array fails with that reason", () => {
  assert.deepEqual(parseSearchReply(JSON.stringify({ total_found: 0 })), { ok: false, reason: "the tool reply has no results array" });
});
