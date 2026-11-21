import { createHash, randomBytes } from "node:crypto";
import { TWENTY_DEFAULT_ADMIN_EMAIL, TWENTY_DEV_SEED_PASSWORD } from "qa-portfolio-harness";
import { McpHttpClient } from "../support/mcp-client.js";
import { pickOrigin } from "../support/seed/twenty-binding.js";

// Raw-HTTP probes against Twenty's own OAuth authorization server and its MCP endpoint (source read at tag v2.44.0; the
// file:line citations are in docs/plans/2026-11-22-l3-oauth-mode.md, section 3). Nothing here prints a token, a client secret,
// an authorization code or a header value. Probes return parsed fields only.

/** Timeout for one HTTP call. Basis: the harness's own registration call uses 15 s (librechat-oauth-register.ts line 45). */
export const OAUTH_HTTP_TIMEOUT_MS = 15_000;
/** The redirect a probe client registers. A localhost redirect is allowed (validate-redirect-uri.util.ts). Never contacted. */
export const REDIRECT_A = "http://localhost:3080/p4-oauth/a/cb";
export const REDIRECT_ATTACKER = "http://localhost:3080/p4-oauth/attacker/cb";
export const REDIRECT_B = "http://localhost:3080/p4-oauth/b/cb";

const SIGN_IN = `mutation SignIn($email: String!, $password: String!) {
  signIn(email: $email, password: $password) {
    availableWorkspaces { availableWorkspacesForSignIn { id displayName loginToken workspaceUrls { subdomainUrl customUrl } } }
  }
}`;
const EXCHANGE = `mutation GetAuthTokensFromLoginToken($loginToken: String!, $origin: String!) {
  getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } }
}`;
/** authorizeApp (auth.resolver.ts, the mutation at line 1081). Its reply is the redirect URL that carries the code. */
const AUTHORIZE = `mutation AuthorizeApp($clientId: String!, $redirectUrl: String!, $codeChallenge: String, $state: String, $scope: String, $issuer: String) {
  authorizeApp(clientId: $clientId, redirectUrl: $redirectUrl, codeChallenge: $codeChallenge, state: $state, scope: $scope, issuer: $issuer) { redirectUrl }
}`;

export interface HttpReply {
  status: number;
  body: unknown;
  headers: Headers;
}

async function getJson(url: string, token?: string): Promise<HttpReply> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token !== undefined) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS) });
  return { status: res.status, body: await parse(res), headers: res.headers };
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _notJson: true };
  }
}

/** A GraphQL call. Returns the parsed reply; `errors` is kept as messages with the codes, never the request. */
async function graphql(url: string, query: string, variables: Record<string, unknown>, token?: string): Promise<{ data: Record<string, unknown> | null; errors: Array<{ message: string; code?: string }> }> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (token !== undefined) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS) });
  const parsed = (await parse(res)) as { data?: Record<string, unknown> | null; errors?: Array<{ message?: string; extensions?: { code?: string } }> };
  return {
    data: parsed.data ?? null,
    errors: (parsed.errors ?? []).map((e) => ({ message: e.message ?? "", code: e.extensions?.code })),
  };
}

/** The workspace-bound access token of the harness admin, the same way the seed reads it (signIn, then the login token exchange). */
export async function ownerAccessToken(base: string): Promise<string> {
  const login = await graphql(`${base}/metadata`, SIGN_IN, { email: TWENTY_DEFAULT_ADMIN_EMAIL, password: TWENTY_DEV_SEED_PASSWORD });
  const workspaces = (login.data?.["signIn"] as { availableWorkspaces?: { availableWorkspacesForSignIn?: Array<{ loginToken?: string; workspaceUrls?: { subdomainUrl?: string; customUrl?: string } }> } } | undefined)
    ?.availableWorkspaces?.availableWorkspacesForSignIn ?? [];
  const ws = workspaces[0];
  if (ws?.loginToken === undefined) throw new Error("OAUTH_NO_WORKSPACE: the harness admin has no workspace login token (values not printed)");
  const origins = [...new Set([pickOrigin(ws.workspaceUrls?.subdomainUrl), pickOrigin(ws.workspaceUrls?.customUrl), base].filter((o): o is string => o !== undefined))];
  for (const origin of origins) {
    const exchanged = await graphql(`${base}/metadata`, EXCHANGE, { loginToken: ws.loginToken, origin });
    const token = (exchanged.data?.["getAuthTokensFromLoginToken"] as { tokens?: { accessOrWorkspaceAgnosticToken?: { token?: string } } } | undefined)?.tokens?.accessOrWorkspaceAgnosticToken?.token;
    if (token !== undefined && token !== "") return token;
  }
  throw new Error("OAUTH_NO_SESSION_TOKEN: no origin gave the harness admin a workspace token (values not printed)");
}

