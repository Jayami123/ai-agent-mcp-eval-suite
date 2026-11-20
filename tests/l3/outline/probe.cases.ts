import fs from "node:fs";
import { test } from "node:test";
import type { ProductAdapter } from "qa-portfolio-harness";
import { dataOf, OutlineOracle, type OutlineApiReply } from "../../../src/oracles/outline.js";
import { redact, writeEvidence } from "../../l1/evidence.js";
import { McpHttpClient, type ToolDef } from "../support/mcp-client.js";
import { runtime } from "../support/runtime.js";

// Outline live probe (spike, step 2 of docs/plans/2026-11-20-l3-outline-wave.md). Runs only with P4_L3_OUTLINE_PROBE=1.
// It records what Outline's REST API and its built-in MCP really answer, using REAL IDs discovered at run time. It asserts
// nothing. Every line is redacted, and the owner's and second user's Authorization values never reach the log or evidence.
// The output is written to evidence/l3-outline-probe/probe.txt and printed as "[outline-probe] ..." lines in the job log.

const DIR = "l3-outline-probe";
const PROBE_TITLE = "P4L3 Probe";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" ? (v as Json) : {});

/** Status, top-level keys, error name and a short message. Never a key or token, and no full body. */
function shape(reply: OutlineApiReply): Json {
  const j = obj(reply.json);
  const data = j["data"];
  const out: Json = { status: reply.status, keys: Object.keys(j).sort() };
  if (Array.isArray(data)) out["dataArrayLength"] = data.length;
  else if (data !== null && typeof data === "object") out["dataKeys"] = Object.keys(data as Json).sort();
  if (typeof j["error"] === "string") out["error"] = j["error"];
  if (typeof j["message"] === "string") out["message"] = j["message"].slice(0, 200);
  return out;
}

/** The MCP reply: isError, JSON-RPC error if any, and the first text of the tool result (400 characters). */
function mcpShape(res: { status: number; body: unknown }): Json {
  const b = obj(res.body);
  const result = obj(b["result"]);
  const content = Array.isArray(result["content"]) ? (result["content"] as Json[]) : [];
  const text = content.map((c) => (typeof c["text"] === "string" ? c["text"] : "")).join("\n");
  const out: Json = { httpStatus: res.status, isError: result["isError"] === true };
  if (obj(b["error"])["message"] !== undefined) out["rpcError"] = String(obj(b["error"])["message"]).slice(0, 200);
  out["text"] = text.slice(0, 400);
  return out;
}

/** Arguments for a tool, built from its input schema and the real IDs the probe discovered. Names are never guessed. */
function argsFor(tool: ToolDef, ids: { collectionId: string; docId: string }): Json {
  const props = obj(obj(tool.inputSchema)["properties"]);
  const args: Json = {};
  for (const [name, schema] of Object.entries(props)) {
    const s = obj(schema);
    if (/collection/i.test(name)) args[name] = ids.collectionId;
    else if (/^(id|documentId|document_id)$/i.test(name)) args[name] = ids.docId;
    else if (/query|search/i.test(name)) args[name] = PROBE_TITLE;
    else if (/limit/i.test(name)) args[name] = 5;
    else if (/title/i.test(name)) args[name] = `${PROBE_TITLE} MCP`;
    else if (/text|content|body/i.test(name)) args[name] = "P4L3 probe MCP body.";
    else if (/publish/i.test(name) || s["type"] === "boolean") args[name] = true;
  }
  return args;
}

/** The second identity's MCP credential from its own run-state file (H2). Read, never printed. */
function secondAuthorization(adapter: ProductAdapter): string {
  const file = (adapter as { secondRunStateFile?: () => string }).secondRunStateFile?.();
  if (file === undefined) throw new Error("OUTLINE_PROBE_NO_SECOND: the adapter exposes no secondRunStateFile");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpAuthorization?: unknown };
  if (typeof parsed.mcpAuthorization !== "string") throw new Error("OUTLINE_PROBE_SECOND_SHAPE: no mcpAuthorization in the second run state");
  return parsed.mcpAuthorization;
}

