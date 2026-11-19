import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { canonicalJson } from "./canonical.js";
import {
  FIXTURE_ID_PATTERN,
  FIXTURE_MARKER,
  FixtureInvalidError,
  FixtureNotFoundError,
  loadFixture,
  type Fixture,
} from "./fixtures.js";

/** One recorded chat request, secrets-free: what the stub was asked and what it answered. */
export interface TraceEntry {
  seq: number;
  fixture: string;
  turn: number;
  /** Contents of the role "tool" messages in the request (the tool results the caller sent back), truncated. */
  toolResults: string[];
  /** Names of the tools the caller offered in this request (so a test can see what the host forwarded). */
  toolsOffered: string[];
  /** Whether the caller asked for a stream. */
  stream: boolean;
  /** The tool calls returned for this request, with arguments as parsed JSON. Empty on a text turn. */
  toolCalls: Array<{ name: string; arguments: unknown }>;
  content: string | null;
  /** The HTTP status the stub answered for an error turn, "closed" for a close turn, null on every other turn. */
  error: number | "closed" | null;
  /** Labels of the watched canary values found in any message of this request. Never the values. Empty when nothing is watched. */
  promptHits: string[];
}

const MAX_TOOL_RESULT_CHARS = 20000;

export interface StubOptions {
  fixturesDir: string;
  /** Use 0 in tests to get an ephemeral port. The caller calls listen(); this module never listens. */
  port: number;
}

const MAX_BODY_BYTES = 1024 * 1024;
/** Primary fixture selector. Node lowercases incoming header names. */
export const FIXTURE_HEADER = "x-p4-fixture";

export function createStubServer(opts: StubOptions): Server {
  const trace: TraceEntry[] = [];
  /** value -> label. Memory only: the values are never printed, logged or returned. */
  const watched = new Map<string, string>();
  return createServer((req, res) => {
    // One line per request: method, path, status. No bodies, no headers.
    res.on("finish", () => {
      if (req.url !== "/health") console.log(`${req.method} ${req.url} -> ${res.statusCode}`);
    });
    handle(opts, trace, watched, req, res).catch((err: unknown) => {
      sendJson(res, 500, { error: { message: String(err) } });
    });
  });
}

