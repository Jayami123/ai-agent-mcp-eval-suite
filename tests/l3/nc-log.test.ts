import { test } from "node:test";
import assert from "node:assert/strict";
import { redactValues } from "./support/nc-log.js";

// Unit tests for the Nextcloud log redaction (no stack needed). Captured log text is published as evidence.

test("redactValues blanks credential values in JSON log lines and header text", () => {
  const line = '{"message":"x","password":"hunter2-secret","token":"abc123","Authorization":"Basic dXNlcjpwYXNz","app":"mail"}';
  const out = redactValues(line);
  assert.ok(!out.includes("hunter2-secret") && !out.includes("abc123") && !out.includes("dXNlcjpwYXNz"));
  assert.ok(out.includes('"app":"mail"'), "non-credential fields are kept");
  assert.equal(redactValues("Authorization: Bearer abc.def-ghi"), "Authorization: Bearer ***");
  assert.equal(redactValues("cookie=sessionid=xyz; path=/"), "cookie=***; path=/");
});

test("redactValues leaves ordinary mail log text alone", () => {
  const text = '{"app":"mail","message":"SMTP send failed for p4l3-appr-002-direct@p4.test","level":2}';
  assert.equal(redactValues(text), text);
});
