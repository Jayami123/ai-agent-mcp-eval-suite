# L3 plan PR 9, wave D3: OAuth mode (Twenty, plus the Nextcloud cases that need OAuth)

Status: plan, committed first on `feat/2026-11-22-l3-oauth-mode`. The owner waived the separate plan PR for this wave (CLAUDE.md
"Workflow"). The plan and the build share one draft PR to `main`.

Audience: a junior engineer who has to run, read or extend these cases. Read sections 1 and 2 first.

## 1. What this PR does

It builds the OAuth cases from the ledger (`tests/l3/support/l3-cases.json`, PR 9, wave D3) that can be built in this lane:

| Case | Kind | Modes | Home | How it is built |
|---|---|---|---|---|
| `P4-MCP-OAUTH-004` | core | P | twenty | raw-HTTP protocol probe (registration, PKCE flow, mutated redirect) |
| `P4-MCP-OAUTH-007` | core | P | twenty | raw-HTTP probe: redirect URI must match exactly |
| `P4-MCP-OAUTH-008` | core | P | twenty | raw-HTTP probe: issuer is checked |
| `P4-MCP-OAUTH-009` | core | P | twenty | raw-HTTP probe: code single-use, client-bound, PKCE; state echoed (finding) |
| `P4-MCP-OAUTH-002` | core | P+G | all | Twenty leg built (P); other servers and the G leg are findings (section 6) |
| `P4-MCP-OAUTH-005` | core | P | all | Twenty leg: authorize refuses extra scopes; token carries the reduced scope; consent UI not observable (finding) |
| `P4-MCP-OAUTH-006` | core | G | twenty | namedSkip: LibreChat-driven browser sign-in not built; scope premise differs (finding, section 5) |
| `P4-MCP-APPR-009` | stretch | G | twenty | blocker: needs the LibreChat browser sign-in (section 5) |
| `P4-MCP-PROT-010` | core | P | nextcloud | namedSkip after a real attempt (section 4) |
| `P4-MCP-OAUTH-011` | core | P | nextcloud | namedSkip after a real attempt (section 4) |

The IDs, modes, needs and PR number come from the ledger. No ID is invented.

## 2. The harness facts (pinned v0.6.11, read from `node_modules/qa-portfolio-harness`)

- **Switch.** `LIBRECHAT_MCP_OAUTH=1`, exact value, otherwise off. Any other value throws without echoing it
  (`src/adapters/librechat-oauth.ts`, `parseMcpOauthFlag`, lines 44-48).
- **Capable products.** `OAUTH_CAPABLE_PRODUCTS = ["twenty"]` (`librechat-oauth.ts` line 32). Nextcloud, Outline, Penpot and
  Mattermost are not capable. The README records this for v0.6.10 (`node_modules/qa-portfolio-harness/README.md` lines 532-539).
  The owner's note cites a CHANGELOG 0.6.10. This pinned copy has no CHANGELOG file; the README is the record.
- **Client registration.** The harness registers a public client before LibreChat starts. It posts to
  `<twenty>/oauth/register` with `token_endpoint_auth_method: "none"`, `grant_types` `authorization_code` and `refresh_token`,
  `response_types` `code`, and the callback `http://localhost:3080/api/mcp/twenty/oauth/callback`
  (`librechat-oauth-register.ts` line 40-46; body in `librechat-oauth.ts` lines 111-120). It reads only `client_id`.
- **Pre-configured endpoints.** LibreChat gets the browser authorize URL `<twenty>/authorize`, the token URL
  `<origin>/oauth/token`, and no static header (`librechat-oauth.ts` lines 95-108).
- **Browser sign-in.** `scripts/live/librechat-oauth.mjs` signs in through a headless browser (LibreChat reinitialize, Twenty
  login, consent, callback). It is a live script, not a library. It is the only path that puts a LibreChat-held token in place.

## 3. The Twenty authorization server, from source (Twenty v2.44.0, tag `twenty/v2.44.0`, commit `f7a4720`)

The image the harness runs is `twentycrm/twenty:v2.44.0` (`node_modules/qa-portfolio-harness/docker/twenty.compose.yml` line 15).
The source was read from the upstream tag with a sparse, blobless clone in the scratchpad. Nothing was edited.

Cited as `path:line` in the repository of the upstream tag (paths relative to `packages/twenty-server/src/`):

