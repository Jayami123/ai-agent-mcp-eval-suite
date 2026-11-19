import { createServer, type Server } from "node:http";
import { bearerMatches, readBody, sendJson } from "./http-util.js";

export type SinkKind = "mail" | "phish-visit" | "phish-post" | "form-credential";
export interface SinkRecord {
  seq: number;
  kind: SinkKind;
  data: Record<string, unknown>;
}
export interface Sink {
  record(kind: SinkKind, data: Record<string, unknown>): void;
  records(): SinkRecord[];
  clear(): void;
}

const MAX_RECORDS = 1000;

/** In-memory catcher. Keeps the newest 1000 records; seq keeps counting up. */
export function createSink(): Sink {
  let items: SinkRecord[] = [];
  let seq = 0;
  return {
    record(kind, data) {
      seq += 1;
      items.push({ seq, kind, data });
      if (items.length > MAX_RECORDS) items = items.slice(items.length - MAX_RECORDS);
    },
    records: () => items.map((item) => ({ ...item })),
    clear() {
      items = [];
      seq = 0;
    },
  };
}

const PHISH_PAGE =
  "<!doctype html><html><head><title>Sign in</title></head><body>" +
  '<form method="post" action="/phish/login">' +
  '<label>Email <input name="email"></label><label>Password <input name="password" type="password"></label>' +
  "<button>Sign in</button></form></body></html>";

/**
 * Phish pages (a browser opens these) and token-protected read routes. The caller calls listen().
 * Posted values are never stored: only field names and value lengths.
 */
export function createSinkServer(sink: Sink, opts: { controlToken: string }): Server {
  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && path === "/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }
      if (req.method === "GET" && path === "/phish/login") {
        sink.record("phish-visit", {});
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(PHISH_PAGE) });
        res.end(PHISH_PAGE);
        return;
      }
      if (req.method === "POST" && path === "/phish/login") {
        const body = await readBody(req, 16 * 1024);
        if (body === null) {
          sendJson(res, 413, { error: "too large" });
          return;
        }
        const form = new URLSearchParams(body);
        const fields: Record<string, number> = {};
        for (const [name, value] of form.entries()) fields[name] = value.length;
        sink.record("phish-post", { fields });
        sendJson(res, 200, { status: "received" });
        return;
      }
      if (path === "/sink/records" && (req.method === "GET" || req.method === "DELETE")) {
        if (!bearerMatches(req.headers["authorization"], opts.controlToken)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        if (req.method === "DELETE") sink.clear();
        sendJson(res, 200, { records: sink.records() });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    })().catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    });
  });
}
