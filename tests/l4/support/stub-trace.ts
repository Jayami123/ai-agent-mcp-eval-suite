import { readStubTrace, requireStubContainer, resetStubTrace as l1ResetStubTrace, STUB_HOST_URL, type StubTraceEntry } from "../../l1/stub-recorder.js";

export { requireStubContainer };

/** The L1 recorder row plus the field Step 0 added to the stub. */
export interface L4TraceEntry extends StubTraceEntry {
  error?: number | "closed" | null;
  /** Labels of watched canaries that appeared in any message of the request (see watchPrompt). */
  promptHits?: string[];
}

/** The stub closes idle keep-alive connections after 5 s, so a client that polls it sometimes meets a closed socket. Retry that. */
async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw last;
}

export const resetStubTrace = (): Promise<void> => retrying(l1ResetStubTrace);

export async function traceFor(fixture: string): Promise<L4TraceEntry[]> {
  return retrying(async () => (await readStubTrace(fixture)) as L4TraceEntry[]);
}

export async function traceAll(): Promise<L4TraceEntry[]> {
  return retrying(async () => {
    const res = await fetch(`${STUB_HOST_URL}/__trace`, { signal: AbortSignal.timeout(5000) });
    return ((await res.json()) as { entries: L4TraceEntry[] }).entries;
  });
}

/** Register canary values with the stub recorder. Each later request lists the labels whose value it carried. */
export async function watchPrompt(values: Record<string, string>): Promise<void> {
  await retrying(async () => {
    await fetch(`${STUB_HOST_URL}/__watch`, { method: "POST", body: JSON.stringify(values), signal: AbortSignal.timeout(5000) });
  });
}

export async function clearWatch(): Promise<void> {
  await retrying(async () => {
    await fetch(`${STUB_HOST_URL}/__watch`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  });
}
