import { test } from "node:test";
import assert from "node:assert/strict";
import { postChat, startStub } from "../../l1/helpers.js";

const post = (port: number, method: string, body?: unknown): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/__watch`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

test("stub watch: a request that carries a watched value is recorded with its label, never the value", async () => {
  const stub = await startStub();
  try {
    assert.equal((await post(stub.port, "POST", { secret: "CANARY-watch-value-1" })).status, 200);
    await postChat(stub.port, { messages: [{ role: "user", content: "hello CANARY-watch-value-1 [fixture:smoke-search-001]" }] });
    await postChat(stub.port, { messages: [{ role: "user", content: "nothing here [fixture:smoke-search-001]" }] });
    const raw = await (await fetch(`http://127.0.0.1:${stub.port}/__trace`)).text();
    assert.ok(!raw.includes("CANARY-watch-value-1"), "the watched value must not appear in the recorder");
    const entries = (JSON.parse(raw) as { entries: Array<{ promptHits: string[] }> }).entries;
    assert.deepEqual(entries.map((e) => e.promptHits), [["secret"], []]);
  } finally {
    await stub.close();
  }
});

test("stub watch: tool result messages count, and DELETE clears the watch", async () => {
  const stub = await startStub();
  try {
    await post(stub.port, "POST", { secret: "CANARY-watch-value-2" });
    await postChat(stub.port, { messages: [{ role: "user", content: "[fixture:smoke-search-001]" }, { role: "tool", content: "result CANARY-watch-value-2" }] });
    assert.equal((await post(stub.port, "DELETE")).status, 200);
    await postChat(stub.port, { messages: [{ role: "user", content: "[fixture:smoke-search-001] CANARY-watch-value-2" }] });
    const entries = ((await (await fetch(`http://127.0.0.1:${stub.port}/__trace`)).json()) as { entries: Array<{ promptHits: string[] }> }).entries;
    assert.deepEqual(entries.map((e) => e.promptHits), [["secret"], []]);
  } finally {
    await stub.close();
  }
});

test("stub watch: a body that is not JSON is a 400 and short values are ignored", async () => {
  const stub = await startStub();
  try {
    const bad = await fetch(`http://127.0.0.1:${stub.port}/__watch`, { method: "POST", body: "{nope" });
    assert.equal(bad.status, 400);
    const ok = await post(stub.port, "POST", { tiny: "abc" });
    assert.deepEqual(await ok.json(), { count: 0 });
  } finally {
    await stub.close();
  }
});

test("stub marker: the same id written with markdown escapes is still one id", async () => {
  const stub = await startStub();
  try {
    const r = await postChat(stub.port, { messages: [{ role: "user", content: "[fixture:smoke-search-001] hi" }, { role: "user", content: "quoted: \\[fixture:smoke-search-001\\] hi" }] });
    assert.equal(r.status, 200);
    const two = await postChat(stub.port, { messages: [{ role: "user", content: "[fixture:smoke-search-001]" }, { role: "user", content: "[fixture:oc-rel-004]" }] });
    assert.equal(two.status, 400, "two different ids are still refused");
  } finally {
    await stub.close();
  }
});
