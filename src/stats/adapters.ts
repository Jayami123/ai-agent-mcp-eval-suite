import type { StateSnapshot, TrialRecord, TraceProfile } from "./schema.js";
import { validateTrial } from "./schema.js";
import type { TrialStatus } from "./status.js";

/** Same shape as StubTraceEntry in tests/l1/stub-recorder.ts. Declared here so src/ never imports from tests/. */
export interface StubTraceEntryLike {
  seq: number;
  fixture: string;
  turn: number;
  toolsOffered: string[];
  stream: boolean;
  toolResults: string[];
  toolCalls: Array<{ name: string; arguments: unknown }>;
  content: string | null;
}

export interface AdapterContext {
  caseId: string;
  trial: number;
  k: number;
  promptSha256: string;
  /** The `model` field of the response. For the stub this echoes the request model (finding F5). */
  servedModelId: string;
  latencyMs: number;
  status?: TrialStatus;
  snapshots?: StateSnapshot[];
}

/** L1 stub entries to one TrialRecord: tool calls flattened in seq order, no approvals, zero tokens, host and alias "stub". */
export function trialFromStubEntries(entries: readonly StubTraceEntryLike[], ctx: AdapterContext): TrialRecord {
  const ordered = [...entries].sort((x, y) => x.seq - y.seq);
  const toolCalls = ordered.flatMap((e) =>
    e.toolCalls.map((c) => {
      if (typeof c.arguments !== "object" || c.arguments === null || Array.isArray(c.arguments)) {
        throw new Error(`stub entry ${e.seq}: tool call ${c.name} has non-object arguments`);
      }
      return { name: c.name, arguments: c.arguments as Record<string, unknown> };
    }),
  );
  return {
    schemaVersion: 1,
    caseId: ctx.caseId,
    trial: ctx.trial,
    k: ctx.k,
    mode: "stub",
    host: "stub",
    status: ctx.status ?? "pass",
    reason: "",
    model: { alias: "p4-stub", servedId: ctx.servedModelId },
    promptSha256: ctx.promptSha256,
    toolCalls,
    approvals: [],
    snapshots: ctx.snapshots ?? [],
    usage: { promptTokens: 0, completionTokens: 0, latencyMs: ctx.latencyMs },
    servers: [],
  };
}

/** Same shape as E2eRecord in tests/l1/gemma-tool-call.e2e.ts, minus fields L5 does not read. */
export interface L1GemmaRecordLike {
  status: TrialStatus;
  model: string;
  trajectory: Array<{ name: string; arguments: unknown }>;
  reason: string;
}

/** Maps an L1 Gemma record. servedModelId and usage are inputs because L1 does not capture them (finding F3). */
export function trialFromL1GemmaRecord(
  rec: L1GemmaRecordLike,
  ctx: AdapterContext & { usage: { promptTokens: number; completionTokens: number } },
): TrialRecord {
  const toolCalls = rec.trajectory.map((c) => {
    if (typeof c.arguments !== "object" || c.arguments === null || Array.isArray(c.arguments)) {
      throw new Error(`L1 record: tool call ${c.name} has non-object arguments`);
    }
    return { name: c.name, arguments: c.arguments as Record<string, unknown> };
  });
  return {
    schemaVersion: 1,
    caseId: ctx.caseId,
    trial: ctx.trial,
    k: ctx.k,
    mode: "nightly",
    host: "librechat",
    status: rec.status,
    reason: rec.reason,
    model: { alias: rec.model, servedId: ctx.servedModelId },
    promptSha256: ctx.promptSha256,
    toolCalls,
    approvals: [],
    snapshots: ctx.snapshots ?? [],
    usage: { promptTokens: ctx.usage.promptTokens, completionTokens: ctx.usage.completionTokens, latencyMs: ctx.latencyMs },
    servers: [],
  };
}

/** One JSON object per line. Throws with the 1-based line number and the first error. For artefacts written by the nightly script. */
export function parseTrialsJsonl(text: string, profile: TraceProfile): TrialRecord[] {
  const out: TrialRecord[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    const raw: unknown = JSON.parse(line);
    const v = validateTrial(raw, profile);
    if (!v.ok) throw new Error(`trials.jsonl line ${i + 1}: ${v.errors.join("; ")}`);
    out.push(raw as TrialRecord);
  }
  return out;
}
