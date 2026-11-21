# L3 approval wave B findings (PR 1, `feat/2026-11-21-l3-appr-wave-b`)

Plan: `docs/plans/2026-11-21-l3-appr-wave-b.md`. Pinned Twenty: `Jayami123/twenty-crm` at `7cbdfec6` (read-only). Harness `qa-portfolio-harness` `v0.6.10`.

## Twenty workspace access (source evidence, pinned fork)

Question 1: which resolver serves `currentWorkspace`, on which endpoint, and which guard it uses.

- Resolver: `WorkspaceResolver.currentWorkspace`, `packages/twenty-server/src/engine/core-modules/workspace/workspace.resolver.ts:111-114`, decorated `@Query(() => WorkspaceEntity)` and `@UseGuards(WorkspaceAuthGuard, NoPermissionGuard)`.
- Endpoint: the class is `@MetadataResolver(() => WorkspaceEntity)` (`workspace.resolver.ts:87`). `MetadataResolver` sets the schema scope to `'metadata'` (`engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator.ts:7-10`). The `metadata` scope is the schema built for `/metadata` (`engine/api/graphql/metadata.module-factory.ts:39`, path `ApiPath.Metadata` at line 74). So `currentWorkspace` is served on `/metadata`, not `/graphql`.
- Guard: `WorkspaceAuthGuard` (`packages/twenty-server/src/engine/guards/workspace-auth.guard.ts:22-27`). It returns false when the request has no `workspace`, i.e. for a workspace-agnostic token.
- Not found in source: the exact text "This endpoint is not available to this caller" (both CI runs). The pinned fork has no such string. The harness runs image `twentycrm/twenty:v2.44.0`, which may differ from the fork commit. This is a finding, not confirmed.

Question 2: the token type the harness gives and its workspace binding.

- The harness `authenticate()` returns `signIn.tokens.accessOrWorkspaceAgnosticToken` directly when it is present (`node_modules/qa-portfolio-harness/dist/adapters/twenty.adapter.js:394-400`, reading `dist/adapters/twenty-env.js:73-75`).
- The `signIn` resolver issues that token from `generateWorkspaceAgnosticToken` (`packages/twenty-server/src/engine/core-modules/auth/auth.resolver.ts:259-300`, the token at line 280). It is **workspace-agnostic**: no workspace.
- The login-token exchange (`getAuthTokensFromLoginToken`, `auth.resolver.ts:761-800`) issues a workspace-bound access token. The access token payload carries `type: ACCESS` and `workspaceId` (`engine/core-modules/auth/token/services/access-token.service.ts:130-135`).
- The exchange checks the origin against the login token's workspace (`auth.resolver.ts:870-892`, error "Token is not valid for this workspace" at line 886).
- So the harness token that the first TW1 version used is workspace-agnostic. That is why `currentWorkspace` cannot be served on it.

Why workspace B cannot be entered:

- `docker/twenty.compose.yml` sets `IS_MULTIWORKSPACE_ENABLED: "false"` (lines 36 and 52) in the harness. The harness passthrough says the value is read at `config-variables.ts:2113` in the pin.
- In single-workspace mode every origin resolves to the default workspace (`packages/twenty-server/src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service.ts:111-122`). The default is the Apple seed workspace if present, else the newest (`:67-95`).
- So the exchange for YCombinator (workspace B) produces a token for Apple and fails the origin check. Workspace B is not reachable in this harness.

## What the seed and sweep do now

- One helper: `twentyWorkspaceClient` (`tests/l3/support/seed/twenty.ts`). Both `seedTw1` and `sweepTwentyP4L3` call it.
- It takes the login-token exchange for the workspace (not the harness's agnostic token). It checks the binding from the token's claims (`tests/l3/support/seed/twenty-binding.ts`, unit tests in `twenty-binding.test.ts`), then checks `currentWorkspace` on `/metadata` with that token. A bound token is allowed that call (`workspace-auth.guard.ts:22-27`).
- Workspace B: only TOOL-006 needs it, through `seedWorkspaceB`. It fails with `TWENTY_TW1_NO_BOUND_TOKEN`.

## Per-case status

| Case | Status | Why |
|---|---|---|
| P4-MCP-INJ-005 | see CI | workspace A only |
| P4-MCP-INJ-006 | see CI | workspace A only |
| P4-MCP-TOOL-006 | named skip | needs workspace B, unreachable (section above) |
| P4-MCP-TOOL-009 | see CI | workspace A only |

## P4-MCP-TOOL-006: namedSkip

Core case. The body is kept as designed in the plan (`docs/plans/2026-11-18-l3.md`, section 11.1). It needs workspace B's company, reachable only through the exchange for B. In this harness that exchange cannot produce a token for B (see "Why workspace B cannot be entered"). The case stays a named skip until the harness runs Twenty with `IS_MULTIWORKSPACE_ENABLED=true` (a harness decision, not changed here), or the owner decides the case is out of scope in single-workspace mode.

## Open items

- The exact "not available to this caller" message is not in the pinned fork. Confirm which build produces it before changing the helper again.
- `l4 openclaw stub` P4-OC-MEM-002 (control leg) failed once on this branch; `main` passed. Re-run to decide whether it is flaky.
