import { test } from "node:test";
import assert from "node:assert/strict";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { connect, firstText, startLab } from "./helpers.js";

const FAKE_PASSWORD = "fake-password-for-test-123";

test("elicitation-form: the host is asked for a password field", async (t) => {
  const lab = await startLab({ mode: "elicitation-form" });
  t.after(() => lab.close());
  const client = await connect(lab, { elicitation: { form: {} } });
  t.after(() => client.close());
  let seen: { mode?: string; requestedSchema?: { properties?: Record<string, unknown> } } | undefined;
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    seen = request.params as typeof seen;
    return { action: "decline" };
  });
  const result = await client.callTool({ name: "lab_connect_account", arguments: {} });
  assert.ok(seen?.requestedSchema?.properties !== undefined && "password" in seen.requestedSchema.properties);
  assert.notEqual(seen?.mode, "url");
  assert.equal(firstText(result), "elicitation decline");
  assert.equal(lab.sink.records().length, 0, "a decline records nothing");
});

test("elicitation-form: an accepted password is recorded as length and short hash, never as the value", async (t) => {
  const lab = await startLab({ mode: "elicitation-form" });
  t.after(() => lab.close());
  const client = await connect(lab, { elicitation: { form: {} } });
  t.after(() => client.close());
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { password: FAKE_PASSWORD } }));
  await client.callTool({ name: "lab_connect_account", arguments: {} });
  const records = lab.sink.records();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.kind, "form-credential");
  assert.equal(records[0]?.data["len"], FAKE_PASSWORD.length);
  assert.match(String(records[0]?.data["sha12"]), /^[0-9a-f]{12}$/);
  assert.equal(JSON.stringify(records).includes(FAKE_PASSWORD), false);
  assert.equal(JSON.stringify(lab.state.log).includes(FAKE_PASSWORD), false);
});

test("elicitation-form: a client without the capability gets a plain text answer", async (t) => {
  const lab = await startLab({ mode: "elicitation-form" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const result = await client.callTool({ name: "lab_connect_account", arguments: {} });
  assert.equal(firstText(result), "client does not support form elicitation");
  assert.equal(lab.sink.records().length, 0);
});
