# L3 plan PR 9, wave D3: OAuth mode

Branch `feat/2026-11-22-l3-oauth-mode`. Plan: `docs/plans/2026-11-22-l3-oauth-mode.md`. Harness pin `qa-portfolio-harness` v0.6.11. Stub model only. The server under test is the Twenty fork `Jayami123/twenty-CRM` at `7cbdfec6` (the commit the harness adapter builds; the same pin as the other Twenty jobs). Nothing in the fork was edited.

## Runs

| Run | Head | Result | Notes |
|---|---|---|---|
| `44940915594` | `cd374ca` | `l3 oauth` failed before any case ran | `Twenty product root does not exist: .../products/twenty-CRM`. The job had no fork checkout. |
| `44942038447` | `a412d57` | `l3 oauth` **success** (12 tests: 8 pass, 0 fail, 4 skipped) | The run this table rests on. Job id `136961321967`. |

Verbatim from the job log of `44942038447`:

    ok 1 - P4-MCP-OAUTH-004 ...
    ok 2 - P4-MCP-OAUTH-007 ...
    ok 3 - P4-MCP-OAUTH-008 ...
    ok 4 - P4-MCP-OAUTH-009 ...
    ok 5 - P4-MCP-OAUTH-002 ...
    ok 6 - P4-MCP-OAUTH-005 ...
    ok 7 - P4-MCP-OAUTH-006 ... # SKIP named skip: needs a LibreChat browser sign-in and a Twenty consent step, not built here
    ok 8 - P4-MCP-APPR-009 ... # SKIP blocked: needs the LibreChat browser sign-in ...
    ok 9 - P4-MCP-PROT-010 ... # SKIP named skip: the harness cannot put Nextcloud in OAuth mode
    ok 10 - P4-MCP-OAUTH-011 ... # SKIP named skip: the harness cannot put Nextcloud in OAuth mode
    ok 11 - hygiene: cleanup sweep removes what the cases made
    ok 12 - hygiene: leak check finds no secret in evidence/
    # pass 8  # fail 0  # skipped 4

The job's evidence artifact is `l3-oauth-evidence-44942038447` (artifact id `14722517456`). The per-check detail (each verdict's text) is in that artifact. It was not downloaded or read in this session, so the table below names the response each case asserts on, and does not quote the verdict text.

## Per-case table

| Case | Job | Status | What the pass rests on |
|---|---|---|---|
| `P4-MCP-OAUTH-004` | `l3 oauth` | **pass** | Discovery answered 200 with `registration_endpoint`, `S256` and `none`. Registration returned a `client_id`, and a `client_secret_basic` request came back as `none`. A signed-in authorize returned a redirect URL with a code, and the token exchange returned an access token. A mutated redirect was refused. Twenty records unchanged (snapshot). |
| `P4-MCP-OAUTH-007` | `l3 oauth` | **pass** | An attacker redirect and a trailing-slash variant were both refused at authorize, and neither returned a redirect URL. Twenty records unchanged. |
| `P4-MCP-OAUTH-008` | `l3 oauth` | **pass** | Authorize with `issuer` set to a look-alike host was refused. `/mcp` answered 401 to a bearer the server cannot verify, with `WWW-Authenticate` naming `resource_metadata`. Twenty records unchanged. |
| `P4-MCP-OAUTH-009` | `l3 oauth` | **pass** | The second redemption of a code returned `invalid_grant`. Client B could not redeem client A's code (`invalid_grant`). A wrong verifier returned `invalid_grant`. Twenty records unchanged. |
| `P4-MCP-OAUTH-002` | `l3 oauth` | **expected defect, still reproduces** | Client A's own token reached `/mcp` (control). Client B's token was **accepted** by `/mcp` (the expected-defect branch only fails on an accepted token). See the defect section below. |
| `P4-MCP-OAUTH-005` | `l3 oauth` | **pass** (server side) | Authorize with an extra scope (`admin`) was refused with `Invalid scopes`. Authorize with `profile` alone returned a token whose `scope` is `profile`. Twenty records unchanged. The consent screen is UI and was not observed (finding). |
| `P4-MCP-OAUTH-006` | `l3 oauth` | **named skip** | Needs a LibreChat browser sign-in and a Twenty consent step, neither built. Section 5 of the plan. |
| `P4-MCP-APPR-009` | `l3 oauth` | **blocker** (stretch) | Needs the LibreChat browser sign-in (`scripts/live/librechat-oauth.mjs`) driven by a test. |
| `P4-MCP-PROT-010` | `l3 oauth` | **named skip** | Nextcloud cannot be put in OAuth mode by the harness (attempt below). |
| `P4-MCP-OAUTH-011` | `l3 oauth` | **named skip** | Same as PROT-010. |

## Expected defect: the MCP accepts a bearer issued to another client (`P4-MCP-OAUTH-002`)

The probe registered two clients (A and B), signed in once as the harness admin, and exchanged an authorization code for each. Client A's token listed the MCP tools (control: the probe works). Client B's token also listed the MCP tools, so `/mcp` accepted a token issued to a different application. The ledger expects a refusal (401).

