import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadFixture } from "../../../src/stub/fixtures.js";

// Runs in the plain PR gate (no stack, no secrets). Every Penpot and mail call in the plugin fixtures must name a tool in the
// committed snapshot and send the arguments its schema requires. A tool name from memory fails here, before any stack starts.
// Sources: tests/l3/snapshots/penpot.tools.json (execute_code, export_shape, ...) and nextcloud.tools.json (nc_mail_send_message).

const DIR = path.resolve(process.cwd(), "src/stub/fixtures");
const SNAP = path.resolve(process.cwd(), "tests/l3/snapshots");
const FIXTURES = [
  "penpot-ppb-probe",
  "p4-mcp-tool-005-fetch",
  "p4-mcp-inj-007-control",
  "p4-mcp-inj-007-hostile",
  "p4-mcp-inj-008-control",
  "p4-mcp-inj-008-hostile",
  "p4-mcp-flow-006-control",
  "p4-mcp-flow-006-hostile",
];
// Tools the Nextcloud snapshot leaves out, because they appear only in a lab mode (lab shadow names). nc_mail_send_message is
// listed by the live Nextcloud MCP in the wave D probe (docs/findings/l3-wave-d.md); the snapshot names it when mail is on.
const SNAPSHOT_MISSING_OK = new Set(["nc_mail_send_message"]);

interface Schema {
  required?: string[];
  properties?: Record<string, { enum?: unknown[] }>;
}
const snapshotTools = (server: string): Map<string, Schema> => {
  const file = path.join(SNAP, `${server}.tools.json`);
  const tools = (JSON.parse(fs.readFileSync(file, "utf8")) as { tools: Array<{ name: string; inputSchema?: Schema }> }).tools;
  return new Map(tools.map((t) => [t.name, t.inputSchema ?? {}]));
};
const penpot = snapshotTools("penpot");
const nextcloud = snapshotTools("nextcloud");

interface Call {
  name: string;
  arguments: Record<string, unknown>;
}
const calls = (id: string): Call[] => loadFixture(DIR, id).turns.flatMap((t) => (t.tool_calls ?? []) as Call[]);

test("every Penpot fixture names a tool the Penpot snapshot lists, with the LibreChat suffix", () => {
  for (const id of FIXTURES) {
    for (const c of calls(id)) {
      const m = /^(.+)_mcp_(penpot|nextcloud)$/.exec(c.name);
      assert.ok(m, `${id}: ${c.name} does not end in _mcp_<server>`);
      const tools = m[2] === "penpot" ? penpot : nextcloud;
      assert.ok(tools.has(m[1] ?? "") || (m[2] === "nextcloud" && SNAPSHOT_MISSING_OK.has(m[1] ?? "")), `${id}: ${m[1]} is not in the ${m[2]} snapshot`);
    }
  }
});

test("execute_code sends a non-empty code string, and export_shape sends a shapeId and an allowed format", () => {
  for (const id of FIXTURES) {
    for (const c of calls(id)) {
      if (c.name === "execute_code_mcp_penpot") {
        assert.ok(typeof c.arguments["code"] === "string" && (c.arguments["code"] as string).length > 0, `${id}: execute_code needs code`);
      }
      if (c.name === "export_shape_mcp_penpot") {
        assert.ok(typeof c.arguments["shapeId"] === "string" && (c.arguments["shapeId"] as string).length > 0, `${id}: export_shape needs shapeId`);
        const allowed = penpot.get("export_shape")?.properties?.["format"]?.enum ?? [];
        if (c.arguments["format"] !== undefined) assert.ok(allowed.includes(c.arguments["format"]), `${id}: export_shape format ${String(c.arguments["format"])} is not in the schema enum`);
      }
    }
  }
});

test("the mail call sends account_id, a list of {email} recipients, a subject and a body", () => {
  for (const id of FIXTURES) {
    for (const c of calls(id).filter((x) => x.name === "nc_mail_send_message_mcp_nextcloud")) {
      assert.ok(c.arguments["account_id"] !== undefined, `${id}: nc_mail_send_message needs account_id`);
      const to = c.arguments["to"];
      assert.ok(Array.isArray(to) && to.length > 0 && to.every((r) => typeof (r as { email?: unknown }).email === "string"), `${id}: to must be a list of {email}`);
      assert.ok(typeof c.arguments["subject"] === "string" && typeof c.arguments["body"] === "string", `${id}: subject and body must be strings`);
    }
  }
});

test("every fixture ends with a text turn and makes at most one tool call per turn", () => {
  for (const id of FIXTURES) {
    const turns = loadFixture(DIR, id).turns;
    assert.ok(turns[turns.length - 1]?.content !== undefined, `${id}: the last turn must be text`);
    for (const t of turns) assert.ok((t.tool_calls ?? []).length <= 1, `${id}: a turn holds more than one tool call`);
  }
});

test("every sink URL in a fixture is the loopback sink on port 19171", () => {
  for (const id of FIXTURES) {
    const text = fs.readFileSync(path.join(DIR, `${id}.json`), "utf8");
    for (const m of text.matchAll(/https?:\/\/([^/'"\s]+)/g)) {
      assert.ok(m[1] === "127.0.0.1:19171", `${id}: ${m[0]} is not the loopback sink`);
    }
  }
});
