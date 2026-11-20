import { test } from "node:test";
import type { ProductAdapter } from "qa-portfolio-harness";
import { redact, writeEvidence } from "../../l1/evidence.js";
import { MattermostApi, MM_PREFIX, mattermostBaseUrl, secondAuthorization } from "../../../src/oracles/mattermost.js";
import { McpHttpClient, type ToolDef } from "../support/mcp-client.js";
import { runtime } from "../support/runtime.js";

// Live probe for the Mattermost wave (CI, P4_L3_CAPTURE=1). Round 2: real IDs in arguments, and the reply text printed for
// every call, because a tool can answer HTTP 200 with an application error in its text. It asserts nothing. Bearers are
// redacted and never written. The job log prints at most 140 characters of any reply; the evidence keeps 400.
const DIR = "l3-capture";
const PREVIEW_LOG = 140;
const PREVIEW_EVIDENCE = 400;
const TEXT_ERROR = /error|not found|invalid|required|forbidden|denied|unauthori[sz]ed|failed/i;

interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  httpStatus: number;
  classification: string;
  preview: string;
}

/** The reply's text content, joined. Falls back to the JSON-RPC error message. */
function replyText(body: unknown): string {
  const b = (body ?? {}) as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
  if (b.error !== undefined) return `jsonrpc error: ${b.error.message ?? ""}`;
  return (b.result?.content ?? []).map((c) => c.text ?? "").join(" ");
}

function classify(body: unknown): string {
  const b = (body ?? {}) as { result?: { isError?: boolean }; error?: unknown };
  if (b.error !== undefined) return "jsonrpc-error";
  const text = replyText(body);
  if (b.result?.isError === true) return "tool-isError";
  if (TEXT_ERROR.test(text.slice(0, 160))) return "ok-flag-but-error-text";
  return "ok";
}

function argsFor(tool: ToolDef, ids: { channelId: string; teamId: string; username: string; userId: string }): Record<string, unknown> {
  const props = ((tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    const k = key.toLowerCase();
    if (k === "channel_id") out[key] = ids.channelId;
    else if (k === "team_id") out[key] = ids.teamId;
    else if (k === "username") out[key] = ids.username;
    else if (k === "user_id") out[key] = ids.userId;
    else if (k.includes("message") || k === "text" || k === "content") out[key] = "p4l3 probe message";
    else if (k.includes("query") || k === "term") out[key] = "p4l3";
    else if (k.includes("limit") || k === "per_page") out[key] = 5;
  }
  return out;
}

test("MM probe round 2: real IDs, reply text, MCP post author", { timeout: 25 * 60_000 }, async () => {
  const rt = runtime();
  const adapter = rt.stack.adapters.get("mattermost") as ProductAdapter;
  const mcp = rt.stack.mcp("mattermost");
  const secrets = [mcp.authorization ?? "", secondAuthorization(adapter)].filter((s) => s !== "");
  const channel = `${MM_PREFIX}probe-${Date.now().toString(36)}`;

  const client = new McpHttpClient(mcp.url, mcp.authorization);
  await client.initialize();
  const tools = await client.listTools();
  writeEvidence(DIR, "mattermost.tools.json", `${JSON.stringify({ tools }, null, 2)}\n`);
  console.log(`MM probe2 tools: ${tools.length}`);

  const memberApi = new MattermostApi(mattermostBaseUrl(), mcp.authorization ?? "");
  const secondApi = new MattermostApi(mattermostBaseUrl(), secondAuthorization(adapter));
  const member = await memberApi.me();
  const second = await secondApi.me();
  const teamId = await secondApi.teamId();
  const created = await secondApi.call<{ id?: string }>("POST", "/channels", { team_id: teamId, name: channel, display_name: channel, type: "O" });
  const channelId = typeof created.body.id === "string" ? created.body.id : "";
  console.log(`MM probe2 setup: member=${member.username}, second=${second.username}, channel create HTTP ${created.status}, channelId=${channelId !== "" ? "set" : "missing"}`);
  if (channelId === "") throw new Error("MM_PROBE_NO_CHANNEL: could not create the probe channel (see HTTP status above)");
  const ids = { channelId, teamId, username: second.username, userId: second.id };

  // 1. Every tool, with real IDs. Reply text is printed (truncated) and classified from both the flag and the text.
  const records: ToolCallRecord[] = [];
  for (const t of tools) {
    const args = argsFor(t, ids);
    const r = await client.callTool(t.name, args);
    const preview = redact(replyText(r.body).slice(0, PREVIEW_EVIDENCE), secrets);
    const rec: ToolCallRecord = { tool: t.name, args: Object.fromEntries(Object.keys(args).map((k) => [k, "<id-or-probe-text>"])), httpStatus: r.status, classification: classify(r.body), preview };
    records.push(rec);
    console.log(`MM probe2 ${t.name} [${Object.keys(args).join(",") || "none"}] HTTP ${r.status} ${rec.classification}: ${redact(preview.slice(0, PREVIEW_LOG), secrets)}`);
  }
  writeEvidence(DIR, "mattermost.calls.json", `${JSON.stringify(records, null, 2)}\n`);

  // 2. The MCP write path, explicitly: post through create_post, then read the channel back through the API.
  const post = await client.callTool("create_post", { channel_id: channelId, message: "p4l3 probe via mcp create_post" });
  console.log(`MM probe2 create_post (explicit): HTTP ${post.status} ${classify(post.body)}: ${redact(replyText(post.body).slice(0, PREVIEW_LOG), secrets)}`);
  const posts = await secondApi.channelPosts(channelId);
  const authors = posts.map((p) => (p.user_id === member.id ? "member" : p.user_id === second.id ? "second" : "other"));
  console.log(`MM probe2 channel posts after create_post: ${posts.length}, authors=${authors.join(",")}`);
  writeEvidence(DIR, "mattermost.probe-channel-posts.json", `${JSON.stringify({ count: posts.length, authors }, null, 2)}\n`);

  // 3. Seeded posts (H7) and the second identity (H2), through the harness's own live probes.
  const seeded = await (adapter as ProductAdapter & { probeSeededPosts?: () => Promise<unknown> }).probeSeededPosts?.();
  const identity = await (adapter as ProductAdapter & { probeSecondIdentity?: () => Promise<unknown> }).probeSecondIdentity?.();
  console.log(`MM probe2 H7: ${JSON.stringify(seeded)}`);
  console.log(`MM probe2 H2: ${JSON.stringify(identity)}`);

  // 4. Archive the probe channel.
  const del = await secondApi.call("DELETE", `/channels/${channelId}`);
  console.log(`MM probe2 archive: HTTP ${del.status}`);
});
