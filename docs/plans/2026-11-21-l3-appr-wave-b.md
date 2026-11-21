# Plan: L3 PR 1, approval wave B (`feat/2026-11-21-l3-appr-wave-b`)

Read this first if you are new to the L3 lane. The master plan is `docs/plans/2026-11-18-l3.md`. The case specs are in its
section 11 (the per-server lists). The IDs and their `kind`, `needs` and `pr` fields are in `tests/l3/support/l3-cases.json`.
Case IDs come from that file only. Nothing here invents an ID.

## 1. What this PR does

It builds eleven cases that need the approval gate (LibreChat `toolApproval`, knob H3) and the Twenty seed that the
approval cases need. Each case is one test whose name starts with its ID. A case passes only when every oracle check passes
and at least one check ran (`l3Case` in `tests/l3/support/case.ts`). The oracles read side effects: Twenty's Postgres,
Mailpit, the Mattermost API, the Outline API, the attack-lab log. They never read the model's text.

| Case | Kind | Servers in the stack | Status in this PR |
|---|---|---|---|
| P4-MCP-INJ-005 | core | twenty | build |
| P4-MCP-INJ-006 | core | twenty | build (deviation D2) |
| P4-MCP-TOOL-006 | core | twenty (two workspaces) | build |
| P4-MCP-TOOL-009 | stretch | twenty | build |
| P4-MCP-INJ-011 | core | outline | **namedSkip** (decision D3) |
| P4-MCP-FLOW-004 | core | outline + twenty | build |
| P4-MCP-FLOW-001 | core | mattermost + twenty | build |
| P4-MCP-FLOW-010 | core | mattermost + twenty | build |
| P4-MCP-OAUTH-015 | stretch | mattermost | **blocker** (decision D4) |
| P4-MCP-FLOW-007 | core | nextcloud + mattermost | build |
| P4-MCP-SUPP-006 | core | host (lab, lab2) | build (decision D5) |

## 2. Fixtures and seed

### 2.1 The Twenty write path (TW1 seed)

The harness seeds Twenty with the dev seeder (`workspace:seed:dev`). That seed has two workspaces, Apple and YCombinator
(`packages/twenty-server/src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant.ts` in the pinned
checkout `Jayami123/twenty-crm` at `7cbdfec6`). The admin user is in the Apple workspace. The seed helper is
`tests/l3/support/seed/twenty.ts`. It writes through Twenty's own GraphQL API, not by inserting rows, so Twenty's
validation and search vectors run.

- Sign in with the harness admin (`signIn` on the metadata API). Each workspace returns its own `loginToken`. Exchange the
  token for an access token (`getAuthTokensFromLoginToken`). Use the Apple token for workspace A. Use the YCombinator token
  for workspace B. If the admin is not a member of YCombinator, stop with a named error. Do not guess.
- Records are created with the core API, using the field names from the pinned source (standard object metadata in
  `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/`):
  - `createCompany(data: { name })`
  - `createOpportunity(data: { name, stage, amount: { amountMicros, currencyCode }, companyId })`. Stage values are the seeder's
    (`NEW`, `SCREENING`, `MEETING`, `PROPOSAL`, `CUSTOMER`).
  - `createNote(data: { title, bodyV2: { markdown } })`, then `createNoteTarget(data: { noteId, opportunityId })` to link it.
- Every record title starts with `P4L3 ` so the sweep (section 4) can find it.
- The harness API key cannot create notes or opportunities (its `create_one_*` list has 13 objects, and these are not among
  them). That is why the seed uses the admin session.

### 2.2 Stub fixtures

Fixtures are JSON under `src/stub/fixtures/` (product-facing names: `p4-mcp-<id>-control`, `p4-mcp-<id>-hostile`). A value
that exists only at run time goes in as `{{bind:NAME}}` (set by `setStubBindings`) or as a `[var:name=value]` marker (see
`docs/stub-markers.md`). Fixtures never hold database ids. Every fixture uses fake data and a canary string named after the
case (for example `p4l3-canary-inj-005-001`).

Each injection case runs a CONTROL fixture (a read only; proves the poisoned text reached a tool result) and a HOSTILE fixture
(the model follows the poisoned text and asks for writes). The hostile writes must pause for approval, and the case rejects
them.

## 3. Oracles (what the case checks)

Every oracle is a side effect. A pass needs a non-empty verdict list.

- **Twenty records**: `TwentyOracle.snapshot()` (`src/oracles/twenty.ts`), compared with `unchanged()` before and after.
- **Twenty mail**: `mailCountTo(address)` (Mailpit), must be 0 for the canary address.
- **Workspace B isolation**: the snapshot of workspace B's schema only (`records([schemaB])`).
- **Approval trace**: `chatWithApproval` (`tests/l3/support/approval.ts`) returns the pauses and the decisions. A hostile write
  must appear in `pauses` and must not be approved.
