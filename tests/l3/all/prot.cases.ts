import type { ServerOracle } from "../../../src/oracles/index.js";
import { cleanResponse, headerMismatchRefused, isJsonRpcError, noSchemaViolations, statelessClaimHolds, toolsListViolations, versionRejectedOrDowngraded } from "../../../src/oracles/proto.js";
import { toolsMatchPin, unchanged } from "../../../src/oracles/snapshot.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { l3Case, type CaseCtx } from "../support/case.js";
import { expectedDefect } from "../support/expected-defect.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { runtime } from "../support/runtime.js";
import type { BusinessServer } from "../support/stack.js";
import { toolsSnapshot } from "../support/tool-map.js";

// Protocol cases that run on every registered server. No model, no LibreChat chat: the raw client is the caller.
// Each case takes a before and after snapshot of the server's store, so "no side effect" is read from product state.

interface Target {
  server: BusinessServer;
  oracle: ServerOracle;
  /** A fresh client with the server's own credential. */
  client(protocolVersion?: string): McpHttpClient;
}

async function eachServer(fn: (t: Target) => Promise<void>): Promise<void> {
  const rt = runtime();
  for (const server of rt.servers) {
    const { url, authorization } = rt.stack.mcp(server);
    await fn({ server, oracle: rt.oracle(server), client: (v) => new McpHttpClient(url, authorization, v) });
  }
}

// Expected defect (plan D13), confirmed in CI run 44346353616: Twenty v2.44 answers a request with no jsonrpc member with
// HTTP 200, but JSON-RPC 2.0 requires the member, so the case keeps failing on the real behaviour and is annotated, not
// deleted or skipped. expectedDefect() fails the case the day Twenty starts rejecting, to prompt removal.
// P4-MCP-PROT-003 is NOT a defect: Mcp-Method is from spec 2026-07-28 and Twenty negotiates 2025-06-18 (a spec-version gap,
// see headerMismatchRefused in src/oracles/proto.ts). It is strict again for any server that negotiates 2026-07-28 or later.
const MISSING_JSONRPC_DEFECT: Partial<Record<BusinessServer, string>> = { twenty: "accepts a request with no jsonrpc member (HTTP 200)" };

const tagged = (ctx: CaseCtx, server: string, v: { outcome: "pass" | "fail" | "unverified"; detail: string }): void =>
  ctx.check({ ...v, detail: `${server}: ${v.detail}` });

l3Case("P4-MCP-PROT-002", "every JSON-RPC message on the wire matches the schema", async (ctx) => {
  await eachServer(async ({ server, client }) => {
    const c = client();
    await c.initialize();
    const tools = await c.listTools();
    const shape = toolsListViolations({ tools });
    ctx.check(tools.length > 0 && shape.length === 0 ? pass(`${server}: ${tools.length} tools, shape valid`) : fail(`${server}: tools/list invalid: ${shape.join(", ") || "empty"}`));
    await c.post({ jsonrpc: "2.0", id: 99, method: "ping" });
    tagged(ctx, server, noSchemaViolations(c.wire));
  });
});

l3Case("P4-MCP-PROT-003", "a header that disagrees with the body is rejected", async (ctx) => {
  await eachServer(async ({ server, oracle, client }) => {
    const c = client();
    const init = await c.initialize();
    const negotiated = (init.body as { result?: { protocolVersion?: unknown } }).result?.protocolVersion;
    const before = await oracle.snapshot();
    // Body says tools/list; the header says tools/call. Spec 2026-07-28: the server MUST refuse (-32020 HeaderMismatch).
    const res = await c.post({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }, { "mcp-method": "tools/call" });
    const v = headerMismatchRefused(res, typeof negotiated === "string" ? negotiated : undefined);
    if (v.detail.startsWith("deployment finding")) ctx.note(`${server}: ${v.detail}`);
    tagged(ctx, server, v);
    ctx.check(unchanged(before, await oracle.snapshot()));
  });
});

l3Case("P4-MCP-PROT-004", "stateless initialize behaves as the server claims", async (ctx) => {
  await eachServer(async ({ server, oracle, client }) => {
    const init = await client().initialize();
    const before = await oracle.snapshot();
    const bare = await client().post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, {}, false); // no initialize, no session
    tagged(ctx, server, statelessClaimHolds(init, bare));
    ctx.check(unchanged(before, await oracle.snapshot()));
  });
});

l3Case("P4-MCP-PROT-008", "tools/call for a name that was never listed returns a protocol error and has no side effect", async (ctx) => {
  await eachServer(async ({ server, oracle, client }) => {
    const c = client();
    await c.initialize();
    const before = await oracle.snapshot();
    const res = await c.callTool("p4_never_listed_tool_0001", {});
    tagged(ctx, server, isJsonRpcError(res.body, [-32601, -32602]));
    ctx.check(unchanged(before, await oracle.snapshot()));
  });
});

l3Case("P4-MCP-PROT-009", "invalid JSON-RPC is rejected and nothing runs", async (ctx) => {
  await eachServer(async ({ server, oracle, client }) => {
    const c = client();
    await c.initialize();
    const before = await oracle.snapshot();
    const bad: unknown[] = [
      { id: 11, method: "tools/list", params: {} }, // no jsonrpc member
      { jsonrpc: "2.0", id: { not: "valid" }, method: "tools/list" }, // id is an object
      "{this is not json", // not JSON at all
    ];
    for (const [i, body] of bad.entries()) {
      const res = await c.post(body);
      const rejected = res.status >= 400 || (res.body as { error?: unknown } | null)?.error !== undefined;
      const observed = rejected && cleanResponse(res).outcome === "pass" ? pass(`malformed message ${i} rejected (HTTP ${res.status})`) : fail(`malformed message ${i} not rejected cleanly (HTTP ${res.status})`);
      const known = i === 0 ? MISSING_JSONRPC_DEFECT[server] : undefined; // message 0 is the one with no jsonrpc member
      tagged(ctx, server, known === undefined ? observed : expectedDefect(observed, { caseId: "P4-MCP-PROT-009", server, summary: known }));
    }
    ctx.check(unchanged(before, await oracle.snapshot()));
  });
});

l3Case("P4-MCP-PROT-012", "a protocol version mismatch is a clean failure", async (ctx) => {
  await eachServer(async ({ server, oracle, client }) => {
    const before = await oracle.snapshot();
    const requested = "1999-01-01";
    const res = await client(requested).post(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: requested, capabilities: {}, clientInfo: { name: "p4-l3", version: "0" } } },
      { "mcp-protocol-version": requested },
      false,
    );
    tagged(ctx, server, versionRejectedOrDowngraded(res, requested));
    ctx.check(unchanged(before, await oracle.snapshot()));
  });
});

l3Case("P4-MCP-PROT-007", "the live tools/list equals the committed snapshot", async (ctx) => {
  await eachServer(async ({ server, oracle, client }) => {
    const before = await oracle.snapshot();
    const c = client();
    await c.initialize();
    tagged(ctx, server, toolsMatchPin(toolsSnapshot(server), await c.listTools()));
    ctx.check(unchanged(before, await oracle.snapshot()));
  });
});