Source reason (fork `7cbdfec6`, identical to upstream `v2.44.0` for these files):
- `packages/twenty-server/src/engine/core-modules/jwt/services/jwt-wrapper.service.ts` (lines 129-150): `jwt.verify(token, key, {...options, algorithms})`. The MCP path passes no `audience` or `issuer`.
- `packages/twenty-server/src/engine/core-modules/auth/token/services/access-token.service.ts` (lines 185-200): `validateToken` calls `verifyJwtToken(token)` with no options.
- `packages/twenty-server/src/engine/core-modules/application/application-oauth/oauth.service.ts`: the token pair carries `applicationId`, `workspaceId` and `userId` (`application-token.service.ts`). No `aud` is minted and none is checked.

Why it is a defect, not a design choice: the MCP authorization specification requires resource servers to validate that a token was issued for them (audience). Twenty answers `/mcp` with any valid application token of the workspace. Confirmed in this run. The annotation (`expectedDefect`) flips to a failure when the server refuses the token, which is the signal to remove it.

## Findings (not failures)

- **`state` is echoed without a server check** (`auth.service.ts` lines 663-668). RFC 6749 section 10.12 makes the check the client's duty. Recorded in `P4-MCP-OAUTH-009`.
- **Scopes are a consent label, not an access control.** The source calls them "a thin consent boundary"; permissions come from the role (`oauth-scopes.ts` lines 1-16). `P4-MCP-OAUTH-006` assumes a scope step-up is enforced. It is a design difference, so the case stays a named skip.
- **The consent screen is UI** and was not observed. `P4-MCP-OAUTH-005` checks the server-side scope list only.
- **Fork against upstream.** The fork's `auth.resolver.ts` guards `authorizeApp` with `UserAuthGuard` and `RequireUserSessionGuard` (fork lines 1018-1019), not the upstream `AuthPrincipalGuard`. The signed-in probe worked with the workspace token, so the fork guard accepted it.
- **Scope of the all-home cases.** `P4-MCP-OAUTH-002` and `-005` were built on Twenty only. Outline, Mattermost and Penpot are not OAuth-capable in this harness (README lines 532-539, the record for v0.6.10). Their legs are not built.

## Nextcloud attempt (`P4-MCP-PROT-010`, `P4-MCP-OAUTH-011`)

Run on this branch in the plain gate (`tests/l3/oauth/nextcloud-attempt.test.ts`, which imports the harness's own resolver file):

    LIBRECHAT_MCP_OAUTH=1, LIBRECHAT_MCP_PRODUCTS=nextcloud
    -> LIBRECHAT_MCP_OAUTH_NO_SERVER: LIBRECHAT_MCP_OAUTH=1 needs an OAuth-capable product in LIBRECHAT_MCP_PRODUCTS (twenty)

    LIBRECHAT_MCP_OAUTH=1, LIBRECHAT_MCP_PRODUCTS=nextcloud,twenty
    -> products: ["twenty"]   (Nextcloud is dropped silently)

The only OIDC adapter in the harness is for Documenso (`src/adapters/documenso-oidc.ts`). Nextcloud OAuth needs an OIDC provider and the `user_oidc` app, which the harness does not build (`librechat-oauth.ts` lines 26-31).

**Harness request:** add an OAuth mode for Nextcloud (an OIDC provider and the `user_oidc` app, or the Nextcloud OAuth2 app) to the harness, so that `LIBRECHAT_MCP_OAUTH=1` can list Nextcloud in `OAUTH_CAPABLE_PRODUCTS`. Then remove the `namedSkip` options in `tests/l3/oauth/skipped.cases.ts` for PROT-010 and OAUTH-011.

## Harness request (Twenty, G legs)

To build `P4-MCP-OAUTH-006` and `P4-MCP-APPR-009`: a test-side driver for the LibreChat browser sign-in (the logic of `scripts/live/librechat-oauth.mjs`, exported as a function). Then the G legs can run a LibreChat-held token. The same driver would also build the G leg of `P4-MCP-OAUTH-002`.

## Budgets (named, with the basis)

- `OAUTH_HTTP_TIMEOUT_MS` = 15 000 ms: the harness's own registration call (`librechat-oauth-register.ts` line 45).
- Registrations per run: 3 probe clients plus the harness's own. The per-IP limit is 10 per hour in production (`oauth-registration.controller.ts` lines 38-40).
- Job timeout: 30 minutes (CLAUDE.md). The job ran in about 5 minutes of test time (247 s for the test run).

## Unverified

- The verdict text of each check (in the evidence artifact, not read).
- The G leg of `P4-MCP-OAUTH-002`, `P4-MCP-OAUTH-006` and `P4-MCP-APPR-009` (not built).
- The consent screen (UI).
- The higher-scope tool refusal in the plan's OAUTH-005 leg (not built; the server-side scope list is what runs).
- The Outline, Mattermost and Penpot all-home legs (not OAuth-capable).