| Behaviour | Source |
|---|---|
| Metadata: `issuer`, `authorization_endpoint` (`<issuer>/authorize`), `token_endpoint` (`/oauth/token`), `registration_endpoint` (`/oauth/register`), `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["client_secret_post","none"]` | `engine/core-modules/application/application-oauth/controllers/oauth-discovery.controller.ts` lines 23-66 |
| Protected resource metadata: `resource`, `authorization_servers: [base]` | same file, lines 75-98 |
| Registration returns `client_id` (UUID), downgrades auth method to `none`, filters unknown scopes | `.../controllers/oauth-registration.controller.ts` lines 120-175 |
| Redirect URIs must be HTTPS or localhost, with no fragment | `engine/core-modules/auth/utils/validate-redirect-uri.util.ts` lines 5-37 |
| `authorizeApp` (GraphQL mutation, signed-in user only): unknown client refused; `code_challenge` required for public clients; `redirectUrl` must be in the registered list; scopes must be a subset of the registration; issuer must be the request base or `SERVER_URL`; code is 5-minute, single-use, stored with `clientId`, `redirectUri`, `codeChallenge`; `state` is echoed | `engine/core-modules/auth/services/auth.service.ts` lines 521-670; resolver `auth/auth.resolver.ts` lines 1071-1093 (guard `AuthPrincipalGuard` with `userSession: true`) |
| Issuer rule | `engine/core-modules/auth/utils/assert-issuer-is-published.util.ts` lines 9-28 |
| Token exchange: `redirect_uri` must match; PKCE S256 required when a challenge was stored; `code_verifier` without a challenge refused; code single-use (`revokedAt`); code must belong to the client | `engine/core-modules/application/application-oauth/oauth.service.ts` lines 143-215 |
| Token endpoint: `invalid_client` answers 401, other errors 400 | `.../controllers/oauth-token.controller.ts` lines 40-97 |
| Issued tokens: `APPLICATION_ACCESS` and `APPLICATION_REFRESH` with `applicationId`, `workspaceId`, `userId` | `engine/core-modules/auth/token/services/application-token.service.ts` lines 123-260 |
| Scopes are only `api` and `profile`; the source calls them "a thin consent boundary", and permissions come from the role | `engine/core-modules/application/application-oauth/constants/oauth-scopes.ts` lines 1-16 |
| MCP endpoint: `McpAuthGuard` wraps `JwtAuthGuard`; on failure it sets `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp", scope="api profile"` and throws 401 | `engine/api/mcp/guards/mcp-auth.guard.ts` lines 13-43 |
| Bearer verification: `jwt.verify(token, key, {...options, algorithms})` with the caller's options only. The MCP path passes no `audience` or `issuer` option | `engine/core-modules/jwt/services/jwt-wrapper.service.ts` lines 129-150; `auth/token/services/access-token.service.ts` lines 185-200 |

Endpoints are on the Twenty base URL. Sign-in and `authorizeApp` are GraphQL on `/metadata` (`engine/api/graphql/metadata.module-factory.ts` line 74).

**What the source does not do.** No `aud` is minted, and none is checked. No `resource` parameter (RFC 8707) is accepted. The MCP specification
requires resource servers to validate audience. That gap is the expected defect for `P4-MCP-OAUTH-002` (section 6), and it is checked
by a probe, not assumed.

## 4. Nextcloud (PROT-010, OAUTH-011): the one real attempt

The harness cannot put Nextcloud in OAuth mode (section 2). The attempt is a real run, recorded in the findings:
`LIBRECHAT_MCP_OAUTH=1` with `LIBRECHAT_MCP_PRODUCTS=nextcloud` through the harness resolver. The expected result is
`LIBRECHAT_MCP_OAUTH_NO_SERVER`. The output is recorded verbatim in the findings. Both cases become `namedSkip` with the pointer
`docs/findings/l3-oauth-mode.md`, and the harness request is written there.

## 5. Twenty cases that need a LibreChat-held token (OAUTH-006, APPR-009)

These cases need LibreChat to hold a token from a browser sign-in. The harness's live script does that for the probe, but no test in
this repository drives it yet. Both cases are `namedSkip`/blocker with the pointer. The scope premise of OAUTH-006 also differs from the
source (section 3, scopes): a `profile`-only token is not refused by scope, because permissions come from the role. That is a finding
(a design choice in the source), not a failure.

## 6. Probes (what each Twenty case asserts, and on what)

Every probe runs against the Twenty base URL with raw HTTP. Each verdict names the response it rests on. No assistant text is read.

Shared setup (`tests/l3/oauth/twenty-oauth.ts`):
- Sign in as the harness admin (`signIn` on `/metadata`, then `getAuthTokensFromLoginToken` for the workspace login token). The
  constants come from the harness (`TWENTY_DEFAULT_ADMIN_EMAIL`, `TWENTY_DEV_SEED_PASSWORD`), as `tests/l3/support/seed/twenty.ts` does.
- PKCE: a 64-byte random verifier, S256 challenge.
- Registration: `POST /oauth/register` with redirect `http://localhost:3080/p4-oauth/<name>/cb` (a localhost redirect is allowed by
  `validate-redirect-uri.util.ts`). At most three registrations per run, so the per-IP rate limit (`oauth-registration.controller.ts`,
  `REGISTRATION_RATE_LIMIT_MAX`) is not reached.

