import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanDir } from "../../../src/oracles/leak.js";
import type { L3Stack } from "./stack.js";

// Hygiene for the wave D cases. Each case makes its own data (its own agent, its own conversation, its own addresses). A cleanup
// sweep removes what a case made in the product, and a leak check reads the evidence folder for any secret the run held.
// Both are best effort on the product side (a failed delete is reported, not hidden) and strict on the leak side.

const cleanups: Array<{ label: string; run: () => Promise<void> }> = [];

export function onCleanup(label: string, run: () => Promise<void>): void {
  cleanups.push({ label, run });
}

/** Runs every registered cleanup, newest first, and returns the labels that failed. Never throws. */
export async function sweep(): Promise<string[]> {
  const failed: string[] = [];
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    if (c === undefined) break;
    try {
      await c.run();
    } catch {
      failed.push(c.label);
    }
  }
  return failed;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Registers the removal of a LibreChat agent a case made. DELETE /api/agents/:id as the signed-in owner. */
export function sweepAgent(stack: L3Stack, agentId: string): void {
  onCleanup(`agent ${agentId}`, async () => {
    const res = await fetch(`${stack.session.baseUrl}/api/agents/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
      headers: { authorization: stack.session.authorizationHeader, "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status !== 200 && res.status !== 204) throw new Error(`HTTP ${res.status}`);
  });
}

/**
 * Last test of an entry file: the cleanup sweep, then the leak check over evidence/. The leak check fails on any secret value
 * the run held (the LibreChat bearer, the MCP credentials) or any bearer or key shape. It reports file names and kinds only.
 */
export function registerHygieneTests(secrets: () => string[]): void {
  const skip = process.env["P4_STACK_TESTS"] === "1" ? false : "requires P4_STACK_TESTS=1 (L3 stack job)";
  test("hygiene: cleanup sweep removes what the cases made", { skip }, async () => {
    const failed = await sweep();
    assert.deepEqual(failed, [], `cleanup failed for: ${failed.join(", ")}`);
  });
  test("hygiene: leak check finds no secret in evidence/", { skip }, () => {
    const hits = scanDir(path.resolve(process.cwd(), "evidence"), secrets());
    assert.deepEqual(hits, [], `secret-like content in evidence: ${JSON.stringify(hits)}`);
  });
}