test("OUTLINE PROBE: REST, MCP and viewer behaviour on the real stack (records only)", { skip: process.env["P4_L3_OUTLINE_PROBE"] !== "1", timeout: 25 * 60_000 }, async () => {
  const rt = runtime();
  const adapter = rt.stack.adapters.get("outline") as ProductAdapter;
  const owner = rt.stack.mcp("outline");
  const ownerAuth = owner.authorization ?? "";
  const viewerAuth = secondAuthorization(adapter);
  const secrets = [ownerAuth, viewerAuth];
  const oracle = new OutlineOracle(OutlineOracle.originOf(owner.url), ownerAuth);
  const lines: string[] = [];
  const rec = (label: string, value: unknown): void => {
    const line = redact(`${label} ${JSON.stringify(value)}`, secrets);
    lines.push(line);
    console.log(`[outline-probe] ${line}`);
  };
  const rest = async (label: string, auth: string, route: string, body: Json = {}): Promise<OutlineApiReply> => {
    const reply = await oracle.api(auth, route, body);
    rec(`${label} ${route}`, shape(reply));
    return reply;
  };
  const created: Array<{ kind: "documents" | "collections"; id: string }> = [];

  try {
    // 1. Owner REST: identity, collections, documents with real IDs.
    const me = await rest("owner", ownerAuth, "auth.info");
    rec("owner user role", { role: obj(obj(dataOf(me))["user"])["role"] ?? null });
    await rest("owner", ownerAuth, "collections.list", { limit: 25 });
    const pub = await rest("owner", ownerAuth, "collections.create", { name: `${PROBE_TITLE} Public`, permission: "read_write" });
    const pubId = String(obj(dataOf(pub))["id"] ?? "");
    if (pubId !== "") created.push({ kind: "collections", id: pubId });
    const res = await rest("owner", ownerAuth, "collections.create", { name: `${PROBE_TITLE} Restricted` });
    const resId = String(obj(dataOf(res))["id"] ?? "");
    if (resId !== "") created.push({ kind: "collections", id: resId });
    rec("ids discovered", { publicCollection: pubId !== "", restrictedCollection: resId !== "" });

    const d1 = await rest("owner", ownerAuth, "documents.create", { title: `${PROBE_TITLE} Welcome`, text: "P4L3 probe welcome body.", collectionId: pubId, publish: true });
    const docId = String(obj(dataOf(d1))["id"] ?? "");
    if (docId !== "") created.push({ kind: "documents", id: docId });
    const d2 = await rest("owner", ownerAuth, "documents.create", { title: `${PROBE_TITLE} Restricted Canary`, text: "P4L3 probe restricted body.", collectionId: resId, publish: true });
    const resDocId = String(obj(dataOf(d2))["id"] ?? "");
    if (resDocId !== "") created.push({ kind: "documents", id: resDocId });

    await rest("owner", ownerAuth, "documents.list", { collectionId: pubId });
    await rest("owner", ownerAuth, "documents.info", { id: docId });
    await rest("owner", ownerAuth, "documents.search", { query: PROBE_TITLE });
    await rest("owner", ownerAuth, "documents.update", { id: docId, text: "P4L3 probe welcome body, revised.", append: false });
    await rest("owner", ownerAuth, "revisions.list", { documentId: docId });
    await rest("owner", ownerAuth, "documents.publish", { id: docId });
    await rest("owner", ownerAuth, "collections.memberships", { id: resId });
    await rest("owner", ownerAuth, "collections.memberships", { id: pubId });

    // 2. The second user: find it, then try the role change candidates (the probe decides which route exists).
    const users = await rest("owner", ownerAuth, "users.list", { limit: 50 });
    const list = (dataOf(users) as Json[] | undefined) ?? [];
    const second = list.find((u) => obj(u)["email"] === "qa-user-b@p4.test");
    const secondId = String(obj(second)["id"] ?? "");
    rec("second user", { found: secondId !== "", role: obj(second)["role"] ?? null });
    if (secondId !== "") {
      const up = await rest("owner", ownerAuth, "users.update_role", { id: secondId, role: "viewer" });
      if (up.status !== 200) await rest("owner", ownerAuth, "users.demote", { id: secondId, to: "viewer" });
      await rest("owner", ownerAuth, "users.info", { id: secondId });
    }

    // 3. Import (multipart) into the public collection, with a small Markdown file.
    const form = new FormData();
    form.append("collectionId", pubId);
    form.append("file", new Blob(["# P4L3 Probe Import\n\nP4L3 probe import body.\n"], { type: "text/markdown" }), "p4l3-probe-import.md");
    const imp = await fetch(`${oracle.baseUrl}/api/documents.import`, { method: "POST", headers: { authorization: ownerAuth }, body: form, signal: AbortSignal.timeout(30_000) });
    const impJson = await imp.json().catch(() => undefined);
    rec("owner documents.import (multipart)", shape({ status: imp.status, json: impJson }));

    // 4. Owner MCP: initialize, tools/list, then every read-looking tool with real IDs.
    const ownerMcp = new McpHttpClient(owner.url, ownerAuth);
    const init = await ownerMcp.initialize();
    rec("owner MCP initialize", { httpStatus: init.status, sessionHeader: init.headers.get("mcp-session-id") !== null });
    const tools = await ownerMcp.listTools();
    writeEvidence(DIR, "owner.tools.json", `${JSON.stringify({ tools }, null, 2)}\n`);
    rec("owner MCP tools/list", { count: tools.length, names: tools.map((t) => t.name) });
    for (const tool of tools) console.log(`[outline-probe-tool] ${JSON.stringify(tool)}`);
    for (const tool of tools.filter((t) => /list|search|info|get|read|find|create|import|publish|move|update/i.test(t.name))) {
      const args = argsFor(tool, { collectionId: pubId, docId });
      const reply = await ownerMcp.callTool(tool.name, args);
      rec(`owner MCP ${tool.name}`, { argKeys: Object.keys(args).sort(), ...mcpShape(reply) });
    }

    // 5. Viewer (second identity): REST identity, read and create in the restricted collection, then MCP.
    const vme = await rest("viewer", viewerAuth, "auth.info");
    rec("viewer user role", { role: obj(obj(dataOf(vme))["user"])["role"] ?? null });
    await rest("viewer", viewerAuth, "documents.list", { collectionId: resId });
    const vAttempt = await rest("viewer", viewerAuth, "documents.create", { title: `${PROBE_TITLE} Viewer Attempt`, text: "x", collectionId: resId, publish: true });
    const vAttemptId = String(obj(dataOf(vAttempt))["id"] ?? "");
    if (vAttemptId !== "") created.push({ kind: "documents", id: vAttemptId });
    const viewerMcp = new McpHttpClient(owner.url, viewerAuth);
    await viewerMcp.initialize();
    const vtools = await viewerMcp.listTools();
    rec("viewer MCP tools/list", { count: vtools.length });
    const vpos = await viewerMcp.callTool("list_collection_documents", { collectionId: pubId });
    rec("viewer MCP list_collection_documents (public, positive control)", mcpShape(vpos));
    const vcols = await viewerMcp.callTool("list_collections", { limit: 25 });
    console.log(`[outline-probe-full] viewer list_collections ${JSON.stringify(redact(JSON.stringify(vcols.body), secrets)).slice(0, 4000)}`);
    rec("viewer list_collections names-only check", { restrictedTitleVisible: JSON.stringify(vcols.body).includes(`${PROBE_TITLE} Restricted`), publicTitleVisible: JSON.stringify(vcols.body).includes(`${PROBE_TITLE} Public`) });
    for (const tool of vtools.filter((t) => /list|search|info|get|read|find|create|import|publish|move|update/i.test(t.name))) {
      const args = argsFor(tool, { collectionId: resId, docId: resDocId });
      const reply = await viewerMcp.callTool(tool.name, args);
      rec(`viewer MCP ${tool.name}`, { argKeys: Object.keys(args).sort(), ...mcpShape(reply) });
    }
    const restrictedAfter = await rest("owner", ownerAuth, "documents.list", { collectionId: resId });
    rec("restricted collection documents after the viewer's attempts (owner view)", { titles: ((dataOf(restrictedAfter) as Json[] | undefined) ?? []).map((d) => obj(d)["title"]) });
  } finally {
    // Cleanup sweep for this probe: delete every document and collection it created (IDs from the replies above).
    for (const item of created.reverse()) {
      const r = await oracle.api(ownerAuth, `${item.kind === "documents" ? "documents" : "collections"}.delete`, { id: item.id });
      rec(`cleanup ${item.kind}.delete`, { status: r.status });
    }
    writeEvidence(DIR, "probe.txt", `${lines.join("\n")}\n`);
  }
});
