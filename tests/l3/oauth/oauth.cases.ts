import { expectedDefect } from "../support/expected-defect.js";
import { fail, pass, type Verdict } from "../../../src/oracles/verdict.js";
import { unchanged } from "../../../src/oracles/snapshot.js";
import { l3Case } from "../support/case.js";
import { runtime } from "../support/runtime.js";
import {
  authorize,
  codeFrom,
  discovery,
  exchangeCode,
  forgedBearer,
  mcpWithBearer,
  ownerAccessToken,
  pkcePair,
  REDIRECT_A,
  REDIRECT_ATTACKER,
  REDIRECT_B,
  registerClient,
  type Registration,
} from "./twenty-oauth.js";

// P4-MCP-OAUTH-002, -004, -005, -007, -008, -009 (Twenty leg). Raw-HTTP probes against Twenty's authorization server and its MCP
// endpoint. Every verdict names the response it rests on. Entry: run.e2e.ts (LIBRECHAT_MCP_OAUTH=1, twenty only).
// Source citations: docs/plans/2026-11-22-l3-oauth-mode.md, section 3.

/** The Twenty base URL. The same default as the harness's own config (config.ts TWENTY_BASE_URL). */
const twentyBase = (): string => (process.env["TWENTY_BASE_URL"] ?? "http://127.0.0.1:3002").replace(/\/$/, "");

/**
 * Registrations made once per run and shared by the cases. Basis: the registration endpoint allows 10 per hour per IP in production
 * (oauth-registration.controller.ts lines 38-40), and the harness registers one client for LibreChat. These three keep the run at 4.
 */
const shared: { a?: Registration; b?: Registration; basic?: Registration } = {};
async function clientA(base: string): Promise<Registration> {
  shared.a ??= await registerClient(base, "a", REDIRECT_A);
  return shared.a;
}
async function clientB(base: string): Promise<Registration> {
  shared.b ??= await registerClient(base, "b", REDIRECT_B);
  return shared.b;
}

const refused = (errors: Array<{ message: string; code?: string }>): boolean => errors.length > 0;

l3Case("P4-MCP-OAUTH-004", "dynamic client registration and the PKCE flow, as documented", async (ctx) => {
  const rt = runtime();
  const base = twentyBase();
  const oracle = rt.oracle("twenty");
  const before = await oracle.snapshot();
  const disc = await discovery(base);
  const md = disc.metadata;
  const methods = (md["code_challenge_methods_supported"] as string[] | undefined) ?? [];
  const authMethods = (md["token_endpoint_auth_methods_supported"] as string[] | undefined) ?? [];
  ctx.check(disc.status === 200 && typeof md["registration_endpoint"] === "string" && methods.includes("S256") && authMethods.includes("none")
    ? pass("discovery: 200 with registration_endpoint, S256 and token auth method none")
    : fail(`discovery: status ${disc.status}, S256 ${methods.includes("S256")}, none ${authMethods.includes("none")}`));
  const a = await clientA(base);
  ctx.check(a.status === 201 || a.status === 200 ? pass(`registration: HTTP ${a.status} with a client id`) : fail(`registration: HTTP ${a.status}`));
  ctx.check(a.tokenEndpointAuthMethod === "none" ? pass("registration: token_endpoint_auth_method is none") : fail(`registration: auth method ${String(a.tokenEndpointAuthMethod)}`));
  // A confidential request is downgraded to none (oauth-registration.controller.ts lines 122-124).
  shared.basic ??= await registerClient(base, "basic", REDIRECT_A, "client_secret_basic");
  ctx.check(shared.basic.tokenEndpointAuthMethod === "none" ? pass("registration: a client_secret_basic request is downgraded to none") : fail(`registration: downgrade gave ${String(shared.basic.tokenEndpointAuthMethod)}`));
  // The full PKCE flow: authorize (signed in), then the token exchange.
  const token = await ownerAccessToken(base);
  const pair = pkcePair();
  const state = "p4-state-004";
  const granted = await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_A, codeChallenge: pair.challenge, state, scope: "api profile" });
  const code = codeFrom(granted.redirectUrl);
  ctx.check(code !== undefined ? pass("authorize: the server returned a redirect URL with a code") : fail(`authorize: no code (refused: ${granted.errors.map((e) => e.code ?? e.message).join(", ") || "no error"})`));
  if (code !== undefined) {
    const tok = await exchangeCode(base, { code, clientId: a.clientId, redirectUri: REDIRECT_A, codeVerifier: pair.verifier });
    ctx.check(tok.status === 200 && tok.accessToken !== undefined ? pass("token exchange: HTTP 200 with an access token") : fail(`token exchange: HTTP ${tok.status}, error ${tok.error ?? "none"}`));
  }
  // A mutated redirect is refused at authorize.
  const mutated = await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_ATTACKER, codeChallenge: pair.challenge, state });
  ctx.check(mutated.redirectUrl === undefined && refused(mutated.errors) ? pass("mutated redirect: refused, no redirect URL returned") : fail("mutated redirect: the server returned a redirect URL"));
  ctx.check(unchanged(before, await oracle.snapshot()));
});

