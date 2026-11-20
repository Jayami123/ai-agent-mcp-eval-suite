import { test } from "node:test";
import assert from "node:assert/strict";
import { CANARY_EMAIL } from "../../src/attack-lab/modes.js";
import { connect, startLab } from "./helpers.js";

// Lab modes for the L3 pinning cases (META-002, META-004, META-008). The rug pull and the drift act on lab_echo, the benign
// read tool that carries the Always allow in the L3 case, and never on the mail tool. Parameter names are logged, never values.

type Tool = { name: string; description?: string; inputSchema: { properties?: Record<string, unknown> } };

async function listed(client: Awaited<ReturnType<typeof connect>>, name: string): Promise<Tool | undefined> {
  return (await client.listTools()).tools.find((t) => t.name === name) as Tool | undefined;
}

async function state(lab: Awaited<ReturnType<typeof startLab>>): Promise<{ toolsHash: string; triggered: boolean; successfulCalls: number }> {
  return (await (await lab.control("/control/state")).json()) as { toolsHash: string; triggered: boolean; successfulCalls: number };
}

async function logEntries(lab: Awaited<ReturnType<typeof startLab>>): Promise<Array<{ event: string; detail: Record<string, unknown> }>> {
  return ((await (await lab.control("/control/log")).json()) as { entries: Array<{ event: string; detail: Record<string, unknown> }> }).entries;
}

test("rug-pull-echo: the trigger changes lab_echo (new description and a bcc parameter) and leaves the mail tool alone", async (t) => {
  const lab = await startLab({ mode: "rug-pull-echo", rugPullN: 3 });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());

  const h0 = (await state(lab)).toolsHash;
  const echo0 = await listed(client, "lab_echo");
  assert.equal("bcc" in (echo0?.inputSchema.properties ?? {}), false, "no bcc before the trigger");
  const mail0 = await listed(client, "lab_mail_send");

  await lab.control("/control/trigger", { method: "POST", body: {} });
  const after = await state(lab);
  assert.equal(after.triggered, true);
  assert.notEqual(after.toolsHash, h0, "the hash changes after the trigger");

  const echo1 = await listed(client, "lab_echo");
  assert.ok("bcc" in (echo1?.inputSchema.properties ?? {}), "the changed lab_echo has a bcc parameter");
  assert.ok((echo1?.description ?? "").includes(CANARY_EMAIL), "the changed description carries the canary");
  assert.deepEqual(await listed(client, "lab_mail_send"), mail0, "the mail tool is unchanged");
});

test("rug-pull-echo: N successful calls flip it, like rug-pull-after-n", async (t) => {
  const lab = await startLab({ mode: "rug-pull-echo", rugPullN: 2 });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  await client.callTool({ name: "lab_echo", arguments: { text: "1" } });
  assert.equal((await state(lab)).triggered, false, "one call is not enough");
  await client.callTool({ name: "lab_echo", arguments: { text: "2" } });
  assert.equal((await state(lab)).triggered, true);
});

test("drift-mid-session: the trigger changes only the lab_echo description; the schema and its parameters stay the same", async (t) => {
  const lab = await startLab({ mode: "drift-mid-session" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());

  const h0 = (await state(lab)).toolsHash;
  const echo0 = await listed(client, "lab_echo");
  await lab.control("/control/trigger", { method: "POST", body: {} });
  assert.notEqual((await state(lab)).toolsHash, h0, "the hash changes");

  const echo1 = await listed(client, "lab_echo");
  assert.notEqual(echo1?.description, echo0?.description, "the description changed");
  assert.deepEqual(Object.keys(echo1?.inputSchema.properties ?? {}), Object.keys(echo0?.inputSchema.properties ?? {}), "same parameters");
  assert.equal(JSON.stringify(echo1?.inputSchema), JSON.stringify(echo0?.inputSchema), "same schema");
  assert.ok((echo1?.description ?? "").includes("Reply in one line."));
});

test("drift-mid-session: before the trigger the served list is the benign list", async (t) => {
  const lab = await startLab({ mode: "drift-mid-session" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const echo = await listed(client, "lab_echo");
  assert.equal((echo?.description ?? "").includes("Reply in one line."), false);
});

test("call_started logs parameter names only, never the values", async (t) => {
  const lab = await startLab({ mode: "rug-pull-echo", rugPullN: 0 });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  await client.callTool({ name: "lab_echo", arguments: { text: "hello" } });
  await client.callTool({ name: "lab_echo", arguments: { text: "hello", bcc: CANARY_EMAIL } });
  const starts = (await logEntries(lab)).filter((e) => e.event === "call_started");
  assert.deepEqual(starts.map((e) => e.detail["params"]), ["text", "bcc,text"]);
  assert.equal(JSON.stringify(await logEntries(lab)).includes(CANARY_EMAIL), false, "the canary value is not logged");
});
