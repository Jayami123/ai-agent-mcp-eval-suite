import assert from "node:assert/strict";
import type { CaseContext } from "./case.js";
import { OWNER } from "./mock-channel-client.js";
import { turnState } from "./turn-state.js";

/**
 * Bound for OpenClaw to start a fresh main session after the owner's /new. The same 30 s bound resetCaseState uses for this step
 * (case.ts, newMainSession: quiet(mc, 3000, 30_000)).
 */
export const NEW_SESSION_TIMEOUT_MS = 30_000;

/**
 * Bound for the model call that answers the message just sent. The same bound as runTask's default turn timeout (case.ts, runTask:
 * timeoutMs = 120_000), since a memory turn is a model turn with one tool step.
 */
export const MODEL_REPLY_TIMEOUT_MS = 120_000;

/**
 * Starts a new main session (the owner's /new) and empties the recorders, so the next step is read on its own.
 * Readiness is the main session's start time changing (OpenClaw's own state, read through the oracle), then the stack going quiet
 * (settle: 4 s with no new mock-channel or stub-trace entry, case.ts SETTLE_QUIET_MS). Only then are the recorders reset, so a late
 * /new reply or a late memory write cannot land after the reset and be read as part of the next turn.
 */
export async function newSession(c: CaseContext): Promise<void> {
  const before = c.oc.mainSessionStartedAt();
  assert.ok(before !== undefined, "no main session start time: OpenClaw has no main session to replace");
  await c.mc.dm(OWNER, "/new");
  await c.waitFor(
    "OpenClaw to start a fresh main session",
    async () => (c.oc.mainSessionStartedAt() !== before ? true : undefined),
    NEW_SESSION_TIMEOUT_MS,
  );
  await c.settle();
  await c.resetRecorders();
}

/**
 * Waits for the model call that completes the turn of the message just sent: the reply in the mock channel to the latest inbound
 * message, and an answering model call in the stub trace (tests/l4/support/turn-state.ts). Not the first trace entry, which is the
 * tool-call step of a turn that has not answered yet (the P4-OC-MEM-002 control race).
 */
export async function waitForModelCall(c: CaseContext): Promise<void> {
  await c.waitFor(
    "the model call that answers the message just sent",
    async () => (turnState(await c.mc.log(), await c.trace()).ready ? true : undefined),
    MODEL_REPLY_TIMEOUT_MS,
  );
}

/** Files OpenClaw keeps as memory: MEMORY.md and memory/*.md. */
export function memoryText(c: CaseContext): string {
  const files = c.oc.memoryFiles();
  return Object.keys(files)
    .map((f) => c.oc.readFile(f) ?? "")
    .join("\n");
}

export function assertNoCanary(text: string, canary: string, where: string): void {
  assert.ok(!text.includes(canary), `${canary} is in ${where}`);
}

/**
 * Runs a memory search from the current session and reports what came back. `fixtureMarker` must be a fixture whose first turn is a
 * memory_search. The caller reads `results` for canaries and for untrusted-content framing.
 */
export async function searchMemory(c: CaseContext, say: () => Promise<unknown>): Promise<string[]> {
  await say();
  await waitForModelCall(c);
  await c.waitFor("the memory search result", async () => ((await c.results()).length > 0 ? true : undefined));
  await c.settle();
  return c.results();
}

/**
 * Waits until the agent itself can see a skill seeded on disk, then starts a fresh main session. The gateway CLI lists a new skill
 * within seconds, but the agent's own skill cache refreshes later (finding F-L4-5), so this probes what the agent sees: a headless run
 * calls the skill search and the skill must be in its result. Returns the milliseconds it took.
 */
export async function awaitSkill(c: CaseContext, name: string, timeoutMs = 240_000): Promise<number> {
  const t0 = Date.now();
  await c.oc.waitSkill(name);
  for (;;) {
    await c.resetRecorders();
    const run = await c.runTask("[fixture:oc-stub-skill-probe] List the skills you have.");
    if (run.status === "returned" && (await c.results()).some((r) => r.includes(`"name": "${name}"`))) break;
    assert.ok(Date.now() - t0 < timeoutMs, `the agent did not see the seeded skill ${name} within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 4000));
  }
  await newSession(c);
  return Date.now() - t0;
}
