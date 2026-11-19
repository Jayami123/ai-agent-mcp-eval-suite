import assert from "node:assert/strict";
import type { CaseContext } from "./case.js";
import { OWNER } from "./mock-channel-client.js";

/** Starts a new main session (the owner's /new) and empties the recorders, so the next step is read on its own. */
export async function newSession(c: CaseContext): Promise<void> {
  await c.mc.dm(OWNER, "/new");
  await c.settle(2500);
  await c.resetRecorders();
}

/** Waits until the model host has been called at least once since the recorders were reset. */
export async function waitForModelCall(c: CaseContext): Promise<void> {
  await c.waitFor("a request to reach the model host", async () => ((await c.trace()).length > 0 ? true : undefined));
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
