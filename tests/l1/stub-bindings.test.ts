import { test } from "node:test";
import assert from "node:assert/strict";
import { bindArgs, parseBindings } from "../../src/stub/bindings.js";

// Unit tests for the stub's run-time bindings (src/stub/bindings.ts). No stub container is needed.

test("parseBindings accepts NAME -> string and rejects everything else without echoing a value", () => {
  const ok = parseBindings(JSON.stringify({ OUTLINE_POISONED_DOC: "3d7e167e-10a9-4469-a0a5-3bfbcc6665e2" }));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.map.get("OUTLINE_POISONED_DOC"), "3d7e167e-10a9-4469-a0a5-3bfbcc6665e2");

  assert.equal(parseBindings("not json").ok, false);
  assert.equal(parseBindings("[]").ok, false);
  const badName = parseBindings(JSON.stringify({ lower_case: "x" }));
  assert.equal(badName.ok, false);
  if (!badName.ok) assert.ok(!badName.reason.includes("x"), "the reason names the key, never the value");
  assert.equal(parseBindings(JSON.stringify({ NAME: "" })).ok, false);
  assert.equal(parseBindings(JSON.stringify({ NAME: 5 })).ok, false);
  assert.equal(parseBindings(JSON.stringify({ NAME: "a".repeat(201) })).ok, false);
});

test("bindArgs substitutes whole-string placeholders at any depth and leaves other strings alone", () => {
  const bindings = new Map([["DOC", "doc-1"], ["COL", "col-9"]]);
  const r = bindArgs({ id: "{{bind:DOC}}", nested: { list: ["{{bind:COL}}", "plain"] }, text: "see {{bind:DOC}} inline" }, bindings);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, { id: "doc-1", nested: { list: ["col-9", "plain"] }, text: "see {{bind:DOC}} inline" });
});

test("bindArgs sends an all-digit bound value as a number and any other value as a string", () => {
  const r = bindArgs({ account_id: "{{bind:MAIL_ACCOUNT}}", label: "{{bind:LABEL}}" }, new Map([["MAIL_ACCOUNT", "42"], ["LABEL", "42a"]]));
  assert.deepEqual(r, { ok: true, value: { account_id: 42, label: "42a" } });
});

test("bindArgs fails closed on a placeholder with no binding, naming it", () => {
  const r = bindArgs({ id: "{{bind:MISSING_ONE}}" }, new Map());
  assert.deepEqual(r, { ok: false, missing: "MISSING_ONE" });
});