async function handle(opts: StubOptions, trace: TraceEntry[], watched: Map<string, string>, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }
  // The recorder. Tests read it to assert what the model host really sent and received. DELETE clears it.
  if (req.url === "/__trace" && req.method === "GET") {
    sendJson(res, 200, { entries: trace });
    return;
  }
  if (req.url === "/__trace" && req.method === "DELETE") {
    trace.length = 0;
    sendJson(res, 200, { entries: [] });
    return;
  }
  // Canary watch. Tests register values; each recorded request then lists the labels whose value appeared in its messages.
  if (req.url === "/__watch" && req.method === "DELETE") {
    watched.clear();
    sendJson(res, 200, { count: 0 });
    return;
  }
  if (req.url === "/__watch" && req.method === "POST") {
    const text = await readBody(req);
    try {
      const values = JSON.parse(text ?? "") as Record<string, unknown>;
      for (const [label, value] of Object.entries(values)) if (typeof value === "string" && value.length >= 6) watched.set(value, label);
      sendJson(res, 200, { count: watched.size });
    } catch {
      sendJson(res, 400, { error: { message: "body is not valid JSON" } });
    }
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    sendJson(res, 404, { error: { message: "not found" } });
    return;
  }

  const bodyText = await readBody(req);
  if (bodyText === null) {
    sendJson(res, 413, { error: { message: "request body too large" } });
    return;
  }

  let body: { stream?: unknown; messages?: unknown; model?: unknown; tools?: unknown };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    sendJson(res, 400, { error: { message: "request body is not valid JSON" } });
    return;
  }

  const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : [];
  const headerValue = req.headers[FIXTURE_HEADER];
  let id: string;
  if (headerValue !== undefined) {
    // Primary selector. When the header is present, messages are not consulted.
    id = typeof headerValue === "string" ? headerValue.trim() : "";
  } else {
    // Fallback only when the header is absent (some proxies drop custom headers).
    const ids = new Set<string>();
    for (const message of messages) {
      for (const match of messageText(message).matchAll(FIXTURE_MARKER)) ids.add(match[1] ?? "");
    }
    if (ids.size === 0) {
      sendJson(res, 400, { error: { message: "no fixture id in X-P4-Fixture header or [fixture:<id>] message marker" } });
      return;
    }
    if (ids.size > 1) {
      sendJson(res, 400, { error: { message: "more than one fixture id in messages" } });
      return;
    }
    id = [...ids][0] ?? "";
  }
  if (!FIXTURE_ID_PATTERN.test(id)) {
    sendJson(res, 400, { error: { message: "invalid fixture id" } });
    return;
  }

  let fixture: Fixture;
  try {
    fixture = loadFixture(opts.fixturesDir, id);
  } catch (err) {
    if (err instanceof FixtureNotFoundError) {
      console.error(err.message);
      sendJson(res, 404, { error: { message: err.message } });
    } else if (err instanceof FixtureInvalidError) {
      console.error(err.message);
      sendJson(res, 500, { error: { message: err.message } });
    } else {
      throw err;
    }
    return;
  }

  const turnIndex = messages.filter((m) => m["role"] === "tool").length;
  const turn = fixture.turns[turnIndex];
  if (turn === undefined) {
    sendJson(res, 409, { error: { message: `turn ${turnIndex} is past the end of fixture ${id}` } });
    return;
  }

  const promptText = messages.map((m) => messageText(m)).join("\n");
  const promptHits = [...watched].filter(([value]) => promptText.includes(value)).map(([, label]) => label);
  const toolResults = messages.filter((m) => m["role"] === "tool").map((m) => messageText(m).slice(0, MAX_TOOL_RESULT_CHARS));
  // Error and close turns do not advance the turn index (it counts tool messages), so a retry of the same request gets the
  // same answer again. That keeps the stub deterministic.
  if (turn.close === true || turn.error !== undefined) {
    trace.push({
      seq: trace.length + 1,
      fixture: id,
      turn: turnIndex,
      toolsOffered: toolNames(body.tools),
      stream: body.stream === true,
      toolResults,
      toolCalls: [],
      content: null,
      error: turn.close === true ? "closed" : (turn.error?.status ?? null),
      promptHits,
    });
    if (turn.close === true) {
      req.socket.destroy();
      return;
    }
    sendJson(res, turn.error?.status ?? 500, { error: { message: turn.error?.message ?? "", type: "p4_stub_error" } });
    return;
  }

  const callList = (turn.tool_calls ?? []).map((call, i) => ({
    id: `call_${id}_${turnIndex}_${i}`,
    name: call.name,
    args: canonicalJson(call.arguments),
  }));
  trace.push({
    seq: trace.length + 1,
    fixture: id,
    turn: turnIndex,
    toolsOffered: toolNames(body.tools),
    stream: body.stream === true,
    toolResults,
    toolCalls: (turn.tool_calls ?? []).map((call) => ({ name: call.name, arguments: call.arguments })),
    content: turn.content ?? null,
    error: null,
    promptHits,
  });

  const model = typeof body.model === "string" ? body.model : "p4-stub";
  const finish = callList.length > 0 ? "tool_calls" : "stop";
  const completionId = `chatcmpl-${id}-${turnIndex}`;

  if (body.stream === true) {
    sendStream(res, completionId, model, finish, turn.content ?? null, callList);
    return;
  }

  const message: Record<string, unknown> = { role: "assistant", content: turn.content ?? null };
  if (callList.length > 0) {
    message["tool_calls"] = callList.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } }));
  }
  const response = {
    id: completionId,
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, finish_reason: finish, logprobs: null, message }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  sendJson(res, 200, response);
}

function toolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => {
    const o = (t ?? {}) as { name?: unknown; function?: { name?: unknown } };
    const name = o.function?.name ?? o.name;
    return typeof name === "string" ? name : "?";
  });
}

/** The text of a message: a string content, or the joined text parts of an array content. */
function messageText(message: Record<string, unknown>): string {
  const content = message["content"];
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part !== null && typeof (part as Record<string, unknown>)["text"] === "string" ? String((part as Record<string, unknown>)["text"]) : ""))
      .join("\n");
  }
  return "";
}

/**
 * Server-sent events in the OpenAI chunk format, for clients that always stream (LibreChat, OpenClaw). The bytes depend
 * only on the fixture and the turn. Tool calls are sent whole in one delta, then the finish chunk, then [DONE].
 */
function sendStream(
  res: ServerResponse,
  completionId: string,
  model: string,
  finish: string,
  content: string | null,
  calls: Array<{ id: string; name: string; args: string }>,
): void {
  const chunk = (delta: Record<string, unknown>, finishReason: string | null): string =>
    `data: ${canonicalJson({
      id: completionId,
      object: "chat.completion.chunk",
      created: 0,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
    })}\n\n`;
  const delta: Record<string, unknown> = { role: "assistant" };
  if (content !== null) delta["content"] = content;
  if (calls.length > 0) {
    delta["tool_calls"] = calls.map((c, index) => ({ index, id: c.id, type: "function", function: { name: c.name, arguments: c.args } }));
  }
  const body = `${chunk(delta, null)}${chunk({}, finish)}data: [DONE]\n\n`;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = canonicalJson(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}
