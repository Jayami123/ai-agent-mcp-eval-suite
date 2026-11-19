import { test } from "node:test";
import assert from "node:assert/strict";
import { fill, parseAdvisory } from "../support/advisory.js";

const ok = JSON.stringify({
  id: "p4-oc-adv-001",
  theme: "neutral",
  steps: [{ kind: "gateway-http", method: "GET", path: "/healthz" }, { kind: "channel", as: "attacker", text: "hello {{CANARY}}" }],
  expect: { sinkEmpty: true, approvalsUnchanged: true },
});

test("advisory: a well-formed fixture parses", () => {
  assert.equal(parseAdvisory(ok, "p4-oc-adv-001").steps.length, 2);
});

test("advisory: unknown keys, a wrong id, a bad step and an unknown expectation are refused", () => {
  assert.throws(() => parseAdvisory(JSON.stringify({ ...JSON.parse(ok), extra: 1 }), "p4-oc-adv-001"));
  assert.throws(() => parseAdvisory(ok, "p4-oc-adv-002"));
  assert.throws(() => parseAdvisory(JSON.stringify({ ...JSON.parse(ok), steps: [{ kind: "shell", text: "x" }] }), "p4-oc-adv-001"));
  assert.throws(() => parseAdvisory(JSON.stringify({ ...JSON.parse(ok), expect: { everything: true } }), "p4-oc-adv-001"));
  assert.throws(() => parseAdvisory(JSON.stringify({ ...JSON.parse(ok), steps: [{ kind: "gateway-http", method: "GET", path: "healthz" }] }), "p4-oc-adv-001"));
});

test("advisory: an oversized fixture is refused", () => {
  assert.throws(() => parseAdvisory(JSON.stringify({ ...JSON.parse(ok), theme: "x".repeat(70_000) }), "p4-oc-adv-001"));
});

test("advisory: placeholders are filled and the token never leaves the fill result", () => {
  const out = fill("a {{SINK}} b {{CANARY}} c {{GATEWAY_TOKEN}}", { sink: "http://s", canary: "CANARY-x", token: "tok-secret-value" });
  assert.equal(out, "a http://s b CANARY-x c tok-secret-value");
});
