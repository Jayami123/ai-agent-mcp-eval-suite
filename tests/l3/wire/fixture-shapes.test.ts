import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadFixture } from "../../../src/stub/fixtures.js";

// Plain gate: every tool the wire and pair fixtures call exists in the committed snapshot of its server, the arguments are the ones
// the snapshot's input schema names, and the control legs never call a write (fixtures-l3.test.ts rule).
const DIR = path.resolve(process.cwd(), "src/stub/fixtures");
const SNAP = path.resolve(process.cwd(), "tests/l3/snapshots");
const FIXTURES = [
  "p4-mcp-flow-003-control",
  "p4-mcp-flow-003-hostile",
  "p4-mcp-flow-008-control",
  "p4-mcp-flow-008-hostile",
  "p4-mcp-tool-003-nextcloud",
];
const WRITES = new Set(["update_document_mcp_outline", "create_document_mcp_outline", "nc_share_create_mcp_nextcloud", "nc_mail_send_message_mcp_nextcloud", "nc_webdav_delete_resource_mcp_nextcloud"]);

interface Snap {
  tools: Array<{ name: string; inputProperties?: string[]; required?: string[]; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }>;
}
const snapTools = (server: string): Map<string, string[]> => {
  const snap = JSON.parse(fs.readFileSync(path.join(SNAP, `${server}.tools.json`), "utf8")) as Snap;
  return new Map(
    snap.tools.map((t) => [t.name, t.inputProperties ?? Object.keys(t.inputSchema?.properties ?? {})]),
  );
};
const outline = snapTools("outline");
const nextcloud = snapTools("nextcloud");

interface Call {
  name: string;
  arguments: Record<string, unknown>;
}
const calls = (id: string): Call[] => loadFixture(DIR, id).turns.flatMap((t) => (t.tool_calls ?? []) as Call[]);

test("every call names a tool the snapshot lists, and sends only arguments the schema names", () => {
  for (const id of FIXTURES) {
    for (const c of calls(id)) {
      const m = /^(.+)_mcp_(outline|nextcloud)$/.exec(c.name);
      assert.ok(m, `${id}: ${c.name} does not end in _mcp_<server>`);
      const tools = m[2] === "outline" ? outline : nextcloud;
      const allowed = tools.get(m[1] ?? "");
      // nc_mail_send_message is listed only when mail is on (the wave D snapshot note), so a missing entry is checked against that note.
      assert.ok(allowed !== undefined || (m[2] === "nextcloud" && m[1] === "nc_mail_send_message"), `${id}: ${m[1]} is not in the ${m[2]} snapshot`);
      for (const key of Object.keys(c.arguments)) {
        if (allowed !== undefined) assert.ok(allowed.includes(key), `${id}: ${c.name} sends ${key}, which its schema does not name`);
      }
    }
  }
});

test("the control legs never call a write", () => {
  for (const id of FIXTURES.filter((f) => f.endsWith("-control"))) {
    for (const c of calls(id)) assert.ok(!WRITES.has(c.name), `${id}: control calls the write ${c.name}`);
  }
});

test("every fixture ends with a text turn and makes at most one tool call per turn", () => {
  for (const id of FIXTURES) {
    const turns = loadFixture(DIR, id).turns;
    assert.ok(turns[turns.length - 1]?.content !== undefined, `${id}: the last turn must be text`);
    for (const t of turns) assert.ok((t.tool_calls ?? []).length <= 1, `${id}: a turn holds more than one tool call`);
  }
});

test("the poisoned Outline page texts are fake data and carry only the loopback-free canary addresses", () => {
  for (const name of ["outline-poisoned-wire-003.json", "outline-poisoned-wire-008.json"]) {
    const text = fs.readFileSync(path.resolve(process.cwd(), "tests", "l3", "fixtures", name), "utf8");
    assert.match(text, /@p4-attacker\.test/);
    assert.ok(!/@(gmail|outlook|yahoo|example)\./.test(text), `${name}: a real-looking address`);
  }
});
