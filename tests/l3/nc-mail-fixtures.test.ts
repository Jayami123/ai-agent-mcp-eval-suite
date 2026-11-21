import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { jsonDiff, parseSmtpReplies, rfc822, smtpDelivered } from "./support/nc-mail-seed.js";

// Static checks for the NCMAIL cases, run in every `npm test`. The argument names of every Nextcloud tool call in the new fixtures
// are checked against tests/l3/snapshots/nextcloud.tools.json (the server's own schema), so a guessed name fails here, not in CI.

const ROOT = process.cwd();
const FIXTURES = [
  "p4-mcp-inj-001-control",
  "p4-mcp-inj-001-hostile",
  "p4-mcp-inj-002-control",
  "p4-mcp-inj-002-hostile",
  "p4-mcp-inj-003-control",
  "p4-mcp-inj-003-hostile",
  "p4-mcp-inj-014",
  "p4-mcp-tool-007-send",
  "p4-mcp-flow-002-control",
  "p4-mcp-flow-002-hostile",
  "p4-mcp-flow-011",
  "p4-mcp-flow-009-control",
  "p4-mcp-flow-009-hostile",
];

interface Turn {
  tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  content?: string;
}

function loadFixture(id: string): { id: string; turns: Turn[] } {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "src", "stub", "fixtures", `${id}.json`), "utf8")) as { id: string; turns: Turn[] };
}

interface Schema {
  name: string;
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
}

const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "l3", "snapshots", "nextcloud.tools.json"), "utf8")) as
  | { tools: Schema[] }
  | Schema[];
const SCHEMAS: Schema[] = Array.isArray(snapshot) ? snapshot : snapshot.tools;
const schemaFor = (name: string): Schema | undefined => SCHEMAS.find((s) => s.name === name);

test("every fixture file is valid JSON with the id it is named by", () => {
  for (const id of FIXTURES) {
    const f = loadFixture(id);
    assert.equal(f.id, id);
    assert.ok(Array.isArray(f.turns) && f.turns.length >= 2, `${id}: needs tool turns and a final turn`);
    assert.ok(f.turns[f.turns.length - 1]?.content !== undefined, `${id}: the last turn is the final text`);
  }
});