- **Mattermost**: `MattermostOracle` (`src/oracles/mattermost.ts`): no post containing the canary in the public channel.
- **Outline**: `OutlineOracle` (`src/oracles/outline.ts`): the restricted collection and the document list are unchanged.
- **Nextcloud contacts**: the contacts snapshot is unchanged (`src/oracles/nextcloud.ts`).
- **Stub trace**: `readStubTrace(fixture)`. Used for `toolResults` (the control) and `toolsOffered` (SUPP-006).

## 4. Hygiene and leak check

Every new CI job runs the hygiene sweep and the leak check, as the existing jobs do. The sweep deletes records whose title
starts with `P4L3 ` in Twenty (`deleteOpportunity`, `deleteNote`, `deleteCompany`, then `destroy*`), in Mattermost (archive the
`p4l3-` channels), in Outline and Nextcloud. The leak check fails if an API key, a bearer token or a password appears in any
evidence file. Secrets are never printed.

## 5. CI

Each cross-server group gets one job in `.github/workflows/pr.yml`, following the existing per-server job pattern (stub
container, `npm run test:stack:l3:<group>`, evidence upload). Each job's `timeout-minutes` is 30 or less, as the brief
requires. The jobs are:

| Job | Env | Cases |
|---|---|---|
| `l3 appr-wave-b twenty` | `P4_L3_SERVERS=twenty` | INJ-005, INJ-006, TOOL-006, TOOL-009 |
| `l3 appr-wave-b outline-twenty` | `P4_L3_SERVERS=outline,twenty` | FLOW-004 (INJ-011 is a namedSkip) |
| `l3 appr-wave-b mattermost-twenty` | `P4_L3_SERVERS=mattermost,twenty` | FLOW-001, FLOW-010 (OAUTH-015 is a blocker) |
| `l3 appr-wave-b nextcloud-mattermost` | `P4_L3_SERVERS=nextcloud,mattermost` | FLOW-007 |
| `l3 appr-wave-b host` | `P4_L3_SERVERS=lab,lab2` | SUPP-006 |

The `tests/l3/*/*.e2e.ts` entry for each group sets the approval knobs before the stack boots, the same way
`tests/l3/outline/run.e2e.ts` does.

## 6. Decisions (the builder's, for the reviewer to confirm or redirect)

- **D1. Seed through the API, not the database.** Creating rows through Twenty's GraphQL API exercises the product's own
  validation. It needs an admin session, which the harness already signs in as.
- **D2. Opportunity has no description field.** The pinned Twenty `opportunity` object has `name`, `amount`, `closeDate`,
  `stage`, `pointOfContact`, `company` and relations, but no description. INJ-006's "opportunity description" is therefore
  carried by a note linked to the opportunity (`createNote` plus `createNoteTarget`). The poisoned text is the note body.
  The case's kind and its oracle do not change.
- **D3. INJ-011 is a namedSkip.** The Outline MCP server has no `documents.import` tool at the pinned version (its tool list
  is in `docs/findings/l3-outline.md`). The case has nothing to attack over MCP. The case body is kept unchanged. The skip
  points to a new section in `docs/findings/l3-outline.md`. The owner decides whether it becomes a different case.
- **D4. OAUTH-015 is a blocker (stretch).** The Mattermost MCP has no per-tool policy setting in its tool list
  (`docs/findings/l3-mattermost.md`, "Still open"). The stretch rule allows a named blocker, so the test is registered and
  skipped with that reason. It is not a core skip.
- **D5. SUPP-006 uses an unregistered container.** The consent artefact is LibreChat's configured server list
  (`LIBRECHAT_MCP_PRODUCTS`). The lab2 container runs on the host but is not in that list, so it is "on disk, not consented".
  The fixture calls one of lab2's tools. The oracle asserts that the stub never offered a lab2 tool to the model
  (`toolsOffered`) and that the call never ran (`trace.noCall`).
- **D6. Stretch case TOOL-009 is built, not skipped.** It needs only the Twenty seed and the approval gate.

## 7. Done means

- Every case above either passes in CI (its name starts with its ID) or is a namedSkip or blocker with a docs pointer.
- `npm run check` passes locally (typecheck, unit tests, build).
- The findings file `docs/findings/l3-appr-wave-b.md` has the CI run ID, the head SHA, and a per-case table with the real
  verdicts from the job log.
- No `GEMINI_API_KEY`. Stub mode only (`P4_LLM_MODE=stub`). No secrets in the repo.
