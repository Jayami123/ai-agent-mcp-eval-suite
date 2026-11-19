import type { IncomingMessage, ServerResponse } from "node:http";
import type { InboundSpec, ReactionSpec } from "./types.js";
import type { MockChannelState } from "./state.js";

type ReadBody = (req: IncomingMessage) => Promise<string | null>;

function send(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** Test-facing control API. It is not part of the Bot API and is not advertised anywhere else. */
export async function handleControl(state: MockChannelState, req: IncomingMessage, res: ServerResponse, url: string, readBody: ReadBody): Promise<void> {
  const route = url.slice("/__mc/".length).split("?")[0] ?? "";
  const query = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
  if (req.method === "GET" && route === "log") return send(res, 200, { entries: state.log });
  if (req.method === "GET" && route === "outbound") {
    const since = Number(query.get("since") ?? 0);
    return send(res, 200, { entries: state.log.filter((e) => e.dir === "outbound" && e.seq > since) });
  }
  if (req.method === "GET" && route === "status") return send(res, 200, { polls: state.polls, pollsInFlight: state.pollsInFlight });
  if (req.method === "GET" && route === "sink") return send(res, 200, { records: state.sink });
  if (req.method === "DELETE" && route === "reset") {
    state.reset();
    return send(res, 200, { entries: [] });
  }
  if (req.method !== "POST") return send(res, 404, { error: "not found" });
  const text = await readBody(req);
  if (text === null) return send(res, 413, { error: "too large" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return send(res, 400, { error: "body is not valid JSON" });
  }
  switch (route) {
    case "inbound":
      return send(res, 200, state.inject(body as InboundSpec));
    case "reaction":
      return send(res, 200, state.injectReaction(body as ReactionSpec));
    case "raw-update":
      return send(res, 200, state.injectRaw(body));
    case "page": {
      const { id, html } = body as { id?: unknown; html?: unknown };
      if (typeof id !== "string" || !/^[a-z0-9-]{1,64}$/.test(id) || typeof html !== "string") return send(res, 400, { error: "id and html required" });
      state.pages.set(id, html);
      return send(res, 200, { path: `/__pages/${id}` });
    }
    case "watch": {
      const values = body as Record<string, unknown>;
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) if (typeof v === "string") clean[k] = v;
      state.watch(clean);
      return send(res, 200, { count: Object.keys(clean).length });
    }
    default:
      return send(res, 404, { error: "not found" });
  }
}
