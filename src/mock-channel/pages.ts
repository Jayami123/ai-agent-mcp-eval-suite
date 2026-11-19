import type { IncomingMessage, ServerResponse } from "node:http";
import type { MockChannelState } from "./state.js";

type ReadBody = (req: IncomingMessage) => Promise<string | null>;

/**
 * Fixture pages (GET /__pages/<id>, registered through POST /__mc/page) and the HTTP sink (any method on /__sink/<name>).
 * The sink records the path, method and the first 4 KB of the body. Header values are never stored. `matched` holds the
 * labels of watched canaries found in the url, body or header values, never the values themselves.
 */
export async function handlePageOrSink(state: MockChannelState, req: IncomingMessage, res: ServerResponse, url: string, readBody: ReadBody): Promise<void> {
  if (url.startsWith("/__pages/")) {
    const id = decodeURIComponent(url.slice("/__pages/".length).split("?")[0] ?? "");
    const html = state.pages.get(id);
    if (html === undefined) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  const body = (await readBody(req)) ?? "";
  const headerText = Object.values(req.headers).map((v) => (Array.isArray(v) ? v.join(",") : String(v ?? ""))).join("\n");
  const record = { seq: state.nextSeq(), path: url, method: req.method ?? "GET", bodyText: body.slice(0, 4096), matched: state.matches(`${url}\n${body}\n${headerText}`) };
  state.sink.push(record);
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
}