l3Case("P4-MCP-OAUTH-007", "redirect URI must match exactly", async (ctx) => {
  const rt = runtime();
  const base = twentyBase();
  const oracle = rt.oracle("twenty");
  const before = await oracle.snapshot();
  const a = await clientA(base);
  const token = await ownerAccessToken(base);
  const pair = pkcePair();
  const attacker = await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_ATTACKER, codeChallenge: pair.challenge, state: "p4-state-007" });
  ctx.check(attacker.redirectUrl === undefined && refused(attacker.errors) ? pass("attacker redirect: refused, no code returned") : fail("attacker redirect: the server returned a redirect URL"));
  // A trailing slash is a different URI, so it must not match either (RFC 6749 section 3.1.2.3: exact comparison).
  const slashed = await authorize(base, token, { clientId: a.clientId, redirectUrl: `${REDIRECT_A}/`, codeChallenge: pair.challenge, state: "p4-state-007" });
  ctx.check(slashed.redirectUrl === undefined && refused(slashed.errors) ? pass("trailing-slash variant: refused, no code returned") : fail("trailing-slash variant: the server returned a redirect URL"));
  ctx.check(unchanged(before, await oracle.snapshot()));
});

l3Case("P4-MCP-OAUTH-008", "issuer is checked", async (ctx) => {
  const rt = runtime();
  const base = twentyBase();
  const oracle = rt.oracle("twenty");
  const before = await oracle.snapshot();
  const a = await clientA(base);
  const token = await ownerAccessToken(base);
  const pair = pkcePair();
  const look = await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_A, codeChallenge: pair.challenge, state: "p4-state-008", issuer: "https://attacker.p4.test" });
  ctx.check(look.redirectUrl === undefined && refused(look.errors) ? pass("authorize with a look-alike issuer: refused, no code returned") : fail("authorize with a look-alike issuer: the server returned a redirect URL"));
  // A bearer the server did not issue must be answered 401, with the challenge that names the protected resource.
  const forged = await mcpWithBearer(twentyBase(), forgedBearer());
  const challenge = forged.wwwAuthenticate ?? "";
  ctx.check(forged.initStatus === 401 ? pass("MCP with an unverifiable bearer: HTTP 401") : fail(`MCP with an unverifiable bearer: HTTP ${forged.initStatus}`));
  ctx.check(challenge.includes(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`) ? pass("MCP 401 carries WWW-Authenticate with the resource metadata URL") : fail("MCP 401 has no resource metadata challenge"));
  ctx.check(unchanged(before, await oracle.snapshot()));
});

l3Case("P4-MCP-OAUTH-009", "callback CSRF and state binding: the code is single-use, client-bound and PKCE-bound", async (ctx) => {
  const rt = runtime();
  const base = twentyBase();
  const oracle = rt.oracle("twenty");
  const before = await oracle.snapshot();
  const a = await clientA(base);
  const b = await clientB(base);
  const token = await ownerAccessToken(base);
  // Single use: the second redemption of the same code is refused.
  const p1 = pkcePair();
  const c1 = codeFrom((await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_A, codeChallenge: p1.challenge, state: "p4-state-009a" })).redirectUrl);
  if (c1 === undefined) ctx.check(fail("setup: authorize returned no code for the single-use leg"));
  else {
    const first = await exchangeCode(base, { code: c1, clientId: a.clientId, redirectUri: REDIRECT_A, codeVerifier: p1.verifier });
    ctx.check(first.status === 200 ? pass("single-use: the first redemption succeeds") : fail(`single-use: first redemption HTTP ${first.status}`));
    const replay = await exchangeCode(base, { code: c1, clientId: a.clientId, redirectUri: REDIRECT_A, codeVerifier: p1.verifier });
    ctx.check(replay.error === "invalid_grant" ? pass("single-use: the replay is refused with invalid_grant") : fail(`single-use: replay gave ${replay.error ?? `HTTP ${replay.status}`}`));
  }
  // Client binding: a code issued to client A is refused when client B presents it.
  const p2 = pkcePair();
  const c2 = codeFrom((await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_A, codeChallenge: p2.challenge, state: "p4-state-009b" })).redirectUrl);
  if (c2 === undefined) ctx.check(fail("setup: authorize returned no code for the client-binding leg"));
  else {
    const other = await exchangeCode(base, { code: c2, clientId: b.clientId, redirectUri: REDIRECT_B, codeVerifier: p2.verifier });
    ctx.check(other.error === "invalid_grant" ? pass("client binding: client B cannot redeem client A's code (invalid_grant)") : fail(`client binding: gave ${other.error ?? `HTTP ${other.status}`}`));
  }
  // PKCE: a wrong verifier is refused.
  const p3 = pkcePair();
  const c3 = codeFrom((await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_A, codeChallenge: p3.challenge, state: "p4-state-009c" })).redirectUrl);
  if (c3 === undefined) ctx.check(fail("setup: authorize returned no code for the PKCE leg"));
  else {
    const wrong = await exchangeCode(base, { code: c3, clientId: a.clientId, redirectUri: REDIRECT_A, codeVerifier: pkcePair().verifier });
    ctx.check(wrong.error === "invalid_grant" ? pass("PKCE: a wrong verifier is refused (invalid_grant)") : fail(`PKCE: wrong verifier gave ${wrong.error ?? `HTTP ${wrong.status}`}`));
  }
  // The state value is echoed by the server. Checking it is the client's duty (RFC 6749 section 10.12), so this is recorded in the
  // findings and not asserted as a server behaviour here.
  ctx.note("finding: the authorize step echoes state without a server-side check (client duty, RFC 6749 section 10.12)");
  ctx.check(unchanged(before, await oracle.snapshot()));
});

/** The defect reference for OAUTH-002 (plan section 7). The verdict is an expected defect only while the wrong-audience token is accepted. */
const AUDIENCE_DEFECT = { caseId: "P4-MCP-OAUTH-002", server: "twenty", summary: "the MCP endpoint accepts a bearer issued to another client (no audience check; MCP spec requires one)" };

l3Case("P4-MCP-OAUTH-002", "wrong-audience bearer rejected (Twenty leg)", async (ctx) => {
  const rt = runtime();
  const base = twentyBase();
  const oracle = rt.oracle("twenty");
  const before = await oracle.snapshot();
  const a = await clientA(base);
  const b = await clientB(base);
  const token = await ownerAccessToken(base);
  const pa = pkcePair();
  const ca = codeFrom((await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_A, codeChallenge: pa.challenge, state: "p4-state-002a" })).redirectUrl);
  const pb = pkcePair();
  const cb = codeFrom((await authorize(base, token, { clientId: b.clientId, redirectUrl: REDIRECT_B, codeChallenge: pb.challenge, state: "p4-state-002b" })).redirectUrl);
  if (ca === undefined || cb === undefined) {
    ctx.check(fail("setup: authorize returned no code for one of the two clients"));
    return;
  }
  const tokA = await exchangeCode(base, { code: ca, clientId: a.clientId, redirectUri: REDIRECT_A, codeVerifier: pa.verifier });
  const tokB = await exchangeCode(base, { code: cb, clientId: b.clientId, redirectUri: REDIRECT_B, codeVerifier: pb.verifier });
  if (tokA.accessToken === undefined || tokB.accessToken === undefined) {
    ctx.check(fail(`setup: a token exchange gave no access token (A ${tokA.status}, B ${tokB.status})`));
    return;
  }
  // Control: client A's own token reaches the MCP. Without this the rejection below would prove nothing.
  const control = await mcpWithBearer(base, tokA.accessToken);
  ctx.check(control.initStatus === 200 && (control.toolCount ?? 0) > 0 ? pass(`control: client A's own token lists ${control.toolCount} tools on /mcp`) : fail(`control: client A's token gave HTTP ${control.initStatus}`));
  // The probe: client B's token is a token for another application. The ledger expects 401.
  const wrong = await mcpWithBearer(base, tokB.accessToken);
  const accepted = wrong.initStatus === 200 && (wrong.toolCount ?? 0) > 0;
  const observed: Verdict = accepted
    ? fail(`wrong audience: /mcp accepted client B's token (HTTP ${wrong.initStatus}, ${wrong.toolCount} tools)`)
    : pass(`wrong audience: /mcp refused client B's token with HTTP ${wrong.initStatus}`);
  ctx.check(expectedDefect(observed, AUDIENCE_DEFECT));
  ctx.check(unchanged(before, await oracle.snapshot()));
});