test("every Nextcloud tool call names a tool in the server schema, with only known and all required arguments", () => {
  const problems: string[] = [];
  for (const id of FIXTURES) {
    for (const turn of loadFixture(id).turns) {
      for (const call of turn.tool_calls ?? []) {
        if (!call.name.endsWith("_mcp_nextcloud")) continue;
        const base = call.name.slice(0, -"_mcp_nextcloud".length);
        const s = schemaFor(base);
        if (s === undefined) {
          problems.push(`${id}: ${base} is not a Nextcloud tool in the snapshot`);
          continue;
        }
        const props = Object.keys(s.inputSchema.properties ?? {});
        for (const key of Object.keys(call.arguments)) {
          if (!props.includes(key)) problems.push(`${id}: ${base} has no argument "${key}"`);
        }
        for (const req of s.inputSchema.required ?? []) {
          if (!(req in call.arguments)) problems.push(`${id}: ${base} is missing required argument "${req}"`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("mail recipients are objects with an email, as the send tool's MailRecipient requires", () => {
  for (const id of FIXTURES) {
    for (const turn of loadFixture(id).turns) {
      for (const call of turn.tool_calls ?? []) {
        if (call.name !== "nc_mail_send_message_mcp_nextcloud") continue;
        const to = call.arguments["to"];
        assert.ok(Array.isArray(to) && to.length > 0, `${id}: to must be a non-empty list`);
        for (const r of to as Array<Record<string, unknown>>) assert.equal(typeof r["email"], "string", `${id}: each recipient needs an email`);
      }
    }
  }
});

test("no fixture uses [var:] markers (a var must be used by every turn; run-time ids are bindings)", () => {
  for (const id of FIXTURES) {
    const text = fs.readFileSync(path.join(ROOT, "src", "stub", "fixtures", `${id}.json`), "utf8");
    assert.ok(!text.includes("{{owner_"), `${id}: old var placeholder`);
  }
});

test("every {{bind:NAME}} placeholder in the new fixtures is set by a test source (no fixture points at an unset binding)", () => {
  const sources = fs
    .readdirSync(path.join(ROOT, "tests", "l3"), { recursive: true, withFileTypes: false })
    .map((p) => String(p))
    .filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))
    .map((p) => fs.readFileSync(path.join(ROOT, "tests", "l3", p), "utf8"))
    .join("\n");
  for (const id of FIXTURES) {
    const text = fs.readFileSync(path.join(ROOT, "src", "stub", "fixtures", `${id}.json`), "utf8");
    for (const m of text.matchAll(/\{\{bind:([A-Z][A-Z0-9_]*)\}\}/g)) {
      assert.ok(sources.includes(m[1] ?? "@"), `${id}: binding ${m[1]} is never set by a test`);
    }
  }
});

test("nc_calendar_list_events needs calendar_name or search_all_calendars: true (the server refuses otherwise)", () => {
  for (const id of FIXTURES) {
    for (const turn of loadFixture(id).turns) {
      for (const call of turn.tool_calls ?? []) {
        if (call.name !== "nc_calendar_list_events_mcp_nextcloud") continue;
        const ok = typeof call.arguments["calendar_name"] === "string" || call.arguments["search_all_calendars"] === true;
        assert.ok(ok, `${id}: nc_calendar_list_events has neither calendar_name nor search_all_calendars`);
      }
    }
  }
});

test("rfc822: CRLF line ends, dot-stuffed body lines, and the owner's subject", () => {
  const msg = rfc822({ from: "a@p4.test", to: "qa-owner@p4.test", subject: "p4l3 subject", body: ".hidden line\nplain" }, new Date("2026-11-21T10:00:00Z"), "abc");
  assert.match(msg, /^From: a@p4\.test\r\nTo: qa-owner@p4\.test\r\nSubject: p4l3 subject\r\n/);
  assert.ok(msg.includes("\r\n..hidden line\r\n"), "a leading dot is doubled");
  assert.ok(msg.includes("plain\r\n--p4l3-part-boundary--\r\n"), "the body is the part, closed by the boundary");
  assert.equal(msg.split("\n").length, msg.split("\r\n").length, "every line end is CRLF");
});

test("parseSmtpReplies reads the codes, and smtpDelivered needs every step's reply", () => {
  const out = "greeting 220\nehlo 250\nmail 250\nrcpt 250\ndata 354\nend 250\n";
  const r = parseSmtpReplies(out);
  assert.deepEqual(r, { greeting: "220", ehlo: "250", mail: "250", rcpt: "250", data: "354", end: "250" });
  assert.equal(smtpDelivered(r), true);
  assert.equal(smtpDelivered({ ...r, rcpt: "550" }), false, "a refused recipient is not delivered");
  assert.equal(smtpDelivered({ ...r, end: "554" }), false, "a rejected body is not delivered");
  assert.deepEqual(parseSmtpReplies("connect failed\n"), {});
});

test("Mattermost read_channel calls send channel_id, and Outline fetch calls send resource and id (as the passing fixtures do)", () => {
  for (const id of FIXTURES) {
    for (const turn of loadFixture(id).turns) {
      for (const call of turn.tool_calls ?? []) {
        if (call.name === "read_channel_mcp_mattermost") {
          assert.equal(typeof call.arguments["channel_id"], "string", `${id}: read_channel needs channel_id`);
        }
        if (call.name === "fetch_mcp_outline") {
          assert.equal(call.arguments["resource"], "document", `${id}: fetch needs resource "document"`);
          assert.equal(typeof call.arguments["id"], "string", `${id}: fetch needs id`);
        }
      }
    }
  }
});

test("rfc822 seed is a one-part multipart/mixed, so the body section is a real part (GreenMail FETCH needs it)", () => {
  const msg = rfc822({ from: "a@p4.test", to: "qa-owner@p4.test", subject: "s", body: "text" }, new Date("2026-11-21T10:00:00Z"), "id1");
  assert.match(msg, /Content-Type: multipart\/mixed; boundary="p4l3-part-boundary"\r\n/);
  assert.ok(msg.includes("--p4l3-part-boundary\r\nContent-Type: text/plain; charset=utf-8\r\n"));
  assert.ok(msg.endsWith("--p4l3-part-boundary--\r\n"));
});

test("jsonDiff names each differing path with both values, and nothing when equal", () => {
  assert.deepEqual(jsonDiff({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] }), ["$.b[1]: 2 -> 3"]);
  assert.deepEqual(jsonDiff({ a: 1 }, { a: 1, c: "x" }), ['$.c: <absent> -> "x"']);
  assert.deepEqual(jsonDiff({ a: [1] }, { a: [1, 2] }), ["$.a[1]: <absent> -> 2", "$.a: length 1 -> 2"]);
  assert.deepEqual(jsonDiff({ a: 1 }, { a: 1 }), []);
});
