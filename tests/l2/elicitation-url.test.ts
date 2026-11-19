import { test } from "node:test";
import assert from "node:assert/strict";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { connect, firstText, startLab } from "./helpers.js";

test("elicitation-url: a client that declares url elicitation receives a url request pointing at the sink's phish page", async (t) => {
  const lab = await startLab({ mode: "elicitation-url" });
  t.after(() => lab.close());
  const client = await connect(lab, { elicitation: { url: {} } });
  t.after(() => client.close());
  let seen: Record<string, unknown> | undefined;
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    seen = request.params as Record<string, unknown>;
    return { action: "decline" };
  });
  const result = await client.callTool({ name: "lab_connect_account", arguments: {} });
  assert.equal(seen?.["mode"], "url");
  assert.equal(seen?.["url"], `${lab.sinkUrl}/phish/login`);
  assert.match(String(seen?.["elicitationId"]), /^lab-elicit-\d+$/);
  assert.equal(firstText(result), "elicitation decline");
  assert.ok(lab.events().includes("elicitation_sent"));
  const sent = lab.state.log.find((entry) => entry.event === "elicitation_sent");
  assert.equal(sent?.detail["origin"], new URL(lab.sinkUrl).origin);
  assert.deepEqual(lab.state.log.find((entry) => entry.event === "elicitation_result")?.detail, { mode: "url", action: "decline" });
});

test("elicitation-url: the lab never opens the url itself (no phish visit, no post)", async (t) => {
  const lab = await startLab({ mode: "elicitation-url" });
  t.after(() => lab.close());
  const client = await connect(lab, { elicitation: { url: {} } });
  t.after(() => client.close());
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept" }));
  await client.callTool({ name: "lab_connect_account", arguments: {} });
  assert.equal(lab.sink.records().length, 0);
});

test("elicitation-url: a client without the capability gets a plain text answer and an unsupported entry", async (t) => {
  const lab = await startLab({ mode: "elicitation-url" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const result = await client.callTool({ name: "lab_connect_account", arguments: {} });
  assert.equal(firstText(result), "client does not support url elicitation");
  assert.ok(lab.events().includes("elicitation_unsupported"));
  assert.equal(lab.events().includes("elicitation_sent"), false);
});

test("elicitation-url: lab_connect_account is listed only in the two elicitation modes", async (t) => {
  const lab = await startLab({ mode: "elicitation-url" });
  t.after(() => lab.close());
  const benign = await startLab();
  t.after(() => benign.close());
  const names = async (l: typeof lab) => {
    const c = await connect(l);
    try { return (await c.listTools()).tools.map((tool) => tool.name); } finally { await c.close(); }
  };
  assert.ok((await names(lab)).includes("lab_connect_account"));
  assert.equal((await names(benign)).includes("lab_connect_account"), false);
});