/** The S256 code challenge of a verifier (RFC 7636 section 4.2): base64url(SHA-256(verifier)). */
export function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** A PKCE pair: a 64-byte random verifier and its S256 challenge (RFC 7636). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: s256(verifier) };
}

export interface Registration {
  clientId: string;
  status: number;
  tokenEndpointAuthMethod: unknown;
  redirectUris: unknown;
}

/** RFC 7591 registration as the harness does it (librechat-oauth.ts oauthRegistrationBody). Returns the fields a probe asserts on. */
export async function registerClient(base: string, name: string, redirectUri: string, tokenEndpointAuthMethod = "none"): Promise<Registration> {
  const res = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: `p4 l3 oauth probe ${name}`,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      scope: "api profile",
    }),
    signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
  });
  const body = (await parse(res)) as { client_id?: unknown; token_endpoint_auth_method?: unknown; redirect_uris?: unknown };
  return {
    clientId: typeof body.client_id === "string" ? body.client_id : "",
    status: res.status,
    tokenEndpointAuthMethod: body.token_endpoint_auth_method,
    redirectUris: body.redirect_uris,
  };
}

export interface AuthorizeOutcome {
  /** The redirect URL the server returned (carries `code`, `state` and `iss` when it succeeded). Undefined on refusal. */
  redirectUrl?: string;
  /** Messages and codes of the GraphQL errors, when refused. */
  errors: Array<{ message: string; code?: string }>;
}

/** authorizeApp for a signed-in user. Refusals come back as GraphQL errors; nothing is printed. */
export async function authorize(base: string, token: string, input: { clientId: string; redirectUrl: string; codeChallenge?: string; state?: string; scope?: string; issuer?: string }): Promise<AuthorizeOutcome> {
  const r = await graphql(`${base}/metadata`, AUTHORIZE, input, token);
  const dto = r.data?.["authorizeApp"] as { redirectUrl?: unknown } | null | undefined;
  return {
    ...(typeof dto?.redirectUrl === "string" ? { redirectUrl: dto.redirectUrl } : {}),
    errors: r.errors,
  };
}

/** The `code` value of a redirect URL, or undefined. The code is a secret: callers never print it. */
export function codeFrom(redirectUrl: string | undefined): string | undefined {
  if (redirectUrl === undefined) return undefined;
  return new URL(redirectUrl).searchParams.get("code") ?? undefined;
}

export interface TokenReply {
  status: number;
  accessToken?: string;
  scope?: string;
  error?: string;
  errorDescription?: string;
}

/** POST /oauth/token (form-urlencoded, RFC 6749 section 4.1.3). Returns the status and the fields a probe asserts on. */
export async function exchangeCode(base: string, input: { code: string; clientId: string; redirectUri: string; codeVerifier?: string }): Promise<TokenReply> {
  const form = new URLSearchParams({ grant_type: "authorization_code", code: input.code, client_id: input.clientId, redirect_uri: input.redirectUri });
  if (input.codeVerifier !== undefined) form.set("code_verifier", input.codeVerifier);
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form.toString(),
    signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
  });
  const body = (await parse(res)) as { access_token?: unknown; scope?: unknown; error?: unknown; error_description?: unknown };
  return {
    status: res.status,
    ...(typeof body.access_token === "string" ? { accessToken: body.access_token } : {}),
    ...(typeof body.scope === "string" ? { scope: body.scope } : {}),
    ...(typeof body.error === "string" ? { error: body.error } : {}),
    ...(typeof body.error_description === "string" ? { errorDescription: body.error_description } : {}),
  };
}

/** Bearer probe of the MCP endpoint: initialize, then tools/list. The HTTP status and WWW-Authenticate are returned as read. */
export interface McpProbe {
  initStatus: number;
  wwwAuthenticate: string | null;
  toolCount: number | null;
}

export async function mcpWithBearer(base: string, bearer: string): Promise<McpProbe> {
  const client = new McpHttpClient(`${base}/mcp`, `Bearer ${bearer}`);
  const init = await client.initialize();
  const wwwAuthenticate = init.headers.get("www-authenticate");
  if (init.status !== 200) return { initStatus: init.status, wwwAuthenticate, toolCount: null };
  const tools = await client.listTools();
  return { initStatus: init.status, wwwAuthenticate, toolCount: tools.length };
}

/** Discovery: the metadata fields a probe asserts on. */
export async function discovery(base: string): Promise<{ status: number; metadata: Record<string, unknown> }> {
  const r = await getJson(`${base}/.well-known/oauth-authorization-server`);
  return { status: r.status, metadata: (r.body ?? {}) as Record<string, unknown> };
}

/**
 * A bearer the server did not issue: a JWT-shaped string signed with a key the probe made up. Used only to show the MCP answer for
 * a token the server cannot verify. Never a real credential.
 */
export function forgedBearer(): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ type: "APPLICATION_ACCESS", iss: "https://attacker.p4.test", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
  const sig = randomBytes(32).toString("base64url");
  return `${header}.${payload}.${sig}`;
}
