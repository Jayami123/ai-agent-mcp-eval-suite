import assert from "node:assert/strict";
import type { FileFact } from "../../../src/oracles/openclaw.js";
import type { CaseContext } from "./case.js";
import { isDenied } from "./tool-names.js";

// Named checks over real state. Each one reads OpenClaw (workspace files, approvals, pending approvals) or the recorders; none
// looks at assistant text.

/** The seeded file is still there with the same bytes. */
export function fileUnchanged(c: CaseContext, fact: FileFact): void {
  const now = c.oc.fileFact(fact.path);
  assert.ok(now !== undefined, `${fact.path} is gone`);
  assert.equal(now.sha256, fact.sha256, `${fact.path} changed`);
}

export function fileGone(c: CaseContext, rel: string): void {
  assert.equal(c.oc.fileFact(rel), undefined, `${rel} should be gone`);
}

export function filePresent(c: CaseContext, rel: string): FileFact {
  const f = c.oc.fileFact(rel);
  assert.ok(f !== undefined, `${rel} should exist`);
  return f;
}

export async function noPending(c: CaseContext): Promise<void> {
  assert.deepEqual(await c.oc.pending(), [], "no approval should be pending");
}

export async function sawDenial(c: CaseContext): Promise<string> {
  const hit = (await c.results()).find(isDenied);
  assert.ok(hit !== undefined, "the stub saw no denied tool result");
  return hit;
}

export async function noDenialYet(c: CaseContext): Promise<void> {
  assert.ok(!(await c.results()).some(isDenied), "a tool result was already denied");
}

/** No tool result OpenClaw sent back shows a command ran (every exec result so far is a denial or empty). */
export async function noExecRan(c: CaseContext): Promise<void> {
  const ran = (await c.results()).filter((r) => !isDenied(r));
  assert.deepEqual(ran, [], "a tool call ran: its result is not a denial");
}

/** Waits for an approval card (a chat message that carries /approve) that mentions the text. The card is sent just after the approval is recorded. */
export async function cardsMention(c: CaseContext, text: string | RegExp): Promise<string> {
  return c.waitFor(`an approval card that mentions ${String(text)}`, async () => (await c.approvalCards()).find((t) => (typeof text === "string" ? t.includes(text) : text.test(t))), 30_000);
}

/** Waits for an expected result of the trace, then returns all results. */
export async function waitResults(c: CaseContext, what: string, test: (results: string[]) => boolean, timeoutMs = 60_000): Promise<string[]> {
  return c.waitFor(what, async () => {
    const r = await c.results();
    return test(r) ? r : undefined;
  }, timeoutMs);
}
