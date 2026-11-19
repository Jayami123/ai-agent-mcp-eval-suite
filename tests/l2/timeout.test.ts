import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { connect, startLab } from "./helpers.js";

const TIMEOUT_MS = 400;

test("timeout: an unaborted call takes at least 400 ms, then completes", async (t) => {
  const lab = await startLab({ mode: "timeout", timeoutMs: TIMEOUT_MS });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const started = performance.now();
  const result = await client.callTool({ name: "lab_add", arguments: { a: 1, b: 2 } });
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 400, `the call took ${elapsed.toFixed(1)} ms, expected at least 400`);
  assert.ok(elapsed < 5000, `the call took ${elapsed.toFixed(1)} ms, expected under 5000`);
  assert.deepEqual(result.structuredContent, { sum: 3 });
  assert.deepEqual(lab.events().filter((event) => event.startsWith("call_")), ["call_started", "call_completed"]);
});

test("timeout: a call the client aborts is logged as started then aborted, never completed, and writes nothing", async (t) => {
  const lab = await startLab({ mode: "timeout", timeoutMs: TIMEOUT_MS });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const controller = new AbortController();
  const pending = client.callTool({ name: "lab_add", arguments: { a: 1, b: 2 } }, undefined, { signal: controller.signal });
  await sleep(100);
  controller.abort();
  await assert.rejects(pending);
  for (let i = 0; i < 40 && !lab.events().includes("call_aborted"); i++) await sleep(50);
  await sleep(TIMEOUT_MS); // long enough that a completed call would have been logged
  assert.deepEqual(lab.events().filter((event) => event.startsWith("call_")), ["call_started", "call_aborted"]);
  assert.equal(lab.sink.records().length, 0);
});

test("timeout: other tools are not delayed", async (t) => {
  const lab = await startLab({ mode: "timeout", timeoutMs: 60_000 });
  t.after(() => lab.close());
  const client = await connect(lab);
  t.after(() => client.close());
  const started = performance.now();
  await client.callTool({ name: "lab_echo", arguments: { text: "fast" } });
  assert.ok(performance.now() - started < 2000);
});
