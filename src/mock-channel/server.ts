import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handleBotMethod } from "./bot-api.js";
import { handleControl } from "./control-api.js";
import { handlePageOrSink } from "./pages.js";
import { MockChannelState } from "./state.js";

export interface MockChannelOptions {
  /** The fake bot token the Bot API paths must carry. Never logged. */
  token: string;
  /** Use 0 in tests. The caller calls listen(); this module never listens. */
  port: number;
  /** Added to the first update and message ids. See MockChannelState. */
  idBase?: number;
}

const MAX_BODY_BYTES = 1024 * 1024;

export function createMockChannelServer(opts: MockChannelOptions): Server {
  const state = new MockChannelState(opts.idBase ?? 0);
  const server = createServer((req, res) => {
    // One line per request: method, path with the token hidden, status. No bodies, no headers.
    res.on("finish", () => {
      if (req.url !== "/health" && !req.url?.startsWith("/__mc/")) console.log(`${req.method} ${(req.url ?? "").replace(/\/bot[^/]+\//, "/bot[token]/")} -> ${res.statusCode}`);
    });
    handle(opts, state, req, res).catch((err: unknown) => {
      sendJson(res, 500, { ok: false, error_code: 500, description: String(err) });
    });
  });
  // Clients keep connections open between polls. The Node default (5 s) closes them under a client that is about to reuse one.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  return server;
}

async function handle(opts: MockChannelOptions, state: MockChannelState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  if (req.method === "GET" && url === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }
  if (url.startsWith("/__mc/")) {
    await handleControl(state, req, res, url, readBody);
    return;
  }
  if (url.startsWith("/__pages/") || url.startsWith("/__sink/")) {
    await handlePageOrSink(state, req, res, url, readBody);
    return;
  }
  const fileMatch = /^\/file\/bot([^/]+)\/(.+)$/.exec(url);
  if (fileMatch !== null && req.method === "GET") {
    if (fileMatch[1] !== opts.token) {
      state.record({ dir: "rejected", detail: "wrong token on file download" });
      sendJson(res, 401, { ok: false, error_code: 401, description: "Unauthorized" });
      return;
    }
    const f = [...state.files.values()].find((x) => x.path === fileMatch[2]);
    if (f === undefined) {
      sendJson(res, 404, { ok: false, error_code: 404, description: "Not Found" });
      return;
    }
    res.writeHead(200, { "content-type": f.mime, "content-length": f.bytes.length });
    res.end(f.bytes);
    return;
  }
  const botMatch = /^\/bot([^/]+)\/([A-Za-z]+)(?:\?.*)?$/.exec(url);
  if (botMatch !== null && (req.method === "POST" || req.method === "GET")) {
    if (botMatch[1] !== opts.token) {
      state.record({ dir: "rejected", detail: "wrong token on bot api call" });
      sendJson(res, 401, { ok: false, error_code: 401, description: "Unauthorized" });
      return;
    }
    const bodyText = await readBody(req);
    if (bodyText === null) {
      sendJson(res, 413, { ok: false, error_code: 413, description: "request body too large" });
      return;
    }
    const result = await handleBotMethod(state, botMatch[2] ?? "", parseParams(req, bodyText, url));
    sendJson(res, result.ok ? 200 : result.error_code, result);
    return;
  }
  sendJson(res, 404, { ok: false, error_code: 404, description: "not found" });
}

/** JSON, urlencoded, multipart text fields, or the query string. Binary parts are ignored (only their file name is kept). */
function parseParams(req: IncomingMessage, body: string, url: string): Record<string, unknown> {
  const type = String(req.headers["content-type"] ?? "");
  const out: Record<string, unknown> = {};
  const q = url.indexOf("?");
  if (q >= 0) for (const [k, v] of new URLSearchParams(url.slice(q + 1))) out[k] = v;
  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) Object.assign(out, parsed);
    } catch {
      /* an unparseable body leaves only the query parameters */
    }
  } else if (type.includes("application/x-www-form-urlencoded")) {
    for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  } else if (type.includes("multipart/form-data")) {
    for (const part of body.split(/--[^\r\n]+\r\n/).slice(1)) {
      const head = /name="([^"]+)"(?:; filename="([^"]*)")?/.exec(part);
      if (head === null) continue;
      const value = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n(--.*)?$/s, "");
      if (head[2] !== undefined) out["fileName"] = head[2];
      else out[head[1] ?? ""] = value;
    }
  }
  return out;
}

export function readBody(req: IncomingMessage): Promise<string | null> {
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

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}
