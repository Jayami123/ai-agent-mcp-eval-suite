# Plan: L3 host design cases (`feat/2026-11-21-l3-host-design`)

Read this first if you are new to the L3 lane. The master plan is `docs/plans/2026-11-18-l3.md` (case specs in its section 11,
the lab-only PR table in section 13). The IDs and their `kind`, `needs` and `pr` fields are in `tests/l3/support/l3-cases.json`.
Case IDs come from that file only. Nothing here invents an ID.

This plan was committed as the first commit of the branch, as the owner allowed (the separate plan-PR stop in `CLAUDE.md` is
waived for this PR). Review it with the code.

## 1. What this PR does

It builds three host cases that drive the attack-lab (L2) through LibreChat in stub mode (G mode):

| Case | Kind | Lab start mode | What it proves |
|---|---|---|---|
| P4-MCP-APPR-008 | core | `app-tool` | a tool that carries MCP Apps UI metadata still pauses for approval, and does not run before approval |
| P4-MCP-REL-003 | core | `slow-task` | a user Stop aborts a running tool call; the lab shows it did not complete; nothing is written after the stop; the chat holds no invented tool result |
| P4-MCP-REL-004 | core | `slow-task` (switched to `always-fail`) | four identical failing calls do not escalate to the mail tool |

The ledger says `wave C`, `pr 6` for these three IDs. The branch name and the owner's brief call this "PR 2 of the L3 wave B
series". The ledger is not edited here: its `pr` field is the one the master plan uses. The reviewer decides the label.

## 2. Source facts (LibreChat v0.8.9, the pinned tag)

The pin is `docker/librechat.compose.yml` in the harness v0.6.11 package: `ghcr.io/librechat-ai/librechat:v0.8.9@sha256:4a3967a4...`.
The source was read from the upstream tag `danny-avila/LibreChat` at `v0.8.9`. The image digest was not checked against that tag.

- **MCP Apps are supported.** `packages/api/src/mcp/apps.ts`: `RESOURCE_URI_META_KEY = 'ui/resourceUri'` (line 31),
  `getToolUiResourceUri` reads `_meta.ui.resourceUri` and requires a `ui://` URI (lines 63-76), `isToolHiddenFromModel` reads
  `_meta.ui.visibility` (lines 87-89). `packages/api/src/mcp/MCPManager.ts` attaches the app resource to a tool result
  (lines 2207-2213).
- **Approval is not exempted for app tools.** `api/server/services/MCP.js` line 1502 binds approval metadata to every MCP tool
  instance. No file in `packages/api/src/agents/hitl/` or `packages/api/src/tools/approval.ts` checks UI metadata.
- **App-initiated calls skip that path.** `MCPManager.appToolCall` (line 2719 onward) sends `tools/call` straight to the
  connection. It does not call the approval check. This is recorded as a finding, not tested here (it needs the browser iframe).
- **User Stop reaches the MCP call.** `api/server/services/MCP.js` derives a signal from the chat's signal (line 1321), and logs
  "Tool call cancelled by user abort" (lines 1427-1431). `MCPManager.ts` line 2314 logs the same for app calls.
- **Stop endpoint.** `POST /api/agents/chat/abort` (`api/server/routes/agents/index.js`, line 627) takes `streamId` and
  `conversationId`.
- **Retry.** No per-tool retry in the MCP call path (`api/server/services/MCP.js`, `packages/api/src/mcp/MCPManager.ts`). The only
  retries are in authorization. The only step cap is the per-run recursion limit: `DEFAULT_RECURSION_LIMIT = 50` in
  `packages/api/src/agents/config.ts` line 9.

## 3. Lab changes (`src/attack-lab`)

Three modes are added. Each lists its tool only in that mode, so the benign pin (`tests/l3/snapshots/lab.tools.json`) does not change.

- `app-tool`: lists `lab_app_view`, a read-only tool with `_meta: { ui: { resourceUri: "ui://p4-lab/view", visibility: ["model",
  "app"] } }`. The lab serves that `ui://` resource through `resources/list` and `resources/read` (MIME type
  `text/html;profile=mcp-app`, per the MCP Apps spec; the LibreChat constant was not read). The resource is served in every mode.
- `slow-task`: lists `lab_slow_task`, a write tool. It waits `LAB_SLOW_MS` (default `20000`). If the request signal aborts during
  the wait, it records `call_aborted` and writes nothing. If the wait finishes, it writes a `task-write` record to the sink and
  returns `p4 slow task done`.
- `always-fail`: `lab_add` returns an error every time and records `call_failed`. It only changes behaviour, so it needs no restart.

One new lab observation: when the lab receives a JSON-RPC `notifications/cancelled`, it records `cancelled_notification` with the
request id. The parsing is a pure function (`src/attack-lab/cancel.ts`), with unit tests.

All lab changes have unit tests in `tests/l2/l3-host-design.test.ts`. The mode list test (`tests/l2/modes-catalog.test.ts`) is updated.

