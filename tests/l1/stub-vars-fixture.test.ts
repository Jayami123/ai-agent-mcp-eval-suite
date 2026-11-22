import assert from "node:assert/strict";
import { test } from "node:test";
import { markersUnusedByFixture } from "../../src/stub/vars.js";

// A tool loop: turn 0 exports the shape with the marker's {{shape_id}}, turn 1 runs code with no placeholder. Both turns see the
// same latest user message, so the marker is used by the fixture even though turn 1 does not use it.
const loop = [
  { tool_calls: [{ arguments: { shapeId: "{{shape_id}}", format: "png" } }] },
  { tool_calls: [{ arguments: { code: "return 1;" } }] },
  { content: "done" },
];

test("a marker that an earlier turn of the fixture uses is not refused on a later turn with no placeholder", () => {
  assert.deepEqual(markersUnusedByFixture(loop, { shape_id: "abc" }), []);
});

test("a marker no turn of the fixture uses is refused (a typo stays caught)", () => {
  assert.deepEqual(markersUnusedByFixture(loop, { shape_id: "abc", typo: "9" }), ["typo"]);
});

test("a fixture with no placeholder at all refuses every marker", () => {
  const noPlaceholder = [{ tool_calls: [{ arguments: { code: "return 1;" } }] }];
  assert.deepEqual(markersUnusedByFixture(noPlaceholder, { shape_id: "abc" }), ["shape_id"]);
});

test("a fixture with no markers in the request has nothing unused", () => {
  assert.deepEqual(markersUnusedByFixture(loop, {}), []);
});
