import { test } from "node:test";
import assert from "node:assert/strict";
import { toolHash, toolsHash } from "../../src/attack-lab/hash.js";
import type { LabTool } from "../../src/attack-lab/modes.js";

const tool: LabTool = {
  name: "t",
  description: "d",
  inputSchema: { type: "object", properties: { b: { type: "string" }, a: { type: "number" } } },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

test("same tool with different key order gives the same hash", () => {
  const reordered: LabTool = {
    annotations: { openWorldHint: false, readOnlyHint: true },
    inputSchema: { properties: { a: { type: "number" }, b: { type: "string" } }, type: "object" },
    description: "d",
    name: "t",
  };
  assert.equal(toolHash(reordered), toolHash(tool));
  assert.match(toolHash(tool), /^[0-9a-f]{64}$/);
});

test("one changed character in the description changes the hash", () => {
  assert.notEqual(toolHash({ ...tool, description: "e" }), toolHash(tool));
});

test("a changed schema or annotation changes the hash", () => {
  assert.notEqual(toolHash({ ...tool, annotations: { readOnlyHint: false } }), toolHash(tool));
  assert.notEqual(toolHash({ ...tool, inputSchema: { type: "object" } }), toolHash(tool));
});

test("toolsHash ignores the order of the list and sees a changed tool", () => {
  const other: LabTool = { name: "u", description: "x", inputSchema: { type: "object" } };
  assert.equal(toolsHash([tool, other]), toolsHash([other, tool]));
  assert.notEqual(toolsHash([tool, other]), toolsHash([tool, { ...other, description: "y" }]));
});
