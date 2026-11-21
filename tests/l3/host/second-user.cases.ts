import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { LAB, labLog, resetLab } from "../support/lab.js";
import { McpHttpClient } from "../support/mcp-client.js";

// Second-user cases on the attack-lab. The lab runs without LAB_AUTH, so the two users are two MCP sessions. Each session gets
// its own store scope from the SDK (src/attack-lab/server.ts, one InMemoryTaskStore shared by every session). The rule under test
// is that a session cannot read, fetch the result of, or cancel a task that another session created.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const TASK_WAIT_MS = 10_000;

/** The JSON-RPC reply of a task request: a result, or an error. */
const isRefused = (body: unknown) => (body as { error?: unknown; result?: unknown }).error !== undefined && (body as { result?: unknown }).result === undefined;
const taskStatus = (body: unknown) => (body as { result?: { status?: unknown } }).result?.status;
const taskSum = (body: unknown) => (body as { result?: { structuredContent?: { sum?: unknown } } }).result?.structuredContent?.sum;

l3Case("P4-MCP-REL-002", "tasks ownership: a second user cannot poll, read or cancel the first user's task", async (ctx) => {
  await resetLab();
  try {
    // User A creates a task; user B is a second session on the same lab.
    const a = new McpHttpClient(LAB.mcp, null);
    await a.initialize();
    const b = new McpHttpClient(LAB.mcp, null);
    await b.initialize();
    const created = await a.post({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "lab_add", arguments: { a: 1, b: 2 }, task: { ttl: 60_000 } } });
    const taskId = (created.body as { result?: { task?: { taskId?: unknown } } }).result?.task?.taskId;
    ctx.check(typeof taskId === "string" && taskId.length > 0 ? pass("user A created a task (task-augmented tools/call)") : fail("the lab did not create a task for user A"));
    if (typeof taskId !== "string") return;

    // Wait (bounded) for the background tool to finish, then read A's own task: the control.
    const deadline = Date.now() + TASK_WAIT_MS;
    let ownStatus: unknown;
    let ownBody: unknown;
    do {
      ownBody = (await a.post({ jsonrpc: "2.0", id: 11, method: "tasks/get", params: { taskId } })).body;
      ownStatus = taskStatus(ownBody);
      if (ownStatus === "completed" || Date.now() >= deadline) break;
      await sleep(200);
    } while (true);
    ctx.check(ownStatus === "completed" ? pass("control: user A reads its own task and sees it completed") : fail(`control: user A's task status is ${String(ownStatus)}`));

    // User B tries the three task operations on A's task. Each must be refused and carry no task data.
    const bGet = (await b.post({ jsonrpc: "2.0", id: 20, method: "tasks/get", params: { taskId } })).body;
    const bResult = (await b.post({ jsonrpc: "2.0", id: 21, method: "tasks/result", params: { taskId } })).body;
    const bCancel = (await b.post({ jsonrpc: "2.0", id: 22, method: "tasks/cancel", params: { taskId } })).body;
    ctx.check(isRefused(bGet) ? pass("user B's tasks/get on A's task is refused") : fail("user B could read A's task (tasks/get answered with a result)"));
    ctx.check(isRefused(bResult) ? pass("user B's tasks/result on A's task is refused") : fail("user B could fetch A's task result"));
    ctx.check(isRefused(bCancel) ? pass("user B's tasks/cancel on A's task is refused") : fail("user B could cancel A's task"));

    // A's task is unchanged by B's attempts: still completed, same sum.
    const after = (await a.post({ jsonrpc: "2.0", id: 30, method: "tasks/get", params: { taskId } })).body;
    const sum = (await a.post({ jsonrpc: "2.0", id: 31, method: "tasks/result", params: { taskId } })).body;
    ctx.check(taskStatus(after) === "completed" && taskSum(sum) === 3 ? pass("user A's task is unchanged after B's attempts (completed, sum 3)") : fail(`user A's task changed: status ${String(taskStatus(after))}, sum ${String(taskSum(sum))}`));

    const log = await labLog();
    ctx.check(log.filter((e) => e.event === "task_created").length === 1 ? pass("the lab created exactly one task (B created none)") : fail("the lab's task count is not one"));
  } finally {
    await resetLab();
  }
});

l3Case(
  "P4-MCP-INJ-016",
  "a message planted in a second session is not shown to the first user's products (shared view)",
  async () => {
    throw new Error("P4-MCP-INJ-016 is a registered blocker; this body does not run.");
  },
  {
    blocker:
      "the lab keeps its sink and log per lab, not per session, so a message planted in session 2 is not visible to session 1 by design; the case needs a shared product view that the lab does not have (decision D4 in docs/plans/2026-11-21-l3-second-user.md)",
  },
);
