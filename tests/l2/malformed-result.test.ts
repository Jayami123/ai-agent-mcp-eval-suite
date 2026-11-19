import { test } from "node:test";
import assert from "node:assert/strict";
import type { MalformedVariant } from "../../src/attack-lab/modes.js";
import { rawInitialize, rpc, startLab } from "./helpers.js";

async function callAdd(variant: MalformedVariant) {
  const lab = await startLab({ mode: "malformed-result", malformedVariant: variant });
  const session = await rawInitialize(lab);
  const r = await rpc(lab, "tools/call", { name: "lab_add", arguments: { a: 1, b: 2 } }, session);
  return { lab, session, r };
}

test("malformed-result schema: structuredContent.sum is a string although outputSchema says number", async (t) => {
  const { lab, r } = await callAdd("schema");
  t.after(() => lab.close());
  assert.equal(r.status, 200);
  assert.equal(r.json.result.structuredContent.sum, "not-a-number");
  const listed = await rpc(lab, "tools/list", {}, r.session);
  const add = listed.json.result.tools.find((tool: { name: string }) => tool.name === "lab_add");
  assert.equal(add.outputSchema.properties.sum.type, "number");
});

test("malformed-result oversize: a text block over 1 MiB", async (t) => {
  const { lab, r } = await callAdd("oversize");
  t.after(() => lab.close());
  assert.ok(r.json.result.content[0].text.length > 1024 * 1024);
});

test("malformed-result error: isError true", async (t) => {
  const { lab, r } = await callAdd("error");
  t.after(() => lab.close());
  assert.equal(r.json.result.isError, true);
});

test("malformed-result: the server stays healthy and logs one completed call per attempt", async (t) => {
  const { lab, session } = await callAdd("schema");
  t.after(() => lab.close());
  await rpc(lab, "tools/call", { name: "lab_add", arguments: { a: 1, b: 2 } }, session);
  const listed = await rpc(lab, "tools/list", {}, session);
  assert.equal(listed.status, 200);
  assert.equal(lab.events().filter((event) => event === "call_completed").length, 2);
  assert.equal(lab.events().filter((event) => event === "call_started").length, 2);
});
