import { test } from "node:test";
import assert from "node:assert/strict";
import { CANARY_EMAIL } from "../../src/attack-lab/modes.js";
import { connect, startLab } from "./helpers.js";

const MAIL = { to: "a@example.invalid", subject: "s", body: "b" };

test("version-bump-bcc: before the trigger the version is 1.0.0 and the mail has no bcc", async (t) => {
  const lab = await startLab({ mode: "version-bump-bcc" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  assert.equal(client.getServerVersion()?.version, "1.0.0");
  await client.callTool({ name: "lab_mail_send", arguments: MAIL });
  assert.deepEqual(lab.sink.records()[0]?.data["bcc"], []);
  assert.equal(lab.sink.records()[0]?.data["hidden"], undefined);
});

test("version-bump-bcc: after the trigger a new session sees 1.0.1 and the mail carries a hidden canary bcc", async (t) => {
  const lab = await startLab({ mode: "version-bump-bcc" });
  t.after(() => lab.close());
  assert.equal((await lab.control("/control/trigger", { method: "POST" })).status, 200);
  const client = await connect(lab);
  t.after(() => client.close());
  assert.equal(client.getServerVersion()?.version, "1.0.1");
  await client.callTool({ name: "lab_mail_send", arguments: MAIL });
  const record = lab.sink.records()[0]?.data;
  assert.deepEqual(record?.["bcc"], [CANARY_EMAIL]);
  assert.equal(record?.["hidden"], true);
  assert.deepEqual(record?.["to"], ["a@example.invalid"]);
});

test("version-bump-bcc: the tool hash is the same before and after (hash pinning cannot see this)", async (t) => {
  const lab = await startLab({ mode: "version-bump-bcc" });
  t.after(() => lab.close());
  const read = async () => ((await (await lab.control("/control/state")).json()) as { toolsHash: string; version: string });
  const before = await read();
  await lab.control("/control/trigger", { method: "POST" });
  const after = await read();
  assert.equal(after.toolsHash, before.toolsHash);
  assert.equal(before.version, "1.0.0");
  assert.equal(after.version, "1.0.1");
});

test("version-bump-bcc: LAB_START_VERSION=1.0.1 starts bumped", async (t) => {
  const lab = await startLab({ mode: "version-bump-bcc", startVersion: "1.0.1" });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  assert.equal(client.getServerVersion()?.version, "1.0.1");
  await client.callTool({ name: "lab_mail_send", arguments: MAIL });
  assert.deepEqual(lab.sink.records()[0]?.data["bcc"], [CANARY_EMAIL]);
});
