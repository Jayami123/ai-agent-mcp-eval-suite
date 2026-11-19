import { test } from "node:test";
import assert from "node:assert/strict";
import { toolHash, toolsHash } from "../../src/attack-lab/hash.js";
import { buildTools } from "../../src/attack-lab/modes.js";
import { connect, firstText, rpc, rawInitialize, startLab } from "./helpers.js";

test("benign: lists the base tools with the documented annotations", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["json_schema_2020_12_tool", "lab_add", "lab_echo", "lab_mail_send", "test_error_handling"]);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.equal(byName.get("lab_echo")?.annotations?.readOnlyHint, true);
  assert.equal(byName.get("lab_add")?.annotations?.readOnlyHint, true);
  assert.equal(byName.get("lab_mail_send")?.annotations?.destructiveHint, true);
  assert.equal(byName.get("lab_mail_send")?.annotations?.openWorldHint, true);
  for (const tool of tools) assert.ok(tool.description !== undefined && tool.description !== "", `${tool.name} has a description`);
});

test("benign: lab_echo and lab_add give the documented results", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const echo = await client.callTool({ name: "lab_echo", arguments: { text: "hello" } });
  assert.deepEqual(echo.structuredContent, { echo: "hello" });
  const add = await client.callTool({ name: "lab_add", arguments: { a: 2, b: 3 } });
  assert.deepEqual(add.structuredContent, { sum: 5 });
  assert.equal(firstText(add), "5");
});

test("benign: lab_mail_send records one sink mail with no bcc", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const res = await client.callTool({ name: "lab_mail_send", arguments: { to: "a@example.invalid", subject: "s", body: "b" } });
  assert.equal(firstText(res), "queued");
  const records = lab.sink.records();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.kind, "mail");
  assert.deepEqual(records[0]?.data, { to: ["a@example.invalid"], bcc: [], subject: "s", body: "b" });
});

test("benign: an unknown tool is a JSON-RPC error with no side effect", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const session = await rawInitialize(lab);
  const r = await rpc(lab, "tools/call", { name: "does_not_exist", arguments: {} }, session);
  assert.equal(r.json.error.code, -32602);
  assert.match(r.json.error.message, /unknown tool: does_not_exist/);
  assert.equal(lab.sink.records().length, 0);
  assert.equal(lab.events().includes("call_started"), false);
});

test("benign: the conformance fixture tools behave as the suite expects", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const err = await client.callTool({ name: "test_error_handling", arguments: {} });
  assert.equal(err.isError, true);
  assert.match(firstText(err), /intentionally returns an error/);
  const { tools } = await client.listTools();
  const schema = tools.find((tool) => tool.name === "json_schema_2020_12_tool")?.inputSchema as Record<string, unknown>;
  assert.equal(schema["$schema"], "https://json-schema.org/draft/2020-12/schema");
  assert.ok("address" in (schema["$defs"] as object));
  assert.equal(schema["additionalProperties"], false);
});

test("benign: the tool hash is stable and matches what the control API reports", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const expected = toolsHash(buildTools(lab.state));
  const state = (await (await lab.control("/control/state")).json()) as { toolsHash: string; tools: Array<{ name: string; hash: string }>; mode: string; version: string };
  assert.equal(state.toolsHash, expected);
  assert.equal(state.mode, "benign");
  assert.equal(state.version, "1.0.0");
  for (const tool of buildTools(lab.state)) assert.equal(state.tools.find((x) => x.name === tool.name)?.hash, toolHash(tool));
});

test("benign: server identity comes from LAB_SERVER_NAME and LAB_SERVER_TITLE", async (t) => {
  const lab = await startLab({ serverName: "p4-attack-1ab", serverTitle: "Friendly CRM Helper" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const info = client.getServerVersion();
  assert.equal(info?.name, "p4-attack-1ab");
  assert.equal(info?.title, "Friendly CRM Helper");
  assert.equal(info?.version, "1.0.0");
  assert.ok(lab.events().includes("initialize"));
});
