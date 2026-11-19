import { lcCreateAgent, NO_PARENT } from "../../l1/librechat-client.js";
import type { L3Stack } from "./stack.js";

// Headless tool approval (spike S1, findings in docs/findings/l3-librechat-approval.md). With the harness H3 policy on, a
// paused tool call streams an `on_pending_action` event whose payload lists the calls and the decisions allowed for each.
// POST /api/agents/chat/resume with one decision per call (tool_call_id + decision) continues the run; the stream then carries
// the next pause or the final event. The helper answers every pause with `decide` and records what it saw. No assistant text
// is read: the verdicts are taken from the pauses, the decisions sent, and the product state the case reads.

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
type Decision = "approve" | "reject";
/** A decision the helper can send: a plain approve or reject, or an edit that replaces the call's arguments. */
export type Decision2 = Decision | { decision: "edit"; editedArguments: Record<string, unknown> };
const decisionName = (d: Decision2): string => (typeof d === "string" ? d : d.decision);

export interface PausedCall {
  name: string;
  toolCallId: string;
  allowed: string[];
  /** The arguments the pause shows for this call (a parsed object, or the raw string when it is not JSON). */
  args?: unknown;
}

export interface ApprovalRun {
  /** Every pause the run reached, in order, with the decision sent for each call. */
  pauses: Array<{ calls: PausedCall[]; sent: string[] }>;
  /** True when the stream ended with a final event (the run finished, not stuck). */
  finished: boolean;
  /** LibreChat conversation id of this chat. */
  conversationId: string;
}

interface PauseEvent {
  actionId: string;
  payload: { action_requests: Array<{ name: string; tool_call_id: string; arguments?: unknown }>; review_configs?: Array<{ tool_call_id: string; allowed_decisions: string[] }> };
}

export async function chatWithApproval(
  stack: L3Stack,
  o: { fixture: string; prompt: string; tools: string[]; decide: (call: PausedCall, pauseIndex: number) => Decision2; maxPauses?: number; timeoutMs?: number },
): Promise<ApprovalRun> {
  const s = stack.session;
  const H = { "content-type": "application/json", authorization: s.authorizationHeader, "user-agent": UA };
  const agentId = await lcCreateAgent(s, { name: `p4-l3-${o.fixture}`.slice(0, 60), model: "p4-stub", tools: o.tools, instructions: "You are a test agent. Use the tools you are given." });
  const start = (await (
    await fetch(`${s.baseUrl}/api/agents/chat`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ text: `[fixture:${o.fixture}] ${o.prompt}`, endpoint: "agents", agent_id: agentId, conversationId: null, parentMessageId: NO_PARENT, isContinued: false, isRegenerate: false }),
      signal: AbortSignal.timeout(60_000),
    })
  ).json()) as { streamId?: unknown; conversationId?: unknown };
  if (typeof start.streamId !== "string") throw new Error("APPROVAL_START_NO_STREAM: POST /api/agents/chat returned no streamId");
  const streamId = start.streamId;
  const run: ApprovalRun = { pauses: [], finished: false, conversationId: String(start.conversationId ?? streamId) };
  const maxPauses = o.maxPauses ?? 8;
  const timeoutMs = o.timeoutMs ?? 180_000;

  let next = await nextPauseOrFinal(s.baseUrl, s.authorizationHeader, streamId, timeoutMs);
  while (next !== undefined && next !== "final" && run.pauses.length < maxPauses) {
    const pause: PauseEvent = next;
    const reviews = pause.payload.review_configs ?? [];
    const calls: PausedCall[] = pause.payload.action_requests.map((a) => ({
      name: a.name,
      toolCallId: a.tool_call_id,
      allowed: reviews.find((c) => c.tool_call_id === a.tool_call_id)?.allowed_decisions ?? [],
      args: typeof a.arguments === "string" ? safeParse(a.arguments) : a.arguments,
    }));
    const sent = calls.map((c) => o.decide(c, run.pauses.length));
    run.pauses.push({ calls, sent: sent.map(decisionName) });
    const body = {
      conversationId: streamId,
      actionId: pause.actionId,
      agent_id: agentId,
      endpoint: "agents",
      decisions: calls.map((c, i) => {
        const d = sent[i] as Decision2;
        return typeof d === "string"
          ? { tool_call_id: c.toolCallId, decision: d, reason: "p4-l3 headless decision" }
          : { tool_call_id: c.toolCallId, decision: d.decision, editedArguments: d.editedArguments, reason: "p4-l3 headless decision" };
      }),
    };
    const res = await fetch(`${s.baseUrl}/api/agents/chat/resume`, { method: "POST", headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    if (res.status !== 200) throw new Error(`APPROVAL_RESUME_HTTP_${res.status}: the resume route refused the decisions`);
    next = await nextPauseOrFinal(s.baseUrl, s.authorizationHeader, streamId, timeoutMs);
  }
  run.finished = next === "final";
  return run;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Reads the stream until the next pause (returned), the final event ("final"), or the deadline (undefined). */
async function nextPauseOrFinal(baseUrl: string, authorization: string, streamId: string, timeoutMs: number): Promise<PauseEvent | "final" | undefined> {
  const res = await fetch(`${baseUrl}/api/agents/chat/stream/${streamId}`, { headers: { authorization, accept: "text/event-stream", "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok || !res.body) throw new Error(`APPROVAL_STREAM_HTTP_${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) return undefined;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const dataLine = part
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        let parsed: { event?: unknown; data?: { final?: unknown } & Record<string, unknown>; final?: unknown } | undefined;
        try {
          parsed = JSON.parse(dataLine) as typeof parsed;
        } catch {
          parsed = undefined;
        }
        if (parsed?.event === "on_pending_action") return parsed.data as unknown as PauseEvent;
        if (parsed?.final === true || parsed?.data?.final === true) return "final";
      }
    }
    return undefined;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
