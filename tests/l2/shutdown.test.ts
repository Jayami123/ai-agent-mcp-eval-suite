import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { installShutdown, type ShutdownProcess } from "../../src/attack-lab/shutdown.js";

type Listener = () => void;
function fakeProcess(): ShutdownProcess & { emit(signal: "SIGTERM" | "SIGINT"): void } {
  const listeners = new Map<string, Listener[]>();
  return {
    once(signal, listener) {
      listeners.set(signal, [...(listeners.get(signal) ?? []), listener]);
    },
    emit(signal) {
      for (const listener of listeners.get(signal) ?? []) listener();
    },
  };
}

test("shutdown: SIGTERM and SIGINT each close the servers once, then exit 0", async () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const proc = fakeProcess();
    const codes: number[] = [];
    let closed = 0;
    installShutdown(async () => { closed += 1; }, { proc, exit: (code) => codes.push(code), timeoutMs: 1000 });
    proc.emit(signal);
    proc.emit("SIGTERM"); // a second signal while shutting down is ignored
    await sleep(20);
    assert.equal(closed, 1, signal);
    assert.deepEqual(codes, [0], signal);
  }
});

test("shutdown: a close that fails exits 1", async () => {
  const proc = fakeProcess();
  const codes: number[] = [];
  installShutdown(async () => { throw new Error("boom"); }, { proc, exit: (code) => codes.push(code), timeoutMs: 1000 });
  proc.emit("SIGTERM");
  await sleep(20);
  assert.deepEqual(codes, [1]);
});

test("shutdown: a close that hangs is cut off by the fallback and exits 1", async () => {
  const proc = fakeProcess();
  const codes: number[] = [];
  installShutdown(() => new Promise<void>(() => undefined), { proc, exit: (code) => codes.push(code), timeoutMs: 50 });
  proc.emit("SIGINT");
  await sleep(10);
  assert.deepEqual(codes, []);
  await sleep(100);
  assert.deepEqual(codes, [1]);
});

test("shutdown: the real process exits 0 on SIGTERM within 2 seconds and frees its ports", async () => {
  const main = path.resolve(process.cwd(), "dist-test/src/attack-lab/main.js");
  const env = { ...process.env, LAB_MCP_PORT: "0", LAB_CONTROL_PORT: "0", LAB_SINK_PORT: "0", LAB_CONTROL_TOKEN: "shutdown-test-token-0000" };
  const child = spawn(process.execPath, [main], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  let url: string | undefined;
  for (let i = 0; i < 100 && url === undefined; i++) {
    url = /listening on (\S+)/.exec(out)?.[1];
    if (url === undefined) await sleep(50);
  }
  assert.ok(url !== undefined, "the lab did not start");
  assert.equal((await fetch(url.replace("/mcp", "/.well-known/oauth-protected-resource"))).status, 200);

  const started = Date.now();
  child.kill("SIGTERM");
  const result = await Promise.race([exited, sleep(5000).then(() => "timeout" as const)]);
  assert.notEqual(result, "timeout", "the process did not exit");
  assert.deepEqual(result, { code: 0, signal: null });
  assert.ok(Date.now() - started < 2000, `took ${String(Date.now() - started)} ms`);
  await assert.rejects(fetch(url), "the MCP port should be closed");
});
