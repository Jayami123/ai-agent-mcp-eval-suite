import { test } from "node:test";
import type { ProductAdapter } from "qa-portfolio-harness";
import { redact, writeEvidence } from "../../l1/evidence.js";
import { MattermostApi, MM_PREFIX, MM_TEAM, mattermostBaseUrl, secondAuthorization } from "../../../src/oracles/mattermost.js";
import { McpHttpClient, type ToolDef } from "../support/mcp-client.js";
import { runtime } from "../support/runtime.js";

// Live probe for the Mattermost wave (CI, P4_L3_CAPTURE=1). Runs before any assertion is written: it records what the real
// pinned Mattermost MCP and the real API return, so docs/findings/l3-mattermost.md and the assertions come from observation.
// It asserts nothing. Bearers are redacted and never written. Only names, statuses and error shapes are printed; message
// bodies are the fixed probe text, and the job log prints only the first 200 characters of any reply.
const DIR = "l3-capture";
const short = (v: unknown, n = 200): string => JSON.stringify(v).slice(0, n);
const shape = (v: unknown): string => (v !== null && typeof v === "object" ? `keys=${Object.keys(v as object).sort().join(",")}` : typeof v);

interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  httpStatus: number;
  rpcKeys: string;
  isError: boolean | undefined;
  errorShape: string;
  resultPreview: string;
}

function argsFor(tool: ToolDef, channel: string, team: string): Record<string, unknown> {
  const props = ((tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    const k = key.toLowerCase();
    if (k.includes("channel")) out[key] = channel;
    else if (k.includes("team")) out[key] = team;
    else if (k.includes("message") || k === "text" || k === "content") out[key] = "p4l3 probe message";
    else if (k.includes("query")) out[key] = "p4l3";
    else if (k.includes("limit") || k === "per_page") out[key] = 5;
  }
  return out;
}

test("MM probe: tools/list, error shapes, member channel create, MCP post author, seeded posts", { timeout: 25 * 60_000 }, async () => {
  const rt = runtime();
  const adapter = rt.stack.adapters.get("mattermost") as ProductAdapter;
  const mcp = rt.stack.mcp("mattermost");
  const secrets = [mcp.authorization ?? "", secondAuthorization(adapter)].filter((s) => s !== "");
  const runTag = `${Date.now().toString(36)}`;
  const channel = `${MM_PREFIX}probe-${runTag}`;

  // 1. MCP handshake and tools/list (the snapshot candidate).
  const client = new McpHttpClient(mcp.url, mcp.authorization);
  const init = await client.initialize();
  console.log(`MM probe initialize: HTTP ${init.status}, session header ${init.headers.get("mcp-session-id") !== null}`);
  writeEvidence(DIR, "mattermost.initialize.json", `${redact(JSON.stringify({ status: init.status, body: init.body }, null, 2), secrets)}\n`);
  const tools = await client.listTools();
  writeEvidence(DIR, "mattermost.tools.json", `${JSON.stringify({ tools }, null, 2)}\n`);
  console.log(`MM probe tools/list: ${tools.length} tools`);
  for (const t of tools) console.log(`  tool ${t.name} props=${Object.keys(((t.inputSchema as { properties?: object } | undefined)?.properties ?? {})).join(",")}`);

  // 2. The member's own API view (the MCP's identity) and the second identity's.
  const memberApi = new MattermostApi(mattermostBaseUrl(), mcp.authorization ?? "");
  const secondApi = new MattermostApi(mattermostBaseUrl(), secondAuthorization(adapter));
  const member = await memberApi.me();
  const second = await secondApi.me();
  console.log(`MM probe identities: member=${member.username} (roles ${member.roles}), second=${second.username} (roles ${second.roles})`);
  const team = await secondApi.teamId();

  // 3. Can a member create a public channel? (seeding needs it.) Recorded shape only.
  const created = await secondApi.call<{ id?: string; name?: string; message?: string; id_error?: string }>("POST", "/channels", { team_id: team, name: channel, display_name: channel, type: "O" });
  console.log(`MM probe channel create (second identity): HTTP ${created.status}, body ${shape(created.body)}`);
  writeEvidence(DIR, "mattermost.channel-create.json", `${JSON.stringify({ status: created.status, shape: shape(created.body), name: channel, hasId: typeof created.body.id === "string" }, null, 2)}\n`);
  const channelId = typeof created.body.id === "string" ? created.body.id : undefined;

  // 4. Error shapes from the real MCP: unknown channel, and a call with no arguments, for each tool (names and shapes only).
  const records: ToolCallRecord[] = [];
  for (const t of tools) {
    const args = argsFor(t, channel, MM_TEAM);
    const r = await client.callTool(t.name, args);
    const body = (r.body ?? {}) as { result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: { code?: number; message?: string } };
    const rec: ToolCallRecord = {
      tool: t.name,
      args,
      httpStatus: r.status,
      rpcKeys: shape(r.body),
      isError: body.result?.isError,
      errorShape: body.error !== undefined ? `jsonrpc error code=${body.error.code}` : body.result?.isError === true ? "tool isError" : "ok",
      resultPreview: redact(short(body.result?.content ?? body.error ?? r.body, 200), secrets),
    };
    records.push(rec);
    console.log(`MM probe call ${t.name}: HTTP ${rec.httpStatus}, ${rec.errorShape}, args=${Object.keys(args).join(",") || "(none)"}`);
  }
  writeEvidence(DIR, "mattermost.calls.json", `${redact(JSON.stringify(records, null, 2), secrets)}\n`);

  // 5. Seeded posts (H7) and the second identity (H2), through the harness's own live probes. Counts and usernames only.
  const seeded = await (adapter as ProductAdapter & { probeSeededPosts?: () => Promise<unknown> }).probeSeededPosts?.();
  const identity = await (adapter as ProductAdapter & { probeSecondIdentity?: () => Promise<unknown> }).probeSecondIdentity?.();
  console.log(`MM probe H7 seeded posts: ${JSON.stringify(seeded)}`);
  console.log(`MM probe H2 second identity: ${JSON.stringify(identity)}`);
  writeEvidence(DIR, "mattermost.harness-probes.json", `${JSON.stringify({ seeded, identity }, null, 2)}\n`);

  // 5b. Who authored what in the probe channel: the member (MCP identity) versus the second identity.
  if (channelId !== undefined) {
    const posts = await secondApi.channelPosts(channelId);
    const authors = posts.map((p) => (p.user_id === member.id ? "member" : p.user_id === second.id ? "second" : "other"));
    console.log(`MM probe posts in probe channel: ${posts.length}, authors=${authors.join(",") || "none"}`);
    writeEvidence(DIR, "mattermost.probe-channel-posts.json", `${JSON.stringify({ count: posts.length, authors }, null, 2)}\n`);
  }

  // 6. Clean up the probe channel (archive it; the sweep also archives suite channels from earlier runs).
  if (channelId !== undefined) {
    const del = await secondApi.call("DELETE", `/channels/${channelId}`);
    console.log(`MM probe archive probe channel: HTTP ${del.status}`);
  }
});

