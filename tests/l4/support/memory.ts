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
