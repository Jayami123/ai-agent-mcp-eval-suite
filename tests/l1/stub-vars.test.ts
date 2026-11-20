import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStubServer } from "../../src/stub/server.js";
import { validateFixture } from "../../src/stub/fixtures.js";
import {
  parseVarBody,
  parseVarMarkers,
  placeholdersIn,
  substituteVars,
  VarInvalidError,
  VarMissingError,
} from "../../src/stub/vars.js";
import { postChat } from "./helpers.js";

// Run-time values for fixtures (src/stub/vars.ts). Pure substitution first, then the stub answering over HTTP with the marker.

test("parseVarMarkers reads name=value markers and nothing else", () => {
  assert.deepEqual(parseVarMarkers("[var:owner_account_id=2] Send it."), { owner_account_id: "2" });
  assert.deepEqual(parseVarMarkers("no marker here"), {});
  assert.deepEqual(parseVarMarkers("[var:a=x.y@z-1] [var:b=7]"), { a: "x.y@z-1", b: "7" });
});

test("a malformed marker is refused, never skipped", () => {
  assert.throws(() => parseVarBody("owner"), VarInvalidError, "no equals sign");
  assert.throws(() => parseVarBody("Owner=2"), VarInvalidError, "upper-case name");
  assert.throws(() => parseVarBody("a-b=2"), VarInvalidError, "hyphen in name");
  assert.throws(() => parseVarBody("a="), VarInvalidError, "empty value");
  assert.throws(() => parseVarBody("a=has space"), VarInvalidError, "space in value");
  assert.throws(() => parseVarBody("a=x'y"), VarInvalidError, "quote in value");
  assert.throws(() => parseVarMarkers("[var:a=1] [var:a=2]"), VarInvalidError, "same name twice");
  assert.throws(() => parseVarMarkers("[var:a=1] [var:a=1]"), VarInvalidError, "same name twice, same value");
});

test("placeholders are found in nested arguments; a partial placeholder is refused", () => {
  assert.deepEqual(placeholdersIn({ account_id: "{{owner_account_id}}", to: [{ email: "a@p4.test" }] }), ["owner_account_id"]);
  assert.deepEqual(placeholdersIn({ x: "plain" }), []);
  assert.throws(() => placeholdersIn({ x: "id-{{owner}}" }), VarInvalidError, "a placeholder inside a longer string");
  assert.throws(() => placeholdersIn({ x: "{{Owner}}" }), VarInvalidError, "a placeholder with an invalid name");
});

test("substitution fills whole values; a whole integer becomes a number, anything else a string", () => {
  const r = substituteVars({ account_id: "{{acct}}", subject: "{{s}}", to: [{ email: "{{s}}" }] }, { acct: "2", s: "x@p4.test" });
  assert.deepEqual(r.args, { account_id: 2, subject: "x@p4.test", to: [{ email: "x@p4.test" }] });
  assert.deepEqual([...r.used].sort(), ["acct", "s"]);
  assert.deepEqual(substituteVars({ n: "{{v}}" }, { v: "-3" }).args, { n: -3 });
});

test("a placeholder with no marker is a loud error (missing value)", () => {
  assert.throws(() => substituteVars({ account_id: "{{owner_account_id}}" }, {}), VarMissingError);
});

test("validateFixture rejects a bad placeholder when the fixture loads", () => {
  const good = { id: "p4-vars-ok", description: "d", turns: [{ tool_calls: [{ name: "t", arguments: { a: "{{acct}}" } }] }, { content: "done" }] };
  assert.equal(validateFixture(good, "p4-vars-ok").id, "p4-vars-ok");
  const bad = { id: "p4-vars-bad", description: "d", turns: [{ tool_calls: [{ name: "t", arguments: { a: "x{{acct}}" } }] }, { content: "done" }] };
  assert.throws(() => validateFixture(bad, "p4-vars-bad"), /not a whole-value/);
});

test("the stub answers a tool call with the substituted arguments, and refuses missing and unknown markers", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p4-vars-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, "p4-vars-send.json"),
    JSON.stringify({ id: "p4-vars-send", description: "d", turns: [{ tool_calls: [{ name: "send_mcp_x", arguments: { account_id: "{{owner_account_id}}", subject: "s" } }] }, { content: "done" }] }),
  );
  const server = createStubServer({ fixturesDir: dir, port: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const user = (text: string) => ({ messages: [{ role: "user", content: text }] });

  const ok = await postChat(port, user("[fixture:p4-vars-send] [var:owner_account_id=2] Send."));
  assert.equal(ok.status, 200);
  const args = JSON.parse(ok.raw) as { choices: Array<{ message: { tool_calls: Array<{ function: { arguments: string } }> } }> };
  assert.deepEqual(JSON.parse(args.choices[0]?.message.tool_calls[0]?.function.arguments ?? "null"), { account_id: 2, subject: "s" });

  const missing = await postChat(port, user("[fixture:p4-vars-send] Send."));
  assert.equal(missing.status, 400);
  assert.match(missing.raw, /no \[var:owner_account_id=\.\.\.\] marker/);

  const unknown = await postChat(port, user("[fixture:p4-vars-send] [var:owner_account_id=2] [var:typo=9] Send."));
  assert.equal(unknown.status, 400);
  assert.match(unknown.raw, /not used by fixture p4-vars-send: typo/);

  const malformed = await postChat(port, user("[fixture:p4-vars-send] [var:owner_account_id] Send."));
  assert.equal(malformed.status, 400);
  assert.match(malformed.raw, /must be \[var:<name>=<value>\]/);
});
