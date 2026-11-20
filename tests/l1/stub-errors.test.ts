import { test } from "node:test";
import assert from "node:assert/strict";
import { postChat, startStub, type RunningStub } from "./helpers.js";

const userMsg = (content: string) => [{ role: "user", content }];

test("stub negative and routing behaviour", async (t) => {
  let stub: RunningStub;
  stub = await startStub();
  t.after(() => stub.close());
  const { port } = stub;

  await t.test("GET /health returns ok", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '{"status":"ok"}');
  });

  await t.test("unknown path returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(res.status, 404);
  });

  await t.test("unknown fixture id via header returns 404 loudly", async () => {
    const r = await postChat(port, { messages: userMsg("run") }, "does-not-exist");
    assert.equal(r.status, 404);
    assert.match(r.raw, /unknown fixture id: does-not-exist/);
  });

  await t.test("no header and no marker returns 400", async () => {
    const r = await postChat(port, { messages: userMsg("run") });
    assert.equal(r.status, 400);
  });

  await t.test("invalid JSON body returns 400", async () => {
    const r = await postChat(port, "{not json", "smoke-search-001");
    assert.equal(r.status, 400);
    assert.match(r.raw, /not valid JSON/);
  });

  await t.test("stream true returns server-sent events with the same tool call, then [DONE]", async () => {
    const r = await postChat(port, { stream: true, messages: userMsg("run") }, "smoke-search-001");
    assert.equal(r.status, 200);
    assert.match(r.raw, /^data: /);
    assert.ok(r.raw.endsWith("data: [DONE]\n\n"));
    const events = r.raw
      .split("\n\n")
      .filter((e) => e.startsWith("data: {"))
      .map((e) => JSON.parse(e.slice(6)) as { choices: Array<{ delta: Record<string, any>; finish_reason: string | null }> });
    assert.equal(events.length, 2);
    const call = events[0]?.choices[0]?.delta["tool_calls"][0];
    assert.equal(call.function.name, "search_records");
    assert.equal(call.function.arguments, '{"limit":5,"query":"fake-alpha"}');
    assert.equal(events[1]?.choices[0]?.finish_reason, "tool_calls");
  });

  await t.test("stream bytes are identical across requests", async () => {
    const a = await postChat(port, { stream: true, messages: userMsg("run") }, "smoke-search-001");
    const b = await postChat(port, { stream: true, messages: userMsg("run") }, "smoke-search-001");
    assert.equal(a.raw, b.raw);
  });

  await t.test("marker inside an array of text parts is found", async () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "[fixture:smoke-search-001] run" }] }];
    const r = await postChat(port, { messages });
    assert.equal(r.status, 200);
  });

  await t.test("recorder returns tool results and the answered tool calls, and DELETE clears it", async () => {
    await fetch(`http://127.0.0.1:${port}/__trace`, { method: "DELETE" });
    await postChat(port, { messages: userMsg("run") }, "smoke-search-001");
    await postChat(
      port,
      { messages: [...userMsg("run"), { role: "tool", content: "RESULT-TEXT", tool_call_id: "a" }] },
      "smoke-search-001",
    );
    const got = (await (await fetch(`http://127.0.0.1:${port}/__trace`)).json()) as { entries: any[] };
    assert.equal(got.entries.length, 2);
    assert.deepEqual(got.entries[0].toolCalls, [{ name: "search_records", arguments: { query: "fake-alpha", limit: 5 } }]);
    assert.deepEqual(got.entries[1].toolResults, ["RESULT-TEXT"]);
    assert.equal(got.entries[1].content, "Found the fake record.");
    assert.equal(got.entries[0].stream, false);
    assert.deepEqual(got.entries[0].toolsOffered, []);
    await fetch(`http://127.0.0.1:${port}/__trace`, { method: "DELETE" });
    const cleared = (await (await fetch(`http://127.0.0.1:${port}/__trace`)).json()) as { entries: any[] };
    assert.deepEqual(cleared.entries, []);
  });

  await t.test("turn past the end returns 409", async () => {
    const messages = [
      { role: "user", content: "run" },
      { role: "tool", content: "r1", tool_call_id: "a" },
      { role: "tool", content: "r2", tool_call_id: "b" },
      { role: "tool", content: "r3", tool_call_id: "c" },
    ];
    const r = await postChat(port, { messages }, "smoke-search-001");
    assert.equal(r.status, 409);
  });

  await t.test("header selects the fixture and ignores a message marker", async () => {
    const r = await postChat(port, { messages: userMsg("[fixture:other-fixture] run") }, "smoke-search-001");
    assert.equal(r.status, 200);
    assert.match(r.raw, /"name":"search_records"/);
  });

  await t.test("fallback marker gives the same bytes as the header", async () => {
    const viaHeader = await postChat(port, { messages: userMsg("run") }, "smoke-search-001");
    const viaMarker = await postChat(port, { messages: userMsg("[fixture:smoke-search-001] run") });
    assert.equal(viaMarker.status, 200);
    assert.equal(viaMarker.raw, viaHeader.raw);
  });

  await t.test("server binds to 127.0.0.1", () => {
    const addr = stub.server.address();
    assert.ok(addr && typeof addr === "object");
    assert.equal(addr.address, "127.0.0.1");
  });
});

test("continued chat: the latest user message's marker selects the fixture", async (t) => {
  const stub = await startStub();
  t.after(() => stub.close());
  // A second turn of a conversation: the first turn's marker is still in the history. Only the latest marker counts.
  const history = [
    { role: "user", content: "[fixture:smoke-search-001] first" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "[fixture:p4-mcp-meta-006-control] second" },
  ];
  const r = await postChat(stub.port, { messages: history });
  assert.notEqual(r.status, 400, r.raw);
  assert.equal(r.status, 200, r.raw);
});

test("continued chat: two markers in the latest user message are still refused", async (t) => {
  const stub = await startStub();
  t.after(() => stub.close());
  const r = await postChat(stub.port, { messages: [{ role: "user", content: "[fixture:smoke-search-001] [fixture:p4-mcp-meta-006-control] both" }] });
  assert.equal(r.status, 400);
  assert.match(r.raw, /more than one fixture id/);
});
