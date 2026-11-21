import type { AuthSession } from "qa-portfolio-harness";
import { lcCreateAgent, NO_PARENT } from "../../l1/librechat-client.js";
import { nextPauseOrFinal, type PauseEvent } from "./approval.js";
import type { L3Stack } from "./stack.js";

// A run the case can stop on purpose (REL-003). It is the same start, pause and resume protocol as chatWithApproval
// (tests/l3/support/approval.ts), split into steps so the case can abort the stream between them. The abort is the one
// LibreChat's Stop button sends: POST /api/agents/chat/abort with the stream id (api/server/routes/agents/index.js, the
// /chat/abort route). No assistant text is read; the verdicts come from the lab, the sink and the stored conversation.

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CALL_TIMEOUT_MS = 60_000;

export interface StartedRun {
  s: AuthSession;
  streamId: string;
  conversationId: string;
  agentId: string;
}

export async function startRun(stack: L3Stack, o: { fixture: string; prompt: string; tools: string[] }): Promise<StartedRun> {
  const s = stack.session;
  const H = { "content-type": "application/json", authorization: s.authorizationHeader, "user-agent": UA };
  const model = process.env["P4_LLM_MODE"] === "nightly" ? "p4-nightly" : "p4-stub";
  const agentId = await lcCreateAgent(s, {
    name: `p4-l3-${o.fixture}`.slice(0, 60),
    model,
    tools: o.tools,
    instructions: "You are a test agent. Use the tools you are given.",
  });
  const res = await fetch(`${s.baseUrl}/api/agents/chat`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      text: `[fixture:${o.fixture}] ${o.prompt}`,
      endpoint: "agents",
      agent_id: agentId,
      conversationId: null,
      parentMessageId: NO_PARENT,
      isContinued: false,
      isRegenerate: false,
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const start = (await res.json()) as { streamId?: unknown; conversationId?: unknown };
  if (typeof start.streamId !== "string") throw new Error("CANCEL_START_NO_STREAM: POST /api/agents/chat returned no streamId");
  return { s, streamId: start.streamId, conversationId: String(start.conversationId ?? start.streamId), agentId };
}

/** The next pause of the run, or "final" when the run finished without one, or undefined at the deadline. */
export async function nextPause(run: StartedRun, timeoutMs: number): Promise<PauseEvent | "final" | undefined> {
  return nextPauseOrFinal(run.s.baseUrl, run.s.authorizationHeader, run.streamId, timeoutMs);
}

/** Approves every call of one pause (the resume route needs one decision per tool_call_id). Returns the HTTP status. */
export async function approvePause(run: StartedRun, pause: PauseEvent): Promise<number> {
  const body = {
    conversationId: run.streamId,
    actionId: pause.actionId,
    agent_id: run.agentId,
    endpoint: "agents",
    decisions: pause.payload.action_requests.map((a) => ({ tool_call_id: a.tool_call_id, decision: "approve", reason: "p4-l3 headless decision" })),
  };
  const res = await fetch(`${run.s.baseUrl}/api/agents/chat/resume`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: run.s.authorizationHeader, "user-agent": UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  return res.status;
}

/** The Stop button: aborts the run's generation job. Returns the HTTP status (no body is read). */
export async function abortRun(run: StartedRun): Promise<number> {
  const res = await fetch(`${run.s.baseUrl}/api/agents/chat/abort`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: run.s.authorizationHeader, "user-agent": UA },
    body: JSON.stringify({ streamId: run.streamId, conversationId: run.conversationId }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  return res.status;
}

/** Every message text the conversation holds, joined. For a check that a given string was never stored. */
export async function conversationText(run: StartedRun): Promise<string> {
  const res = await fetch(`${run.s.baseUrl}/api/messages/${run.conversationId}`, {
    headers: { authorization: run.s.authorizationHeader },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`CANCEL_MESSAGES_HTTP_${res.status}`);
  const list = (await res.json()) as Array<{ text?: unknown }>;
  return list.map((m) => (typeof m.text === "string" ? m.text : "")).join("\n");
}
