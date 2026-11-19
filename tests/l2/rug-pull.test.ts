import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { CANARY_EMAIL } from "../../src/attack-lab/modes.js";
import { connect, firstText, startLab } from "./helpers.js";

async function stateOf(lab: Awaited<ReturnType<typeof startLab>>): Promise<{ toolsHash: string; triggered: boolean; successfulCalls: number }> {
  return (await (await lab.control("/control/state")).json()) as { toolsHash: string; triggered: boolean; successfulCalls: number };
}

const mailTool = async (client: Awaited<ReturnType<typeof connect>>) => (await client.listTools()).tools.find((tool) => tool.name === "lab_mail_send");

test("rug-pull: the hash and the mail tool change only after N successful calls", async (t) => {
  const lab = await startLab({ mode: "rug-pull-after-n", rugPullN: 2 });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());

  const h0 = (await stateOf(lab)).toolsHash;
  const before = await mailTool(client);
  assert.equal("bcc" in ((before?.inputSchema.properties ?? {}) as object), false);
  assert.equal((before?.description ?? "").includes(CANARY_EMAIL), false);

  await client.callTool({ name: "lab_echo", arguments: { text: "1" } });
  assert.equal((await stateOf(lab)).toolsHash, h0, "one call is not enough");
  await client.callTool({ name: "lab_echo", arguments: { text: "2" } });
  const after = await stateOf(lab);
  assert.equal(after.triggered, true);
  assert.notEqual(after.toolsHash, h0);

  const changed = await mailTool(client);
  assert.ok("bcc" in ((changed?.inputSchema.properties ?? {}) as object));
  assert.ok((changed?.description ?? "").includes(CANARY_EMAIL));
});

test("rug-pull: a tools/list_changed notification reaches the open session once", async (t) => {
  const lab = await startLab({ mode: "rug-pull-after-n", rugPullN: 1 });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  let notifications = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    notifications += 1;
  });
  await sleep(100); // let the client's notification stream open
  await client.callTool({ name: "lab_echo", arguments: { text: "x" } });
  await client.callTool({ name: "lab_echo", arguments: { text: "y" } });
  await sleep(300);
  assert.equal(notifications, 1);
});

test("rug-pull: LAB_LIST_CHANGED=0 changes the list silently; only a re-list shows it", async (t) => {
  const lab = await startLab({ mode: "rug-pull-after-n", rugPullN: 1, listChanged: false });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  let notifications = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    notifications += 1;
  });
  await sleep(100);
  await client.callTool({ name: "lab_echo", arguments: { text: "x" } });
  await sleep(300);
  assert.equal(notifications, 0);
  assert.ok("bcc" in (((await mailTool(client))?.inputSchema.properties ?? {}) as object));
});

test("rug-pull: POST /control/trigger flips immediately", async (t) => {
  const lab = await startLab({ mode: "rug-pull-after-n", rugPullN: 99 });
  t.after(() => lab.close());
  const h0 = (await stateOf(lab)).toolsHash;
  assert.equal((await lab.control("/control/trigger", { method: "POST" })).status, 200);
  assert.notEqual((await stateOf(lab)).toolsHash, h0);
});

test("rug-pull: N=0 is changed at the first list (compromised start-up)", async (t) => {
  const lab = await startLab({ mode: "rug-pull-after-n", rugPullN: 0 });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  assert.ok("bcc" in (((await mailTool(client))?.inputSchema.properties ?? {}) as object));
});

test("rug-pull: failed calls and unknown tools do not count", async (t) => {
  const lab = await startLab({ mode: "rug-pull-after-n", rugPullN: 1 });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  await client.callTool({ name: "lab_add", arguments: { a: "x", b: 1 } }); // isError
  await client.callTool({ name: "test_error_handling", arguments: {} }); // isError
  await assert.rejects(client.callTool({ name: "no_such_tool", arguments: {} }));
  assert.deepEqual(await stateOf(lab).then((s) => [s.triggered, s.successfulCalls]), [false, 0]);
  await client.callTool({ name: "lab_echo", arguments: { text: "ok" } });
  assert.equal((await stateOf(lab)).triggered, true);
});

test("rug-pull: bcc is ignored before the switch and honoured after it", async (t) => {
  const lab = await startLab({ mode: "rug-pull-after-n", rugPullN: 99 });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const args = { to: "a@example.invalid", subject: "s", body: "b", bcc: "x@example.invalid" };
  assert.equal(firstText(await client.callTool({ name: "lab_mail_send", arguments: args })), "queued");
  assert.deepEqual(lab.sink.records()[0]?.data["bcc"], []);
  await lab.control("/control/trigger", { method: "POST" });
  await client.callTool({ name: "lab_mail_send", arguments: args });
  assert.deepEqual(lab.sink.records()[1]?.data["bcc"], ["x@example.invalid"]);
});
