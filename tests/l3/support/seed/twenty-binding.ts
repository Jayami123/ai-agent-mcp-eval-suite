// Workspace binding for the Twenty seed. Pure functions, no network, so they can be unit tested in the plain gate.
// Source of truth (Jayami123/twenty-crm at 7cbdfec6):
// - the access token carries `type: "access"` and `workspaceId` (engine/core-modules/auth/token/services/access-token.service.ts:130-135);
// - a workspace-agnostic token (from `signIn`, auth.resolver.ts:280) has neither claim, and WorkspaceAuthGuard refuses it on any
//   workspace-scoped resolver (engine/guards/workspace-auth.guard.ts:22-25).
// The token is a JWT. Only the payload is read here, and the server already verified the signature. Nothing is printed.

/**
 * The access token's `type` claim, exact and case-sensitive. Source: `ACCESS = 'ACCESS'` in
 * packages/twenty-server/src/engine/core-modules/auth/types/jwt-token-type.enum.ts:2, set by access-token.service.ts:136
 * (`type: JwtTokenTypeEnum.ACCESS`). The workspace-agnostic token is 'WORKSPACE_AGNOSTIC' (the same enum, line 4).
 */
export const ACCESS_TOKEN_TYPE = "ACCESS";

/** Decodes a JWT payload (no signature check: the server issued the token and the seed only reads its claims). */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("TWENTY_TW1_NOT_A_JWT: the token is not a three-part JWT (content not printed)");
  const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as unknown;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("TWENTY_TW1_NOT_A_JWT: the payload is not an object");
  return payload as Record<string, unknown>;
}

/**
 * Throws unless the token is an access token bound to `workspaceId`. A workspace-agnostic token fails here, and so does a token
 * for any other workspace (the case that single-workspace mode produces for a non-default workspace).
 */
export function assertWorkspaceBound(token: string, workspaceId: string): void {
  const claims = decodeJwtPayload(token);
  if (claims["type"] !== ACCESS_TOKEN_TYPE) throw new Error(`TWENTY_TW1_NOT_BOUND: the token type is ${String(claims["type"])}, not ${ACCESS_TOKEN_TYPE} (a workspace-agnostic token cannot read a workspace)`);
  if (claims["workspaceId"] !== workspaceId) throw new Error(`TWENTY_TW1_WRONG_BINDING: the token is bound to workspace ${String(claims["workspaceId"])}, not ${workspaceId}`);
}

/**
 * A workspace origin from the sign-in reply. The reply gives subdomainUrl and customUrl as null or empty when unset, so a null or
 * blank value is absent (returns undefined) and never reaches .trim(). Trailing slashes are removed.
 */
export function pickOrigin(value: string | null | undefined): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim().replace(/\/$/, "");
}