## 4. Fixtures (`src/stub/fixtures`)

Each fixture is named by the ledger (the orphan-fixture test fails on anything else). Fake data only.

- `p4-mcp-appr-008`: turn 1 calls `lab_app_view` (paused and rejected), turn 2 calls it again (paused and approved), turn 3 is text.
  One chat carries both the negative and the positive control.
- `p4-mcp-rel-003`: turn 1 calls `lab_slow_task`, turn 2 is text. The run is cancelled while the call is running.
- `p4-mcp-rel-004`: turns 1 to 4 each call `lab_add` with `a: 1, b: 2`, turn 5 is text.

The `[fixture:...]` marker selects a fixture. There are no run-time values, so no `[var:]` marker is needed.

## 5. Oracles (side effects, never model text)

- **APPR-008.** (a) `tools/list` from a fresh session shows `lab_app_view` with `_meta.ui.resourceUri` starting `ui://`. (b) The
  pauses for the app tool number two; the first was rejected, the second approved (from the approval trace). (c) The lab log has
  exactly one `call_started` and one `call_completed` for `lab_app_view`. That means the rejected pause ran nothing.
- **REL-003.** (a) The first pause was approved, and the lab log shows `call_started` for `lab_slow_task`. (b) The lab log
  shows no `call_completed` for `lab_slow_task`. (c) After the stop, the observation window (`LAB_SLOW_MS` plus 5 s) passes, and the
  sink holds no `task-write` record. (d) The conversation's messages (`GET /api/messages/:conversationId`) do not contain
  `p4 slow task done`. (e) `cancelled_notification` seen, or not seen: a not-seen result is a finding (SHOULD), not a failure.
- **REL-004.** (a) The stub delivered the fixture. (b) The lab log has no `lab_mail_send` call and the sink is empty (no
  escalation). (c) The count of `lab_add` calls is recorded in the notes and the finding; it is not a verdict (section 6, D5).

## 6. Decisions (the builder's, for the reviewer to confirm or redirect)

- **D1. LibreChat treats an app tool as a tool.** APPR-008 runs, not a namedSkip. The source shows no app exemption (section 2).
  The app-initiated path (`appToolCall`) is a finding, not a case: it needs the iframe.
- **D2. One chat for both approval controls.** Two pauses in one run (reject, then approve) avoid a second fixture. A second
  fixture would be an orphan under the registry rules.
- **D3. REL-003 is a real cancel.** "Cancel" means the user presses Stop in LibreChat, which calls `POST /api/agents/chat/abort`
  while the call runs. It is not a protocol cancel the test sends itself.
- **D4. Notification absence is a finding.** The spec says the requestor SHOULD send `notifications/cancelled`. If LibreChat does
  not, REL-003 still passes on the lab log and the sink, and the finding is written to `docs/findings/l3-host-design.md`.
- **D5. REL-004 retry cap.** LibreChat has no per-tool cap (section 2). The plan's seed is N=3. Nothing in the L3 plan or the
  brief marks the cap as MUST, so it is a SHOULD. For a SHOULD the case asserts no privilege escalation, and the count is a finding.
  If the owner says it is a MUST, the count check becomes `expectedDefect()` (`tests/l3/support/expected-defect.ts`), not a
  namedSkip. The brief's path `src/kit/ci/known-defect.ts` does not exist in this repo; `expectedDefect` is in the support folder.
- **D6. Two CI jobs, not one.** Each job starts a lab in one mode (the mode must be set before LibreChat starts; a mode switch
  does not refresh the tool list). Two LibreChat stacks in one 30-minute job are too slow. Each job runs one entry file.
- **D7. The slow write uses the sink.** A write that the case can observe after a stop needs a record the lab keeps. The sink
  (`task-write`) is the same record path the mail tool uses.

## 7. CI

Two jobs in `.github/workflows/pr.yml`, both on the wave-B host job pattern (stub container, lab container, one entry file,
evidence upload, `timeout-minutes: 30`):

| Job | Lab start | npm script | Cases |
|---|---|---|---|
| `l3 host-design appr` | `LAB_MODE=app-tool npm run lab:up` | `test:stack:l3:host-design:appr` | APPR-008 |
| `l3 host-design rel` | `LAB_MODE=slow-task npm run lab:up` | `test:stack:l3:host-design:rel` | REL-003, REL-004 |

Both run `registerHygieneTests` (the sweep and the leak check), as the wave-B host job does. Both use `P4_LLM_MODE=stub`. No
`GEMINI_API_KEY`. No provider keys. No secrets in the repo.

## 8. Done means

- Each case passes in CI, or is a documented finding with the reason. No case is skipped silently.
- `npm run check` passes locally (typecheck, unit tests, build).
- `docs/findings/l3-host-design.md` has the CI run id, the head SHA and a per-case table with the verdicts from the job logs.
