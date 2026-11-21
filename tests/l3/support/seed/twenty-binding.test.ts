import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWorkspaceBound, decodeJwtPayload } from "./twenty-binding.js";

// Unit tests for the workspace binding check (plain gate, no stack). Tokens are built here with an empty signature: the check reads
// claims only, so the signature segment is never used.

const WS_A = "20202020-1c25-4d02-bf25-6aeccf7ea419";
const WS_B = "3b8e6458-5fc1-4e63-8563-008ccddaa6db";

const jwt = (claims: Record<string, unknown>): string =>
  `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

test("the workspace check accepts an access token bound to the expected workspace", () => {
  assert.doesNotThrow(() => assertWorkspaceBound(jwt({ type: "access", workspaceId: WS_A, sub: "u" }), WS_A));
});

test("the workspace check refuses a workspace-agnostic token (no workspaceId, not access)", () => {
  assert.throws(() => assertWorkspaceBound(jwt({ type: "workspaceAgnostic", sub: "u" }), WS_A), /TWENTY_TW1_NOT_BOUND/);
});

test("the workspace check refuses an access token bound to another workspace", () => {
  assert.throws(() => assertWorkspaceBound(jwt({ type: "access", workspaceId: WS_B }), WS_A), /TWENTY_TW1_WRONG_BINDING/);
});

test("the workspace check refuses a value that is not a JWT", () => {
  assert.throws(() => assertWorkspaceBound("not-a-token", WS_A), /TWENTY_TW1_NOT_A_JWT/);
});

test("decodeJwtPayload reads the claims of a JWT", () => {
  assert.deepEqual(decodeJwtPayload(jwt({ type: "access", workspaceId: WS_A })), { type: "access", workspaceId: WS_A });
});
