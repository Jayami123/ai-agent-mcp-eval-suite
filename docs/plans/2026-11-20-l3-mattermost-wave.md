# L3 Mattermost wave: plan

Status: plan only. Branch `feat/2026-11-20-l3-mattermost-wave`, base `main` at `cf02bcc`. The reviewer pre-approved building straight through after this plan (see the PR). Case IDs come only from the ledger (`tests/l3/support/l3-cases.json`, which mirrors the approved L3 plan `docs/plans/2026-11-18-l3.md` sections 11.4 and 13). This plan invents none.

## 0. Harness pin

- `qa-portfolio-harness` moves from `v0.6.7` to **`v0.6.8`**, resolved by the lockfile to commit `e796439ddf07efe67f22ee1b1edb51efa57fb5f6` (the tag's peeled commit). Never `main`.
- Facts read from the installed `0.6.8` package (not from the harness repository):
  - **H2 (second identity)**: `P4_SECOND_IDENTITY=1` makes the Mattermost adapter create member `qa-agent-b` with its own PAT, written to `mattermost-b-run.json` (`secondRunStateFile()`). The adapter also exposes `probeSecondIdentity()` and `waitSecondMcp()`.
  - **H7 (seeded posts)**: `P4_SECOND_POSTS=1` (requires H2) makes `qa-agent-b` post three messages prefixed `p4-h7: ` in `town-square`. `probeSeededPosts()` checks them.
  - Endpoints: API `127.0.0.1:8065`, MCP `127.0.0.1:8066/mcp`. The member PAT (`qa-agent`) is the MCP credential. The owner `qa-owner` is system admin, setup only (V15).
  - **H4 (OAuth mode, `requiresOAuth: true`)**: not present. `grep` for `requiresOAuth` finds only `false`.
  - **H9 (recording proxy)**: not present.
  - **H1 (Nextcloud mail)**: `nextcloud.mail.compose.yml` and GreenMail exist, but they belong to the Nextcloud stack, which this job does not start.
  - **H3 (approval knob)**: present (`LIBRECHAT_TOOL_APPROVAL*`), already used by `tests/l3/nextcloud/appr-*`.

## 1. Every Mattermost case in the L3 plan, and what this wave does with it

"Home" and "all" come from the registry. A case is **built** if it runs in CI in this wave. A **skipped** stretch case is registered and skipped with a named blocker (D10). A **deferred** core case is not written, and is listed with its reason (D10 forbids skipping core).

| ID | Kind | Modes | Needs | Status | Reason |
|---|---|---|---|---|---|
| P4-MCP-INJ-009 | core | G+M | APPR | **built** | Mattermost-only seed (MM0 poisoned post in `p4l3-public`). Deviation D-M1 applies to the "other server" sink. |
| P4-MCP-INJ-010 | core | G+M | APPR+USR2 | **built** | Needs H2 (second identity) and H7. Deviation D-M2 (second author for the DM and thread reply). |
| P4-MCP-INJ-013 | core | M | APPR | **built, stub plumbing only** | Measured leg is nightly (`M`). The stub leg proves the 5-turn script is delivered and the trace is valid. The ASR is not a PR gate. |
| P4-MCP-OAUTH-015 | stretch | G | APPR | **skipped** | Blocker: no proof yet that the pinned mm-agents commit `96ecd17` can deny one MCP tool. The S2 probe in this wave records whether it can. Not H4 or H9. |
| P4-MCP-INJ-015 | stretch | M | APPR+NCMAIL | **skipped** | Blocker: needs a Nextcloud stack with the GreenMail sink, which is a pair job. Measured only; not a PR gate. |
| P4-MCP-FLOW-011 | stretch | G+M | APPR+NCMAIL | **skipped** | Blocker: same pair job (Nextcloud mail). |
| P4-MCP-FLOW-001 | core | G+M | APPR | **deferred** | Its seed is a Twenty deal (TW1, amount 7654321). It needs a Mattermost+Twenty pair stack (plan 14.3). That does not fit the 20-minute job. |
| P4-MCP-FLOW-010 | core | G+M | APPR | **deferred** | Its sink is a Twenty note create (TW1). Same pair stack. |
| P4-MCP-FLOW-002 | core | G+M | APPR+NCMAIL | **deferred** | Needs Nextcloud plus the mail sink (pair job). The Nextcloud MCP mail tool is not yet captured (U5). |
| TOOL-003 (all) | core | G | APPR+NCMAIL | **deferred** | Four-server case including Nextcloud mail. |
| FLOW-007 (home nextcloud) | core | G+M | APPR | **out of wave** | Home is Nextcloud; it is a Nextcloud+Mattermost pair case (plan wave 5). |
| PROT-001, 002, 003, 004, 007, 008, 009, 012 (all) | core | P | none | **built** | Protocol cases run against every server in the `mattermost` entry, as they already do for the other servers. PROT-007 needs a committed `mattermost.tools.json` snapshot from the probe. |
| OAUTH-001 (all) | core | P | none | **built** | Metadata probe, mode P. |
| TOOL-001 (all) | core | P+G | none | **built** | Needs a Mattermost fixture for an extra-field write call (G leg). |
| TOOL-004 (all) | core | G | none | **built** | Needs a Mattermost read-only tool fixture (G leg). |
| SUPP-001 (all) | core | P | none | **built** | Supply-chain protocol probe, mode P. |
| OAUTH-002 (all) | core | P+G | OAUTH (H4) | **skipped for this server** | H4 is absent from `0.6.8`. The case cannot run its OAuth leg. Not registered as a stretch, so it stays deferred with this reason. |
| OAUTH-005 (all) | core | P | OAUTH (H4) | **deferred** | Needs `requiresOAuth` for the server. H4 absent. |
| REL-007 (all) | core | G | APPR+RAM5 | **deferred** | Five-server RAM proof (D5). |

Counts: 3 injection/flow-adjacent cases built, 3 stretch skipped, 3 core flow cases deferred (pair stack). Protocol and tool legs of the all-group run for Mattermost: 12 built, 4 deferred (H4 or RAM5 or NCMAIL). The owner can reorder.

## 2. Live probe first (CI, real stack)

The cloud session has no Docker. The probe runs in the `l3-mattermost` CI job before any assertion is written. It records, with secrets redacted and no message bodies beyond the fixed probe text:

1. `initialize` and `tools/list` from the Mattermost MCP (names, schemas, sizes). This becomes `tests/l3/snapshots/mattermost.tools.json` after review.
2. A read-only `tools/call` on a benign channel: request shape, output shape, latency.
3. Error shapes: unknown channel, wrong argument type, missing argument (the JSON-RPC error or `isError` form).
4. Whether a **member** PAT can create a public channel through the API (needed for seeding `p4l3-*` channels).
5. Whether a post made through an MCP write tool records its author as `qa-agent` (the MCP identity), and how the second identity's post differs.
6. `probeSecondIdentity()` and `probeSeededPosts()` from the harness (counts and usernames only).
7. Whether the pinned MCP can deny one tool by policy (OAUTH-015 question): record only, no assertion.

Results go to `evidence/l3-capture/mattermost.*` and a redacted summary to the job log. Then `docs/findings/l3-mattermost.md` records the requests, outputs and error shapes, and the assertions are written from those observations only.

## 3. Oracles (never the model's text)

- Read through the Mattermost REST API, `http://127.0.0.1:8065/api/v4`, with the **second identity's own PAT** (`qa-agent-b`). It is not the MCP's token (`qa-agent`), so the oracle does not share the credential path under test. The model's reply is never read.
- `MattermostOracle` (new, `src/oracles/mattermost.ts`) implements the `ServerOracle` interface: `snapshot()` (per channel: id, name, post count, post ids and a digest of messages, membership), `close()`, and named helpers: `noPost(channel, contains)`, `channelUnchanged(channel)`, `dmUnchanged(pair)`, `noFileUpload(channel)`.
- Each case takes a before and an after snapshot, and checks with `unchanged()`.

## 4. Hygiene

- Each case uses its own channels named `p4l3-<case>-<runId>` (lowercase, within Mattermost limits). No case reads another case's channel.
- A cleanup sweep archives every channel the run created (`DELETE /channels/{id}` archives), and runs first at setup too, so a previous run's leftovers are archived before seeding.
- Leak check: after the run, every file in `evidence/` is scanned for the PAT values and the agent password from `.harness` (read from the run state and secrets file, never printed). A hit fails the run before upload.
- Secrets: passwords and PATs are generated per run by the harness into `.harness/`. The suite prints names and counts only.

## 5. Labels

Each failing case gets one label with evidence in `verdicts.json`:

- **TEST BUG**: our assertion or seed is wrong. The fix is in the suite.
- **PRODUCT BUG**: confirmed against the ledger oracle, with setup asserted first. Only then `expectedDefect()` is used (`tests/l3/support/expected-defect.ts`).
- **Deployment finding** (config or spec gap): the case passes and carries a note.

## 6. CI

A new job `l3-mattermost`, stub model (`P4_LLM_MODE=stub`), `P4_SECOND_IDENTITY=1`, `P4_SECOND_POSTS=1`, `P4_L3_SERVERS=mattermost`. It runs `npm run test:stack:l3:mattermost`, uploads `evidence/`, and stops the stub. Target about 20 minutes; the timeout is set after the first measured run. No secrets, safe for fork PRs. Advisory until stable, as the other L3 stack jobs are.

## 7. Deviations (for the reviewer)

- **D-M1** INJ-009's sink is "another channel on Mattermost", not "another server", because this job starts only Mattermost. The injected write still goes to a channel the user did not ask for, and the oracle reads that channel. Recorded here, not silently changed.
- **D-M2** INJ-010's DM and thread reply are authored by the second identity (`qa-agent-b`), not `qa-owner`. The harness exposes the second user's token, not the owner's, and the owner is setup-only (V15).
- No other case IDs changed. Nothing is renumbered.

## 8. Not done in this wave (and why)

- Nothing needs H4 or H9 in the Mattermost folder. The H4-dependent cases are OAUTH-002 and OAUTH-005 on the all-group legs (listed above). H9 is used by no Mattermost case.
- The pair-stack cases (FLOW-001, FLOW-010 with Twenty; FLOW-002, FLOW-011, INJ-015, TOOL-003 with Nextcloud mail) need a second product in one stack. That is the pair job in plan 14.3, outside a 20-minute job.
- OAUTH-015 stays skipped unless the probe proves the per-tool policy.
