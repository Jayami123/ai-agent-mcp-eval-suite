import type { AuthSession } from "qa-portfolio-harness";
import { lcCreateAgent, NO_PARENT } from "../../l1/librechat-client.js";
import type { L3Stack } from "./stack.js";

// Headless tool approval (spike S1, findings in docs/findings/l3-librechat-approval.md). With the harness H3 policy on, a
// paused tool call streams an `on_pending_action` event whose payload lists the calls and the decisions allowed for each.
// POST /api/agents/chat/resume with one decision per call (tool_call_id + decision) continues the run; the stream then carries
// the next pause or the final event. The helper answers every pause with `decide` and records what it saw. No assistant text
// is read: the verdicts are taken from the pauses, the decisions sent, and the product state the case reads.
//
// Always allow (harness v0.6.7, LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1): an approve decision with `scope: "session"` is the
// "Always allow" choice. It remembers the tool for the CONVERSATION. A run that continues an existing conversation passes
// `conversationId`, `parentMessageId` and `agentId` from the earlier run. Each pause records whether the card offered it.

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
export type Decision = "approve" | "reject";
/** A decision, with the optional Always allow scope. `scope: "session"` is only sent with `approve`. */
export interface DecisionChoice {
  decision: Decision;
  scope?: "session";
}

export interface PausedCall {
  name: string;
  toolCallId: string;
  allowed: string[];
  /** The card offered "Always allow" for this call (review_configs[].allow_always). */
  offeredAlways: boolean;
}

export interface PauseRecord {
  calls: PausedCall[];
  sent: DecisionChoice[];
}

export interface ApprovalRun {
  /** Every pause the run reached, in order, with the decision sent for each call. */
  pauses: PauseRecord[];
  /** True when the stream ended with a final event (the run finished, not stuck). */
  finished: boolean;
  /** LibreChat conversation id of this chat. */
  conversationId: string;
  /** The final assistant message of this run (for the next turn's parentMessageId). Undefined when the run did not finish. */
  messageId?: string;
  /** The agent the run used (reuse it when continuing the conversation). */
  agentId: string;
}

interface PauseEvent {
  actionId: string;
  payload: {
    action_requests: Array<{ name: string; tool_call_id: string }>;
    review_configs?: Array<{ tool_call_id: string; allowed_decisions: string[]; allow_always?: boolean }>;
  };
}

export async function chatWithApproval(
  stack: L3Stack,
  o: {
    fixture: string;
    prompt: string;
    tools: string[];
    decide: (call: PausedCall) => Decision | DecisionChoice;
    maxPauses?: number;
    timeoutMs?: number;
    /** Continue this conversation instead of starting one. */
    conversationId?: string;
    parentMessageId?: string;
    /** Reuse this agent (the one the conversation already has). */
    agentId?: string;
    /** A LibreChat login other than the stack's own (a new session, for the scope probe). */
    session?: AuthSession;
  },
): Promise<ApprovalRun> {
  const s = o.session ?? stack.session;
  const H = { "content-type": "application/json", authorization: s.authorizationHeader, "user-agent": UA };
  const agentId =
    o.agentId ?? (await lcCreateAgent(s, { name: `p4-l3-${o.fixture}`.slice(0, 60), model: "p4-stub", tools: o.tools, instructions: "You are a test agent. Use the tools you are given." }));
  const start = (await (
    await fetch(`${s.baseUrl}/api/agents/chat`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        text: `[fixture:${o.fixture}] ${o.prompt}`,
        endpoint: "agents",
        agent_id: agentId,
        conversationId: o.conversationId ?? null,
        parentMessageId: o.parentMessageId ?? NO_PARENT,
        isContinued: false,
        isRegenerate: false,
      }),
      signal: AbortSignal.timeout(60_000),
    })
  ).json()) as { streamId?: unknown; conversationId?: unknown };
  if (typeof start.streamId !== "string") throw new Error("APPROVAL_START_NO_STREAM: POST /api/agents/chat returned no streamId");
  const streamId = start.streamId;
  const run: ApprovalRun = { pauses: [], finished: false, conversationId: String(start.conversationId ?? streamId), agentId };
  const maxPauses = o.maxPauses ?? 8;
  const timeoutMs = o.timeoutMs ?? 180_000;

  let next = await nextPauseOrFinal(s.baseUrl, s.authorizationHeader, streamId, timeoutMs);
  while (next !== undefined && next !== "final" && run.pauses.length < maxPauses) {
    const pause: PauseEvent = next;
    const reviews = pause.payload.review_configs ?? [];
    const calls: PausedCall[] = pause.payload.action_requests.map((a) => {
      const review = reviews.find((c) => c.tool_call_id === a.tool_call_id);
      return {
        name: a.name,
        toolCallId: a.tool_call_id,
        allowed: review?.allowed_decisions ?? [],
        offeredAlways: review?.allow_always === true,
      };
    });
    const sent = calls.map((c) => normalise(o.decide(c)));
    run.pauses.push({ calls, sent: [...sent] });
    const body = {
      conversationId: streamId,
      actionId: pause.actionId,
      agent_id: agentId,
      endpoint: "agents",
      decisions: calls.map((c, i) => {
        const choice = sent[i] ?? { decision: "reject" as const };
        return { tool_call_id: c.toolCallId, decision: choice.decision, reason: "p4-l3 headless decision", ...(choice.scope ? { scope: choice.scope } : {}) };
      }),
    };
    const res = await fetch(`${s.baseUrl}/api/agents/chat/resume`, { method: "POST", headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    if (res.status !== 200) throw new Error(`APPROVAL_RESUME_HTTP_${res.status}: the resume route refused the decisions`);
    next = await nextPauseOrFinal(s.baseUrl, s.authorizationHeader, streamId, timeoutMs);
  }
  run.finished = next === "final";
  if (run.finished) run.messageId = await lastFinishedMessage(s.baseUrl, s.authorizationHeader, run.conversationId);
  return run;
}

function normalise(d: Decision | DecisionChoice): DecisionChoice {
  return typeof d === "string" ? { decision: d } : d;
}

/** The last finished assistant message of a conversation (the final answer of the latest turn). Polls briefly. */
async function lastFinishedMessage(baseUrl: string, authorization: string, conversationId: string): Promise<string | undefined> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/messages/${conversationId}`, { headers: { authorization }, signal: AbortSignal.timeout(15_000) });
    const list = res.ok ? ((await res.json()) as Array<{ messageId?: unknown; isCreatedByUser?: unknown; unfinished?: unknown }>) : [];
    const done = list.filter((m) => m.isCreatedByUser !== true && m.unfinished !== true && typeof m.messageId === "string");
    const last = done[done.length - 1];
    if (last !== undefined && typeof last.messageId === "string") return last.messageId;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return undefined;
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
