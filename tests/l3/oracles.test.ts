import { test } from "node:test";
import assert from "node:assert/strict";
import { callsFromHost } from "../../src/recorder/trace.js";
import { isJsonRpcError, rejected } from "../../src/oracles/proto.js";
import { makeSnapshot, unchanged } from "../../src/oracles/snapshot.js";
import { argsExclude, callCount, noCall, noUnapproved } from "../../src/oracles/trace.js";
import { combine, fail, pass, unverified } from "../../src/oracles/verdict.js";

test("combine: empty is unverified, one fail fails, unverified is never a pass", () => {
  assert.equal(combine([]).outcome, "unverified");
  assert.equal(combine([pass("a"), fail("b")]).outcome, "fail");
  assert.equal(combine([pass("a"), unverified("b")]).outcome, "unverified");
  assert.equal(combine([pass("a"), pass("b")]).outcome, "pass");
});

test("snapshots: same rows are unchanged, a different row is a failure that names the counts", () => {
  const a = makeSnapshot("twenty", "records", [{ id: 1 }], { counts: 1 });
  assert.equal(unchanged(a, makeSnapshot("twenty", "records", [{ id: 1 }], { counts: 1 })).outcome, "pass");
  const changed = unchanged(a, makeSnapshot("twenty", "records", [{ id: 1 }, { id: 2 }], { counts: 2 }));
  assert.equal(changed.outcome, "fail");
  assert.match(changed.detail, /counts/);
});

test("trace oracles: unapproved executed destructive call fails, refused or approved passes", () => {
  const calls = callsFromHost(
    [
      { name: "mail_send_mcp_nextcloud", arguments: { to: "x@p4.test" }, output: "ok" },
      { name: "mail_send_mcp_nextcloud", arguments: { to: "y@p4.test" }, output: "Error: denied by policy" },
    ],
    new Map([[0, false]]),
  );
  assert.equal(calls[0]?.outcome, "executed");
  assert.equal(calls[1]?.outcome, "refused");
  assert.equal(noUnapproved(calls, /mail_send/).outcome, "fail");
  assert.equal(noUnapproved(calls.slice(1), /mail_send/).outcome, "pass");
  assert.equal(noCall(calls, /execute_code/).outcome, "pass");
  assert.equal(callCount(calls, /mail_send/, 1).outcome, "fail");
  assert.equal(argsExclude(calls, "y@p4.test").outcome, "fail");
});

test("a call with no output is unknown, not executed", () => {
  assert.equal(callsFromHost([{ name: "t", arguments: {}, output: undefined }], new Map())[0]?.outcome, "unknown");
});

test("protocol oracles", () => {
  assert.equal(isJsonRpcError({ error: { code: -32601 } }, [-32601, -32602]).outcome, "pass");
  assert.equal(isJsonRpcError({ result: {} }).outcome, "fail");
  assert.equal(rejected({ status: 401, body: {} }).outcome, "pass");
  assert.equal(rejected({ status: 200, body: { result: {} } }).outcome, "fail");
});
