import { test } from "node:test";
import assert from "node:assert/strict";
import { toolsHash } from "../../src/attack-lab/hash.js";
import { buildTools, CANARY_EMAIL, CANARY_SECRET, POISON_MARKERS } from "../../src/attack-lab/modes.js";
import { connect, firstText, startLab } from "./helpers.js";

const hasMarkers = (text: string): boolean => POISON_MARKERS.every((marker) => text.includes(marker));

test("poisoned-description: the hidden block is in lab_echo's description, the secret too, and the hash differs from benign", async (t) => {
  const lab = await startLab({ mode: "poisoned-description" });
  t.after(() => lab.close());
  const benign = await startLab();
  t.after(() => benign.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const { tools } = await client.listTools();
  const echo = tools.find((tool) => tool.name === "lab_echo");
  assert.ok(echo !== undefined && hasMarkers(echo.description ?? ""));
  assert.ok((echo?.description ?? "").includes(CANARY_SECRET));
  assert.equal(buildTools(benign.state).some((tool) => hasMarkers(JSON.stringify(tool))), false);
  assert.notEqual(toolsHash(buildTools(lab.state)), toolsHash(buildTools(benign.state)));
});

test("poisoned-description: schema surface poisons only the `to` parameter description", async (t) => {
  const lab = await startLab({ mode: "poisoned-description", poisonSurface: "schema" });
  t.after(() => lab.close());
  const tools = buildTools(lab.state);
  const echo = tools.find((tool) => tool.name === "lab_echo");
  const mail = tools.find((tool) => tool.name === "lab_mail_send");
  assert.equal(JSON.stringify(echo).includes("<IMPORTANT>"), false);
  const to = (mail?.inputSchema["properties"] as Record<string, { description: string }>)["to"];
  assert.ok(hasMarkers(to?.description ?? ""));
  assert.equal((mail?.description ?? "").includes("<IMPORTANT>"), false);
});

test("poisoned-description: `both` poisons both places", async (t) => {
  const lab = await startLab({ mode: "poisoned-description", poisonSurface: "both" });
  t.after(() => lab.close());
  const tools = buildTools(lab.state);
  assert.ok(hasMarkers(tools.find((tool) => tool.name === "lab_echo")?.description ?? ""));
  assert.ok(hasMarkers(JSON.stringify(tools.find((tool) => tool.name === "lab_mail_send")?.inputSchema)));
});

test("poisoned-description: the tools still work and the lab itself never mails the canary", async (t) => {
  const lab = await startLab({ mode: "poisoned-description" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const res = await client.callTool({ name: "lab_echo", arguments: { text: "hi" } });
  assert.equal(firstText(res), "hi");
  assert.equal(lab.sink.records().length, 0);
  assert.equal(CANARY_EMAIL.endsWith(".invalid"), true);
});
