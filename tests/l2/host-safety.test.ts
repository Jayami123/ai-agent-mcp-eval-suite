import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { connect, rpc, startLab } from "./helpers.js";

const INIT = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "0" } };

test("every listener is bound to 127.0.0.1", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  for (const url of [lab.mcpUrl, lab.controlUrl, lab.sinkUrl]) assert.equal(new URL(url).hostname, "127.0.0.1");
});

test("a request with a foreign Host or Origin is refused with 4xx; a localhost one is accepted", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const url = new URL(lab.mcpUrl);
  const post = (host: string, origin?: string) =>
    new Promise<number>((resolve, reject) => {
      import("node:http").then(({ request }) => {
        const req = request(
          { host: "127.0.0.1", port: url.port, path: "/mcp", method: "POST", headers: { host, "content-type": "application/json", accept: "application/json, text/event-stream", ...(origin !== undefined ? { origin } : {}) } },
          (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); },
        );
        req.on("error", reject);
        req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT }));
      }, reject);
    });
  assert.equal(await post("evil.example.com", "http://evil.example.com"), 403);
  assert.equal(await post(url.host, "http://evil.example.com"), 403);
  assert.equal(await post("evil.example.com"), 403);
  assert.equal(await post(url.host, `http://${url.host}`), 200);
  assert.equal(await post(url.host), 200);
});

test("two labs with different names and ports run side by side", async (t) => {
  const a = await startLab({ serverName: "lab-a" });
  const b = await startLab({ serverName: "lab-b" });
  t.after(() => Promise.all([a.close(), b.close()]));
  assert.notEqual(a.mcpUrl, b.mcpUrl);
  const ca = await connect(a);
  const cb = await connect(b);
  t.after(() => Promise.all([ca.close(), cb.close()]));
  assert.equal(ca.getServerVersion()?.name, "lab-a");
  assert.equal(cb.getServerVersion()?.name, "lab-b");
});

test("an unknown path is 404 and a POST without a session is 400", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  assert.equal((await fetch(lab.mcpUrl.replace("/mcp", "/other"))).status, 404);
  const r = await rpc(lab, "tools/list", {});
  assert.equal(r.status, 400);
});

test("the lab source has no outbound network code", () => {
  const dir = path.resolve(process.cwd(), "src/attack-lab");
  const banned: Array<[RegExp, string]> = [
    // A type-only import (for example AddressInfo) is fine: it compiles away.
    [/^import (?!type )[^\n]*from "node:(https|net|tls|dgram|dns|child_process)"/m, "network or process import"],
    [/\bfetch\(/, "fetch call"],
    [/\bhttp\.(request|get)\(/, "http client call"],
    [/\brequest\(\s*\{/, "http client call"],
  ];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(path.join(dir, file), "utf8");
    for (const [pattern, label] of banned) assert.equal(pattern.test(source), false, `${file}: ${label}`);
  }
});
