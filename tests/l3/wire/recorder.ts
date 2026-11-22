import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Reads the MCP recorder (H9) log. The recorder is a container that writes one redacted JSON line per record to stdout
// (harness src/mcp-recorder/main.ts lines 13-18). The adapter prints its name in the stack log (librechat.adapter.ts line 199).
// Records are read by time (`docker logs --since`), never by matching text. Nothing here prints a body or a header value.

/** Bound on one docker call. Basis: the log of one case is a few hundred lines, so the read is short. Not measured yet (see the plan, section 7). */
export const RECORDER_READ_TIMEOUT_MS = 60_000;
/** Largest log read. Basis: 64 MiB, far above a case's few hundred lines, so a read is never silently cut. */
export const RECORDER_MAX_BUFFER = 64 * 1024 * 1024;
/** The container's name contains this (compose service mcp-recorder, harness docker/librechat.recording.compose.yml). */
export const RECORDER_NAME_FILTER = "mcp-recorder";

export type RecordLine = Record<string, unknown>;

/** Parses JSON lines. A line that is not a JSON object is skipped (the recorder's own status goes to stderr, not here). */
export function parseRecorderLines(text: string): RecordLine[] {
  const out: RecordLine[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || !t.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(t) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) out.push(parsed as RecordLine);
    } catch {
      // not a record
    }
  }
  return out;
}

/**
 * The MCP tools called through one route, in order. Only `request` records whose JSON-RPC method is `tools/call` count, and the
 * name is `params.name`. A redacted body that does not parse as JSON contributes nothing.
 */
export function toolCallsOn(records: readonly RecordLine[], server: string): string[] {
  return records.flatMap((r) => {
    if (r["kind"] !== "request" || r["server"] !== server || typeof r["body"] !== "string") return [];
    try {
      const body = JSON.parse(r["body"]) as { method?: unknown; params?: { name?: unknown } };
      return body.method === "tools/call" && typeof body.params?.name === "string" ? [body.params.name] : [];
    } catch {
      return [];
    }
  });
}

/** The recorder's container name, found at run time. Throws if there is none (the recording switch is off, or the stack is down). */
export async function recorderContainer(): Promise<string> {
  const { stdout } = await promisify(execFile)("docker", ["ps", "--filter", `name=${RECORDER_NAME_FILTER}`, "--format", "{{.Names}}"], {
    timeout: RECORDER_READ_TIMEOUT_MS,
  });
  const name = stdout.split("\n").map((s) => s.trim()).find((s) => s !== "");
  if (name === undefined) throw new Error("RECORDER_NOT_RUNNING: no mcp-recorder container (is LIBRECHAT_MCP_RECORDING=1 set?)");
  return name;
}

/** Records written since `sinceIso` (an RFC 3339 time, read before the chat starts). */
export async function recorderRecords(sinceIso: string): Promise<RecordLine[]> {
  const name = await recorderContainer();
  const { stdout } = await promisify(execFile)("docker", ["logs", "--since", sinceIso, name], {
    timeout: RECORDER_READ_TIMEOUT_MS,
    maxBuffer: RECORDER_MAX_BUFFER,
  });
  return parseRecorderLines(stdout);
}
