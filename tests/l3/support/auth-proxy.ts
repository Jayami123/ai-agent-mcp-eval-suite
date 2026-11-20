import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

// A loopback pass-through that adds the Authorization header, for tools that cannot send one (the conformance CLI has no
// header option). It forwards method, path, body and the MCP headers, and streams the reply. 127.0.0.1 only. The
// credential stays in this process; it is never written to a log.
const FORWARD = ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "mcp-method", "mcp-name", "last-event-id"];

export interface AuthProxy {
  url: string;
  close(): Promise<void>;
}

export async function startAuthProxy(target: string, authorization: string | null): Promise<AuthProxy> {
  const base = new URL(target);
  const server: Server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers: Record<string, string> = {};
      for (const h of FORWARD) if (typeof req.headers[h] === "string") headers[h] = req.headers[h] as string;
      if (authorization !== null) headers["authorization"] = authorization;
      const upstream = await fetch(new URL(req.url ?? "/", base.origin), {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
      });
      const out: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) out[k] = v;
      });
      res.writeHead(upstream.status, out);
      if (upstream.body) {
        // An upstream or client disconnect ends the stream with an error (for example "TypeError: terminated"). Handle it here,
        // so it never becomes an uncaught exception after the test has ended.
        const body = Readable.fromWeb(upstream.body as never);
        body.on("error", () => res.destroy());
        res.on("close", () => body.destroy());
        body.pipe(res);
      } else res.end();
    })().catch(() => {
      res.writeHead(502).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  // closeAllConnections ends keep-alive and open event-stream connections, so close() cannot hang on a client that is still reading.
  return {
    url: `http://127.0.0.1:${port}${base.pathname}`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
