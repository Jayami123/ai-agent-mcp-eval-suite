import { writeEvidence } from "./evidence.js";

// Client for the stub container's recorder (GET/DELETE http://127.0.0.1:8787/__trace). The stub runs as a container on
// qa-harness-p4 (npm run stub:up). Tests never start or stop it; they fail closed when it is not there.

export const STUB_HOST_URL = "http://127.0.0.1:8787";
/** LiteLLM reaches the stub by its alias on qa-harness-p4. */
export const STUB_UPSTREAM_URL = "http://p4-stub:8787/v1";

export interface StubTraceEntry {
  seq: number;
  fixture: string;
  turn: number;
  toolsOffered: string[];
  stream: boolean;
  toolResults: string[];
  toolCalls: Array<{ name: string; arguments: unknown }>;
  content: string | null;
}

export async function requireStubContainer(): Promise<void> {
  let status = "no response";
  try {
    const res = await fetch(`${STUB_HOST_URL}/health`, { signal: AbortSignal.timeout(5000) });
    status = `HTTP ${res.status}`;
    if (res.status === 200) return;
  } catch (err) {
    status = (err as Error).name;
  }
  throw new Error(`STUB_CONTAINER_MISSING: ${STUB_HOST_URL}/health did not answer 200 (${status}). Run npm run build && npm run stub:up first.`);
}

export async function resetStubTrace(): Promise<void> {
  const res = await fetch(`${STUB_HOST_URL}/__trace`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`stub recorder DELETE returned HTTP ${res.status}`);
}

export async function readStubTrace(fixture: string): Promise<StubTraceEntry[]> {
  const res = await fetch(`${STUB_HOST_URL}/__trace`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`stub recorder GET returned HTTP ${res.status}`);
  const body = (await res.json()) as { entries: StubTraceEntry[] };
  return body.entries.filter((e) => e.fixture === fixture);
}

/** Writes the whole recorder to evidence, also after a failed run. Never throws. */
export async function writeTraceEvidence(dir: string): Promise<void> {
  try {
    const res = await fetch(`${STUB_HOST_URL}/__trace`, { signal: AbortSignal.timeout(5000) });
    writeEvidence(dir, "stub-trace-all.json", `${await res.text()}\n`);
  } catch (err) {
    writeEvidence(dir, "stub-trace-all.json", `recorder not readable: ${(err as Error).name}\n`);
  }
}

/**
 * Sends the run's real values for fixture placeholders ("{{bind:NAME}}"). The stub replaces the whole set. Values are ids
 * and labels; they are not secrets and the stub does not log them.
 */
export async function setStubBindings(values: Record<string, string>): Promise<void> {
  const res = await fetch(`${STUB_HOST_URL}/__bindings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(values),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`stub bindings PUT returned HTTP ${res.status}`);
}

export async function clearStubBindings(): Promise<void> {
  const res = await fetch(`${STUB_HOST_URL}/__bindings`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`stub bindings DELETE returned HTTP ${res.status}`);
}
