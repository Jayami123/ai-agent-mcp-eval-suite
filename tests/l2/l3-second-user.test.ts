import { test } from "node:test";
import assert from "node:assert/strict";
import { createLab, type RunningLab } from "../../src/attack-lab/server.js";
import { configFromEnv } from "../../src/attack-lab/modes.js";

// Unit tests for the lab's task support (L3 second-user cases, REL-002). The lab runs in process on loopback ports chosen by
// the OS. Two MCP sessions stand for two users: the SDK's task store scopes each lookup by session id, and these tests check
// that the lab uses that scoping. No network beyond loopback, no secret.

const CONTROL_TOKEN = "test-control-token-second-user";

interface Session {
  post(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

async function openSession(url: string): Promise<Session> {
  let sid: string | null = null;
  let id = 1;
  const send = async (body: unknown): Promise<{ status: number; text: string; sid: string | null }> => {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (sid !== null) headers["mcp-session-id"] = sid;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, text: await res.text(), sid: res.headers.get("mcp-session-id") };
  };
  const first = await send({ jsonrpc: "2.0", id: id++, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "p4-l3-test", version: "0" } } });
  sid = first.sid;
  await send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  return {
    post: async (method, params) => {
      const reply = await send({ jsonrpc: "2.0", id: id++, method, params });
      const line = reply.text.split("\n").find((l) => l.startsWith("data:"));
      return JSON.parse(line === undefined ? reply.text : line.slice("data:".length)) as Record<string, unknown>;
    },
  };
}

async function withLab(run: (lab: RunningLab) => Promise<void>): Promise<void> {
  const lab = await createLab({ config: configFromEnv({}), controlToken: CONTROL_TOKEN, host: "127.0.0.1", ports: { mcp: 0, control: 0, sink: 0 } });
  try {
    await run(lab);
  } finally {
    await lab.close();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the tasks capability is advertised for tools/call", async () => {
  await withLab(async (lab) => {
    const s = await openSession(lab.mcpUrl);
    const tools = await s.post("tools/list", {});
    assert.ok(tools["result"], "tools/list answers");
    const init = await fetch(lab.mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "p4-l3-test", version: "0" } } }),
    });
    const text = await init.text();
    assert.match(text, /"tasks":\{/, "initialize advertises tasks");
    assert.match(text, /"requests":\{"tools":\{"call"/, "tools/call is task-capable");
  });
});

test("a task created in one session is completed for that session with the tool's result", async () => {
  await withLab(async (lab) => {
    const a = await openSession(lab.mcpUrl);
    const created = await a.post("tools/call", { name: "lab_add", arguments: { a: 1, b: 2 }, task: { ttl: 60_000 } });
    const taskId = (created["result"] as { task: { taskId: string } }).task.taskId;
    assert.ok(taskId.length > 0, "the create reply carries a task id");
    await sleep(300);
    const got = await a.post("tasks/get", { taskId });
    assert.equal((got["result"] as { status: string }).status, "completed");
    const result = await a.post("tasks/result", { taskId });
    assert.equal((result["result"] as { structuredContent: { sum: number } }).structuredContent.sum, 3);
    assert.equal(lab.state.log.filter((e) => e.event === "task_created").length, 1);
  });
});

test("another session cannot read, fetch the result of, or cancel a task it did not create", async () => {
  await withLab(async (lab) => {
    const a = await openSession(lab.mcpUrl);
    const b = await openSession(lab.mcpUrl);
    const created = await a.post("tools/call", { name: "lab_add", arguments: { a: 4, b: 5 }, task: { ttl: 60_000 } });
    const taskId = (created["result"] as { task: { taskId: string } }).task.taskId;
    await sleep(300);
    for (const method of ["tasks/get", "tasks/result", "tasks/cancel"]) {
      const reply = await b.post(method, { taskId });
      assert.equal(reply["result"], undefined, `${method} from the other session gives no result`);
      assert.ok(reply["error"], `${method} from the other session is refused`);
    }
    // The owner's task is unchanged by the refused cancel.
    const own = await a.post("tasks/get", { taskId });
    assert.equal((own["result"] as { status: string }).status, "completed");
    const sum = await a.post("tasks/result", { taskId });
    assert.equal((sum["result"] as { structuredContent: { sum: number } }).structuredContent.sum, 9);
  });
});
