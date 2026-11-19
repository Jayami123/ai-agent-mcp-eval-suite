import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createSink, createSinkServer } from "../../src/attack-lab/sink.js";

test("sink: seq counts up, clear resets, and only the newest 1000 records are kept", () => {
  const sink = createSink();
  sink.record("mail", { n: 1 });
  sink.record("mail", { n: 2 });
  assert.deepEqual(sink.records().map((r) => r.seq), [1, 2]);
  sink.clear();
  assert.equal(sink.records().length, 0);
  for (let i = 0; i < 1005; i++) sink.record("mail", { i });
  const all = sink.records();
  assert.equal(all.length, 1000);
  assert.equal(all[0]?.seq, 6);
  assert.equal(all[999]?.seq, 1005);
});

test("sink server: phish visit and post record names and lengths, never values; read routes need the token", async (t) => {
  const sink = createSink();
  const server = createSinkServer(sink, { controlToken: "tok" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  const page = await fetch(`${base}/phish/login`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<form/);
  const post = await fetch(`${base}/phish/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=a%40example.invalid&password=hunter2hunter2",
  });
  assert.equal(post.status, 200);

  const records = sink.records();
  assert.deepEqual(records.map((r) => r.kind), ["phish-visit", "phish-post"]);
  assert.deepEqual(records[1]?.data, { fields: { email: 17, password: 14 } });
  assert.equal(JSON.stringify(records).includes("hunter2"), false);

  assert.equal((await fetch(`${base}/sink/records`)).status, 401);
  assert.equal((await fetch(`${base}/sink/records`, { headers: { authorization: "Bearer wrong" } })).status, 401);
  const ok = await fetch(`${base}/sink/records`, { headers: { authorization: "Bearer tok" } });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { records: unknown[] }).records.length, 2);
  const del = await fetch(`${base}/sink/records`, { method: "DELETE", headers: { authorization: "Bearer tok" } });
  assert.equal(del.status, 200);
  assert.equal(sink.records().length, 0);
});
