import type { StubTraceEntryLike } from "../../../src/stats/index.js";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createStubServer } from "../../../src/stub/server.js";

export const FIXTURES_DIR = path.resolve(process.cwd(), "src/stub/fixtures");

export interface RunningStub {
  server: Server;
  port: number;
  close(): Promise<void>;
}

/** In-process stub on 127.0.0.1 with an ephemeral port. A copy of the L1 helper so L5 does not import from tests/l1. */
export async function startStub(): Promise<RunningStub> {
  const server = createStubServer({ fixturesDir: FIXTURES_DIR, port: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { server, port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/**
 * POST one request for a fixture (header selector), then read the recorder (GET /__trace) and clear it.
 * Returns the recorder entries and the response `model`. Uses fetch only against 127.0.0.1.
 */
export async function runFixtureOnce(port: number, fixtureId: string): Promise<{ entries: StubTraceEntryLike[]; servedModelId: string; latencyMs: number }> {
  const base = `http://127.0.0.1:${port}`;
  await fetch(`${base}/__trace`, { method: "DELETE" });
  const started = performance.now();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-p4-fixture": fixtureId },
    body: JSON.stringify({ model: "p4-stub", messages: [{ role: "user", content: "run" }] }),
  });
  const latencyMs = Math.round(performance.now() - started);
  const body = (await res.json()) as { model?: unknown };
  if (res.status !== 200 || typeof body.model !== "string") throw new Error(`stub answered HTTP ${res.status} without a model`);
  const trace = (await (await fetch(`${base}/__trace`)).json()) as { entries: StubTraceEntryLike[] };
  return { entries: trace.entries, servedModelId: body.model, latencyMs };
}
