# L3 host design findings (APPR-008, REL-003, REL-004)

Plan: `docs/plans/2026-11-21-l3-host-design.md`. Draft PR 27, branch `feat/2026-11-21-l3-host-design`. Harness `qa-portfolio-harness` v0.6.11 (lockfile commit `f59a7f77`). LibreChat v0.8.9 (image digest in the harness compose file; source read from the upstream tag, not checked against the digest).

## CI runs

| Run | Head | Result | Notes |
|---|---|---|---|
| 44916101377 | `2a28c35` | REL job failed, APPR job passed | REL-003 failed at its first check: the stub trace was read before the chat reached the model (a race in the test, not a product result). REL-004 passed. |
| 44917683534 | `c1a72a8` | both host-design jobs passed | Fix: the REL-003 stub check moves after the first pause; REL-004 now also requires lab `lab_add` calls that all failed. The run's `l4 openclaw stub (gate)` job was still in progress when read; it is outside this change. |

## Per-case table (run 44917683534, head `c1a72a8`)

| Case | Job | Verdict | What the pass rests on |
|---|---|---|---|
| P4-MCP-APPR-008 | `l3 host-design appr` (136886703225) | pass | Test log: the case's `ok`. The case passes only when every check passes and at least one ran (`l3Case`). Checks: lab in app-tool mode; `tools/list` shows `lab_app_view` with a `ui://` `resourceUri`; the app tool asked for approval twice; decisions reject then approve; the lab recorded one start and one completion. Per-check text is in the evidence artifact (not read). |
| P4-MCP-REL-003 | `l3 host-design rel` (136886703401) | pass | Test log: `ok 1`, 124 s. All oracle checks passed: the slow call paused and was approved; the lab started it; the Stop returned 2xx; after the observation window the lab showed no `call_completed`; the sink had no `task-write`; the conversation had no `p4 slow task done` text. The notification note (SHOULD) is in the evidence artifact (not read). |
| P4-MCP-REL-004 | `l3 host-design rel` (136886703401) | pass | Test log: `ok 2`, 458 ms (584 ms in the earlier run). Checks: stub delivered the fixture; the lab recorded at least one `lab_add` start, and every start was a `call_failed`; no `lab_mail_send` call and no mail reached the sink. The count of `lab_add` calls is in the evidence note, not in the log. |

Hygiene: `hygiene: cleanup sweep` and `hygiene: leak check` passed in the REL job (run 44917683534). The APPR job's log was not read in detail; its `success` conclusion covers its hygiene steps.

## What the new REL-004 check shows

The earlier pass had no lab-call requirement, so its "no mail" check was true with zero calls. The added check requires `lab_add` starts >= 1 and all of them to fail. Run 44917683534 passed it, so the lab recorded at least one failing `lab_add` call. The exact count `N` is in the evidence artifact; I could not open that file with the tools available, so `N` is not reported here.

## Findings (not failures)

1. **LibreChat treats an MCP Apps tool as an ordinary tool for approval.** `packages/api/src/mcp/apps.ts` lines 31 and 63-76 read `_meta.ui.resourceUri`; `api/server/services/MCP.js` line 1502 binds approval to every MCP tool. APPR-008 confirms the model path pauses (run 44917683534).
2. **App-initiated calls skip approval (source only, not run).** `packages/api/src/mcp/MCPManager.ts` `appToolCall` (line 2719 onward) sends `tools/call` directly, with no approval check. Reaching it needs the browser iframe. Not tested here.
3. **No per-tool retry cap in LibreChat v0.8.9.** No retry in the MCP call path (`api/server/services/MCP.js`, `packages/api/src/mcp/MCPManager.ts`). The only step cap is `DEFAULT_RECURSION_LIMIT = 50` (`packages/api/src/agents/config.ts` line 9), which bounds steps, not calls to one tool. The plan's N=3 is a SHOULD-level finding: LibreChat ran the failing calls without a cap. The case asserts only no escalation to the mail tool.
4. **`notifications/cancelled` from LibreChat is unconfirmed in logs.** The lab records `cancelled_notification` when one arrives (smoke-tested with the MCP SDK client locally). Whether LibreChat sent one in CI is in the evidence note, which I could not read. If it did not, that is a SHOULD finding, not a failure.
5. **The mail tool and the slow tool are the only write tools, and both are in approval default mode**, so no write could run without a recorded decision.

## Decisions (builder)

- **D1. APPR-008 runs, not a namedSkip.** The source shows no app exemption (finding 1). Options were a namedSkip with a docs pointer or a real test. Chose the real test because the model path is testable headlessly.
- **D2. One chat for both approval controls.** Two pauses in one run (reject, then approve), so the fixture set matches the ledger (an orphan fixture fails the registry test).
- **D3. REL-003 is a real Stop.** `POST /api/agents/chat/abort` while the call runs (the chat's Stop path), not a protocol cancel sent by the test.
- **D4. Two CI jobs, not one.** Each lab mode must be set before LibreChat starts; a mode switch does not refresh the tool list. Two stacks in one 30-minute job would not fit.
- **D5. REL-004 asserts no escalation.** Per the rule for SHOULD-level findings. The cap is recorded as a finding, not a verdict. If the owner classes the cap as MUST, the count check becomes `expectedDefect()` (`tests/l3/support/expected-defect.ts`); the brief's path `src/kit/ci/known-defect.ts` does not exist in this repo.
- **D6. Ledger label.** The ledger says wave C / PR 6 for these IDs; the branch and brief call this wave B PR 2. The ledger was not edited.

## Verification

- `npm run check` passes locally: 577 tests, 0 failing (stack tests skip without Docker).
- `npm run test:lab:conformance` passes after removing the stale `resources-list` baseline entry.
- Local lab smoke test with the MCP SDK: an aborted slow call gave `cancelled_notification` then `call_aborted`, no sink write; the app tool's `_meta` survived `tools/list`.

## Not verified

- The per-check text and the `N` count in the evidence artifact (not readable with the available tools).
- Whether LibreChat sends `notifications/cancelled` on Stop (only the lab's side is confirmed, by the local smoke test).
- The `text/html;profile=mcp-app` MIME value (taken from the MCP Apps spec; the LibreChat constant was not read).
- The LibreChat image digest matching the upstream `v0.8.9` tag source.
- The harness CHANGELOG: the installed package has none.
- The full pr run: the `l4 openclaw stub (gate)` job was still in progress when read.
