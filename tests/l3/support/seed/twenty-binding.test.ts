import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS_TOKEN_TYPE, assertWorkspaceBound, decodeJwtPayload, pickOrigin } from "./twenty-binding.js";

// Unit tests for the workspace binding check (plain gate, no stack). Tokens are built here with an empty signature: the check reads
// claims only, so the signature segment is never used.

const WS_A = "20202020-1c25-4d02-bf25-6aeccf7ea419";
const WS_B = "3b8e6458-5fc1-4e63-8563-008ccddaa6db";

const jwt = (claims: Record<string, unknown>): string =>
  `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

test("the workspace check accepts an access token bound to the expected workspace", () => {
  assert.doesNotThrow(() => assertWorkspaceBound(jwt({ type: "ACCESS", workspaceId: WS_A, sub: "u" }), WS_A));
});

test("the workspace check refuses a workspace-agnostic token (no workspaceId, not access)", () => {
  assert.throws(() => assertWorkspaceBound(jwt({ type: "WORKSPACE_AGNOSTIC", sub: "u" }), WS_A), /TWENTY_TW1_NOT_BOUND/);
});

test("the real ACCESS value is the one accepted; the lower-case spelling is refused (no loose match)", () => {
  assert.equal(ACCESS_TOKEN_TYPE, "ACCESS");
  assert.doesNotThrow(() => assertWorkspaceBound(jwt({ type: "ACCESS", workspaceId: WS_A }), WS_A));
  assert.throws(() => assertWorkspaceBound(jwt({ type: "access", workspaceId: WS_A }), WS_A), /TWENTY_TW1_NOT_BOUND/);
});

test("the workspace check refuses an access token bound to another workspace", () => {
  assert.throws(() => assertWorkspaceBound(jwt({ type: "ACCESS", workspaceId: WS_B }), WS_A), /TWENTY_TW1_WRONG_BINDING/);
});

test("the workspace check refuses a value that is not a JWT", () => {
  assert.throws(() => assertWorkspaceBound("not-a-token", WS_A), /TWENTY_TW1_NOT_A_JWT/);
});

test("decodeJwtPayload reads the claims of a JWT", () => {
  assert.deepEqual(decodeJwtPayload(jwt({ type: "ACCESS", workspaceId: WS_A })), { type: "ACCESS", workspaceId: WS_A });
});

test("a null origin from the sign-in reply is absent and does not throw", () => {
  assert.equal(pickOrigin(null), undefined);
  assert.equal(pickOrigin(undefined), undefined);
  assert.equal(pickOrigin("   "), undefined);
});

test("a set origin is trimmed and loses its trailing slash", () => {
  assert.equal(pickOrigin(" http://apple.localhost:3000/ "), "http://apple.localhost:3000");
});
