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

export interface StubOptions {
  fixturesDir: string;
  /** Use 0 in tests to get an ephemeral port. The caller calls listen(); this module never listens. */
  port: number;
}

const MAX_BODY_BYTES = 1024 * 1024;
/** Primary fixture selector. Node lowercases incoming header names. */
export const FIXTURE_HEADER = "x-p4-fixture";

export function createStubServer(opts: StubOptions): Server {
  return createServer((req, res) => {
    handle(opts, req, res).catch((err: unknown) => {
      sendJson(res, 500, { error: { message: String(err) } });
    });
  });
}

async function handle(opts: StubOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok" });
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

  let body: { stream?: unknown; messages?: unknown; model?: unknown };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    sendJson(res, 400, { error: { message: "request body is not valid JSON" } });
    return;
  }
  if (body.stream === true) {
    sendJson(res, 400, { error: { message: "streaming is not supported by the p4 stub" } });
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
      const content = typeof message["content"] === "string" ? message["content"] : "";
      for (const match of content.matchAll(FIXTURE_MARKER)) ids.add(match[1] ?? "");
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

  const message: Record<string, unknown> = { role: "assistant", content: turn.content ?? null };
  let finish = "stop";
  if (turn.tool_calls) {
    finish = "tool_calls";
    message["tool_calls"] = turn.tool_calls.map((call, i) => ({
      id: `call_${id}_${turnIndex}_${i}`,
      type: "function",
      function: { name: call.name, arguments: canonicalJson(call.arguments) },
    }));
  }
  const response = {
    id: `chatcmpl-${id}-${turnIndex}`,
    object: "chat.completion",
    created: 0,
    model: typeof body.model === "string" ? body.model : "p4-stub",
    choices: [{ index: 0, finish_reason: finish, logprobs: null, message }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  sendJson(res, 200, response);
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
