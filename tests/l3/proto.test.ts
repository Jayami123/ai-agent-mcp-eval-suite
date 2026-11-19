import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanResponse, headerMismatchRefused, jsonRpcViolations, noSchemaViolations, statelessClaimHolds, toolsListViolations, versionRejectedOrDowngraded } from "../../src/oracles/proto.js";
import { metadataShapeViolations, resourceMetadataHint } from "../../src/oracles/oauth.js";

test("PROT-002 oracle: a valid exchange passes, a malformed message is flagged", () => {
  const ok = [
    { dir: "out" as const, body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } },
    { dir: "in" as const, status: 200, body: { jsonrpc: "2.0", id: 1, result: { tools: [] } } },
    { dir: "in" as const, status: 202, body: {} },
  ];
  assert.equal(noSchemaViolations(ok).outcome, "pass");
  assert.equal(noSchemaViolations([...ok, { dir: "in", status: 200, body: { jsonrpc: "2.0", id: 2, result: {}, error: { code: -1, message: "x" } } }]).outcome, "fail");
  assert.equal(noSchemaViolations([{ dir: "in", status: 200, body: { id: 1, result: {} } }]).outcome, "fail");
  assert.equal(noSchemaViolations([]).outcome, "fail");
  assert.deepEqual(jsonRpcViolations("in", { _unparsed: true }), ["message is not JSON"]);
});

test("tools/list shape", () => {
  assert.deepEqual(toolsListViolations({ tools: [{ name: "a", inputSchema: { type: "object" } }] }), []);
  assert.equal(toolsListViolations({ tools: [{ inputSchema: {} }] }).length > 0, true);
  assert.equal(toolsListViolations({}).length, 1);
});

test("PROT-003 header mismatch is spec-version aware", () => {
  const accepted = { status: 200, body: { result: { tools: [] } } };
  assert.equal(headerMismatchRefused({ status: 200, body: { error: { code: -32020 } } }, "2026-07-28").outcome, "pass");
  assert.equal(headerMismatchRefused({ status: 400, body: {} }, "2026-07-28").outcome, "pass");
  // Accepted by a server on 2025-06-18: a spec-version gap, reported as a deployment finding, passes.
  const gap = headerMismatchRefused(accepted, "2025-06-18");
  assert.equal(gap.outcome, "pass");
  assert.match(gap.detail, /^deployment finding/);
  // Accepted by a server that negotiated the newer spec: a failure.
  assert.equal(headerMismatchRefused(accepted, "2026-07-28").outcome, "fail");
  assert.equal(headerMismatchRefused(accepted, "2027-01-01").outcome, "fail");
  // Unknown negotiated version cannot be classified: a failure, never a silent pass.
  assert.equal(headerMismatchRefused(accepted).outcome, "fail");
});

test("PROT-004 stateless claim", () => {
  const stateless = { headers: new Headers() };
  const stateful = { headers: new Headers({ "mcp-session-id": "s" }) };
  assert.equal(statelessClaimHolds(stateless, { status: 200, body: { result: {} } }).outcome, "pass");
  assert.equal(statelessClaimHolds(stateless, { status: 400, body: { error: { code: -32000 } } }).outcome, "fail");
  assert.equal(statelessClaimHolds(stateful, { status: 400, body: { error: { code: -32000 } } }).outcome, "pass");
  assert.equal(statelessClaimHolds(stateful, { status: 200, body: { result: {} } }).outcome, "fail");
  assert.equal(statelessClaimHolds(stateful, { status: 500, body: {} }).outcome, "fail");
  assert.equal(cleanResponse({ status: 200, body: "x" }).outcome, "fail");
});

test("PROT-012 version negotiation", () => {
  assert.equal(versionRejectedOrDowngraded({ status: 200, body: { result: { protocolVersion: "2025-06-18" } } }, "1999-01-01").outcome, "pass");
  assert.equal(versionRejectedOrDowngraded({ status: 200, body: { result: { protocolVersion: "1999-01-01" } } }, "1999-01-01").outcome, "fail");
  assert.equal(versionRejectedOrDowngraded({ status: 400, body: {} }, "1999-01-01").outcome, "pass");
});

test("OAUTH-001 helpers", () => {
  assert.equal(resourceMetadataHint('Bearer resource_metadata="http://x/.well-known/oauth-protected-resource"'), "http://x/.well-known/oauth-protected-resource");
  assert.equal(resourceMetadataHint("Bearer realm=x"), null);
  assert.equal(resourceMetadataHint(null), null);
  assert.deepEqual(metadataShapeViolations({ resource: "http://x", authorization_servers: ["http://as"] }), []);
  assert.equal(metadataShapeViolations({}).length, 2);
});
