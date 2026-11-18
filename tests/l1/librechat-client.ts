import type { AuthSession } from "qa-portfolio-harness";

// A small headless client for LibreChat v0.8.7's agents API (the same calls the web UI makes):
//   POST /api/agents                       create an agent that offers one MCP tool
//   POST /api/agents/chat                  start a generation, returns { streamId, conversationId }
//   GET  /api/agents/chat/stream/:id       server-sent events until the final event
//   GET  /api/messages/:conversationId     the saved messages, with tool_call content parts
// The bearer token comes from the harness LibreChat adapter's authenticate(). It is never printed.

export const NO_PARENT = "00000000-0000-0000-0000-000000000000";
/** LibreChat names an MCP tool `<tool>_mcp_<server>`. */
export const mcpToolName = (tool: string, server: string): string => `${tool}_mcp_${server}`;
/** The custom endpoint the harness writes into librechat.yaml. */
export const LIBRECHAT_PROVIDER = "P4 LiteLLM";

export interface LcToolCall {
  name: string;
  /** Parsed arguments, or { _unparsed: true } when the argument string is not JSON. */
  arguments: unknown;
  output: string | undefined;
}

export interface LcChatOutcome {
  conversationId: string;
  /** Error text from an SSE error event or a saved error message. Empty when none. */
  errorText: string;
  toolCalls: LcToolCall[];
  /** Assistant text, for logging only. */
  text: string;
  httpStatus: number;
}

const REQUEST_TIMEOUT_MS = 60_000;

function headers(session: AuthSession): Record<string, string> {
  return { "content-type": "application/json", authorization: session.authorizationHeader };
}

async function readJson(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} returned non-JSON (HTTP ${res.status})`);
  }
}

export async function lcCreateAgent(
  session: AuthSession,
  opts: { name: string; model: string; tools: string[]; instructions: string },
): Promise<string> {
  const res = await fetch(`${session.baseUrl}/api/agents`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({
      name: opts.name,
      description: "p4 suite L1 test agent (fake data only)",
      provider: LIBRECHAT_PROVIDER,
      model: opts.model,
      instructions: opts.instructions,
      tools: opts.tools,
      model_parameters: {},
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await readJson(res, "POST /api/agents")) as { id?: unknown };
  if (typeof body.id !== "string") throw new Error("POST /api/agents returned no agent id");
  return body.id;
}

interface SseEvent {
  event: string;
  data: unknown;
}

function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    const joined = dataLines.join("\n");
    try {
      events.push({ event, data: JSON.parse(joined) as unknown });
    } catch {
      events.push({ event, data: joined });
    }
  }
  return { events, rest };
}

interface ContentPart {
  type?: string;
  text?: string;
  tool_call?: { name?: string; args?: unknown; output?: unknown };
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { _unparsed: true };
  }
}

/** Reads tool_call parts and text from a saved assistant message's content array. */
export function partsToOutcome(content: unknown): { toolCalls: LcToolCall[]; text: string } {
  const toolCalls: LcToolCall[] = [];
  const texts: string[] = [];
  for (const part of Array.isArray(content) ? (content as ContentPart[]) : []) {
    if (part.type === "tool_call" && part.tool_call?.name) {
      toolCalls.push({
        name: part.tool_call.name,
        arguments: parseArgs(part.tool_call.args),
        output: part.tool_call.output === undefined ? undefined : textOf(part.tool_call.output),
      });
    } else if (part.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return { toolCalls, text: texts.join("") };
}

/**
 * Sends one chat to an agent and waits for the generation to finish. The trace comes from the saved assistant message
 * (tool_call parts), read after the stream ends. A stream error is returned in errorText, not thrown, so the caller can
 * classify it (for example a 429 from the provider).
 */
export async function lcChat(
  session: AuthSession,
  opts: { agentId: string; text: string; timeoutMs: number },
): Promise<LcChatOutcome> {
  const deadline = Date.now() + opts.timeoutMs;
  const start = await fetch(`${session.baseUrl}/api/agents/chat`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({
      text: opts.text,
      endpoint: "agents",
      agent_id: opts.agentId,
      conversationId: null,
      parentMessageId: NO_PARENT,
      isContinued: false,
      isRegenerate: false,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const startBody = (await readJson(start, "POST /api/agents/chat")) as { streamId?: unknown; conversationId?: unknown };
  if (typeof startBody.streamId !== "string" || typeof startBody.conversationId !== "string") {
    throw new Error("POST /api/agents/chat returned no streamId or conversationId");
  }
  const conversationId = startBody.conversationId;

  let errorText = "";
  const stream = await fetch(`${session.baseUrl}/api/agents/chat/stream/${startBody.streamId}`, {
    headers: { authorization: session.authorizationHeader, accept: "text/event-stream" },
    signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
  });
  if (!stream.ok || !stream.body) {
    throw new Error(`GET /api/agents/chat/stream returned HTTP ${stream.status}`);
  }
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const ev of parsed.events) {
      if (ev.event === "error") errorText += `${textOf(ev.data)}\n`;
      const d = ev.data as { final?: unknown; error?: unknown } | string;
      if (typeof d === "object" && d !== null) {
        if (d.error !== undefined && ev.event !== "error") errorText += `${textOf(d.error)}\n`;
        if (d.final === true) done = true;
      }
    }
  }
  await reader.cancel().catch(() => undefined);

  // The message is saved just after the final event. Poll briefly for the assistant message.
  let toolCalls: LcToolCall[] = [];
  let text = "";
  let savedStatus = 0;
  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await fetch(`${session.baseUrl}/api/messages/${conversationId}`, {
      headers: { authorization: session.authorizationHeader },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    savedStatus = res.status;
    if (res.ok) {
      const messages = (await res.json()) as Array<{ isCreatedByUser?: boolean; content?: unknown; text?: string; error?: boolean }>;
      const reply = [...messages].reverse().find((m) => m.isCreatedByUser === false);
      if (reply) {
        const parsed = partsToOutcome(reply.content);
        toolCalls = parsed.toolCalls;
        text = parsed.text || (typeof reply.text === "string" ? reply.text : "");
        if (reply.error === true) errorText += `${text}\n`;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { conversationId, errorText: errorText.trim(), toolCalls, text, httpStatus: savedStatus };
}
