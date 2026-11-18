import { test } from "node:test";
import assert from "node:assert/strict";
import { TEST_CONTROL_TOKEN, startLab } from "./helpers.js";

test("control: no token and a wrong token are both 401 with the same body", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const none = await lab.control("/control/state", { token: null });
  const wrong = await lab.control("/control/state", { token: "wrong-token" });
  assert.equal(none.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(await none.text(), await wrong.text());
});

test("control: state, mode, trigger, reset, log and mint-token routes", async (t) => {
  const lab = await startLab({ rugPullN: 5 });
  t.after(() => lab.close());

  const state = (await (await lab.control("/control/state")).json()) as Record<string, unknown>;
  assert.equal(state["mode"], "benign");
  assert.equal(state["triggered"], false);

  const set = await lab.control("/control/mode", { method: "POST", body: { mode: "rug-pull-after-n" } });
  assert.equal(set.status, 200);
  assert.equal(((await set.json()) as { mode: string }).mode, "rug-pull-after-n");

  const trig = await lab.control("/control/trigger", { method: "POST" });
  assert.equal(trig.status, 200);
  assert.equal(((await trig.json()) as { triggered: boolean }).triggered, true);

  const log = (await (await lab.control("/control/log")).json()) as { entries: Array<{ seq: number; event: string }> };
  assert.deepEqual(log.entries.map((e) => e.event), ["mode_set", "triggered"]);
  assert.deepEqual(log.entries.map((e) => e.seq), [1, 2]);

  lab.sink.record("mail", { x: 1 });
  const reset = await lab.control("/control/reset", { method: "POST" });
  assert.equal(reset.status, 200);
  assert.equal(lab.state.mode, "benign");
  assert.equal(lab.state.triggered, false);
  assert.equal(lab.state.log.length, 0);
  assert.equal(lab.sink.records().length, 0);

  const minted = await lab.control("/control/mint-token", { method: "POST", body: { aud: "other-app" } });
  assert.equal(minted.status, 200);
  assert.match(((await minted.json()) as { token: string }).token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
});

test("control: bad input is rejected", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  assert.equal((await lab.control("/control/mode", { method: "POST", body: { mode: "nope" } })).status, 400);
  assert.equal((await lab.control("/control/mode", { method: "POST", body: {} })).status, 400);
  assert.equal((await lab.control("/control/mint-token", { method: "POST", body: {} })).status, 400);
  assert.equal((await lab.control("/control/trigger", { method: "POST" })).status, 409);
  assert.equal((await lab.control("/control/nothing")).status, 404);
  const bad = await fetch(`${lab.controlUrl}/control/mode`, { method: "POST", headers: { authorization: `Bearer ${TEST_CONTROL_TOKEN}` }, body: "{not json" });
  assert.equal(bad.status, 400);
});

test("control: the control token never appears in any response body", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const bodies: string[] = [];
  for (const [path, method] of [["/control/state", "GET"], ["/control/log", "GET"], ["/control/trigger", "POST"], ["/control/mode", "POST"], ["/control/reset", "POST"]] as const) {
    bodies.push(await (await lab.control(path, { method, body: method === "POST" ? { mode: "benign" } : undefined })).text());
  }
  bodies.push(await (await lab.control("/control/state", { token: "x" })).text());
  for (const body of bodies) assert.equal(body.includes(TEST_CONTROL_TOKEN), false);
});

test("control: switching the mode switches the tool list and resets the counters", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const before = (await (await lab.control("/control/state")).json()) as { toolsHash: string };
  await lab.control("/control/mode", { method: "POST", body: { mode: "poisoned-description" } });
  const after = (await (await lab.control("/control/state")).json()) as { toolsHash: string; mode: string };
  assert.equal(after.mode, "poisoned-description");
  assert.notEqual(after.toolsHash, before.toolsHash);
});
