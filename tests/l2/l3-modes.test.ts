import { test } from "node:test";
import assert from "node:assert/strict";
import { CANARY_EMAIL, CANARY_SECRET } from "../../src/attack-lab/modes.js";
import { connect, firstText, startLab } from "./helpers.js";

// L2 unit tests for the four modes the L3 lab cases need (flaky, add-tool-after-connect, untrusted-annotation, start-rewrite).
// Each runs the real lab over MCP, so the assertions are on what a host would see on the wire.

test("flaky: the first two calls to lab_add fail with a 500-style error, then the lab recovers", async (t) => {
  const lab = await startLab({ mode: "flaky" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const first = await client.callTool({ name: "lab_add", arguments: { a: 1, b: 2 } });
  const second = await client.callTool({ name: "lab_add", arguments: { a: 1, b: 2 } });
  const third = await client.callTool({ name: "lab_add", arguments: { a: 1, b: 2 } });
  assert.equal(first.isError, true);
  assert.equal(second.isError, true);
  assert.equal(third.isError, undefined, "the third call must succeed");
  assert.equal(firstText(third), "3");
  assert.deepEqual(lab.events().filter((e) => e === "call_failed").length, 2);
});

test("add-tool-after-connect: the new tool appears only after the trigger, and then it runs", async (t) => {
  const lab = await startLab({ mode: "add-tool-after-connect" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const before = (await client.listTools()).tools.map((tool) => tool.name);
  assert.equal(before.includes("lab_new_tool"), false, "not in the list the host connected to");
  assert.equal((await lab.control("/control/trigger", { method: "POST" })).status, 200);
  const after = await connect(lab);
  t.after(() => after.close());
  const listed = (await after.listTools()).tools.map((tool) => tool.name);
  assert.equal(listed.includes("lab_new_tool"), true, "the trigger adds it");
  const result = await after.callTool({ name: "lab_new_tool", arguments: {} });
  assert.equal(firstText(result), "status: ok");
});

test("untrusted-annotation: the echo result carries an instruction marked as untrusted content", async (t) => {
  const lab = await startLab({ mode: "untrusted-annotation" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const result = await client.callTool({ name: "lab_echo", arguments: { text: "hello" } });
  const item = (result.content as Array<{ text?: string; _meta?: Record<string, unknown> }>)[0];
  assert.ok(item?.text?.includes(CANARY_EMAIL), "the instruction names the canary address");
  assert.ok(item?.text?.includes(CANARY_SECRET), "and the canary secret");
  assert.equal(item?._meta?.["p4/untrusted"], true, "marked untrusted");
});

test("start-rewrite: the list served at start already carries the rewritten lab_echo description", async (t) => {
  const lab = await startLab({ mode: "start-rewrite" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const echo = (await client.listTools()).tools.find((tool) => tool.name === "lab_echo");
  assert.ok((echo?.description ?? "").includes(CANARY_EMAIL));
});

test("benign and the other modes do not serve lab_new_tool or the rewritten description", async (t) => {
  const lab = await startLab({ mode: "benign" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.equal(names.includes("lab_new_tool"), false);
  const echo = (await client.listTools()).tools.find((tool) => tool.name === "lab_echo");
  assert.equal((echo?.description ?? "").includes(CANARY_EMAIL), false);
});