l3Case("P4-MCP-OAUTH-005", "consent lists the exact scopes before the token (server side)", async (ctx) => {
  const rt = runtime();
  const base = twentyBase();
  const oracle = rt.oracle("twenty");
  const before = await oracle.snapshot();
  const a = await clientA(base);
  const token = await ownerAccessToken(base);
  // A scope the registration does not hold is refused (auth.service.ts lines 603-611).
  const extra = await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_A, codeChallenge: pkcePair().challenge, state: "p4-state-005a", scope: "api admin" });
  ctx.check(extra.redirectUrl === undefined && extra.errors.some((e) => e.message.includes("Invalid scopes")) ? pass("extra scope: refused with the invalid-scopes error") : fail("extra scope: not refused as invalid"));
  // The reduced request gives a code, and the token carries exactly the reduced scope.
  const p = pkcePair();
  const code = codeFrom((await authorize(base, token, { clientId: a.clientId, redirectUrl: REDIRECT_A, codeChallenge: p.challenge, state: "p4-state-005b", scope: "profile" })).redirectUrl);
  if (code === undefined) ctx.check(fail("reduced scope: authorize returned no code"));
  else {
    const tok = await exchangeCode(base, { code, clientId: a.clientId, redirectUri: REDIRECT_A, codeVerifier: p.verifier });
    ctx.check(tok.scope === "profile" ? pass("reduced scope: the token response carries exactly profile") : fail(`reduced scope: token scope ${tok.scope ?? "none"}`));
  }
  ctx.note("finding: the consent screen is a UI page and is not observed here; the server-side scope list is what this checks");
  ctx.check(unchanged(before, await oracle.snapshot()));
});