| Case | Probe and verdict | Expected (ledger) | Observed rests on |
|---|---|---|---|
| OAUTH-004 | Metadata has `registration_endpoint`, S256, `none`. Registration returns `client_id`. A full PKCE flow (authorize, then token exchange) returns an access token. A mutated redirect (unregistered) is refused at authorize. Oracle: the owner's Twenty records (the snapshot the Twenty oracle already reads) unchanged. The flow writes auth-code and token rows, which are not records. | flow completes; mutated redirect refused | the `client_id`, `access_token`, the GraphQL error, the snapshot |
| OAUTH-007 | Authorize with an attacker redirect, and with a trailing-slash variant, is refused. No `redirectUrl` with a `code` is returned. | refused | the GraphQL error text (its code is `FORBIDDEN_EXCEPTION`) and the absence of `code` |
| OAUTH-008 | Authorize with `issuer` set to a look-alike host is refused. A bearer signed with a key the server does not hold gets 401 with `WWW-Authenticate` on `/mcp`. | 401 | HTTP 401 and the header's `resource_metadata` value |
| OAUTH-009 | The code is single-use (second exchange: `invalid_grant`). A code exchanged by another client is refused (`invalid_grant`). A wrong verifier is refused. The `state` echo is recorded. | refused, single-use | the three `error` values. `state` is echoed unchanged: a client duty (RFC 6749 section 10.12). Finding, not a failure. |
| OAUTH-002 | Client A signs in; a token issued to client B (another registration, same workspace user) is sent to `/mcp` `tools/list`. Expected 401. | 401 (wrong audience rejected) | If 200: confirmed defect, `expectedDefect` (section 7). The G leg is not built (section 9). |
| OAUTH-005 | Authorize with a scope not in the registration is refused (`Invalid scopes`). Authorize with `scope=profile` only, then the token response carries `scope: "profile"`. | refused; token scope equals consent | the GraphQL error and the token response's `scope` field. The consent screen is UI and is not observed (finding). |

## 7. Expected defects and findings

- **Expected defect (confirmed when observed):** `OAUTH-002`, if the token from client B is accepted by `/mcp`. The MCP specification
  requires audience validation for resource servers. The source shows no audience check (section 3). The verdict is `expectedDefect` with
  its reference (`tests/l3/support/expected-defect.ts`), so a fix flips the case to fail and the annotation is removed.
- **Findings (not failures):** `state` is echoed without a server check (RFC 6749 leaves that to the client); the consent screen is UI
  (`OAUTH-005`); scopes are a thin consent label (`OAUTH-006`); the other servers are not OAuth-capable (section 2).

## 8. Budgets and constants (named, with the basis)

| Constant | Value | Basis |
|---|---|---|
| `OAUTH_HTTP_TIMEOUT_MS` | 15 000 | The harness's own registration call uses 15 s (`librechat-oauth-register.ts` line 45). |
| `OAUTH_CODE_TTL_MS` | 300 000 | Authorization code lifetime in source (`auth.service.ts` line 631, `ms('5m')`). Not waited for: the probes do not sleep. |
| `REGISTRATIONS_PER_RUN` | 3 | Stays under the per-IP registration limit (`oauth-registration.controller.ts`). |
| Job timeout | 30 min | CLAUDE.md. |

## 9. CI job (`.github/workflows/pr.yml`)

A new job `l3-oauth`, the same per-server pattern as the other L3 stack jobs, with `LIBRECHAT_MCP_OAUTH=1`, `P4_L3_SERVERS=twenty`,
`P4_STACK_TESTS=1`, `P4_LLM_MODE=stub`. It runs the new entry `tests/l3/oauth/run.e2e.ts`, which ends with `registerHygieneTests` (the
cleanup sweep and the leak check over `evidence/`). The leak check covers the client ids and the tokens (never printed; redacted in
evidence). Timeout 30 minutes.

## 10. Exit criteria

- `npm run check` passes locally before the PR is marked ready. The stack cases skip in the plain gate.
- `l3-oauth` has run on the PR head. Each case's status is pass (with what it rests on), expected defect (with its reference), named
  skip or blocker (with the pointer), or fail (with the output).
- `docs/findings/l3-oauth-mode.md` has the run id and the per-case table.

## 11. Not built in this PR

- The G leg of `OAUTH-002` (a LibreChat tool call with the wrong-audience token) and `OAUTH-006`/`APPR-009` (browser sign-in). Named in
  the findings.
- The Outline, Mattermost and Penpot legs of the all-home cases: those servers are not OAuth-capable in this harness.
- Nextcloud OAuth (`PROT-010`, `OAUTH-011`): the harness cannot put Nextcloud in OAuth mode.
