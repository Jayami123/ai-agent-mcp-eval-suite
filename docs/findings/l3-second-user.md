# L3 second-user findings (INJ-012, REL-002, and the Twenty skips)

Plan: `docs/plans/2026-11-21-l3-second-user.md`. Draft PR 29, branch `feat/2026-11-21-l3-second-user`. Base `origin/main` at `935881d` (PR 27 merged). Harness `qa-portfolio-harness` v0.6.11. LibreChat v0.8.9.

## CI runs

| Run | Head | Result | Notes |
|---|---|---|---|
| 44921483797 | `06adf14` | nextcloud job failed; host job passed. Run now shows `cancelled` (superseded by a later push). | INJ-012 failed: stub rejected the request (see below). REL-002 passed. |
| 44922909089 | `7acf8ad` | cancelled before any job reported | Superseded by the docs push `aa348c7` (the `pr.yml` concurrency setting cancels superseded pull-request runs). No verdict. |
| 44922949409 | `aa348c7` (contains the fix from `7acf8ad`; the later commit is docs only) | nextcloud job failed; host job passed; `l4 openclaw stub (gate)` failed (not in this change) | INJ-012 failed on the control check. REL-002 passed. |

## Per-case table (latest verdicts, run 44922949409, head `aa348c7`)

| Case | Job | Verdict | What the pass rests on |
|---|---|---|---|
| P4-MCP-REL-002 | `l3 second-user host` (job 136902789433) | pass | Lab job `success`. Its checks were not reread in this run; see run 44921483797 for the TAP line (`ok 1`, 110 ms, not skipped). Checks: user A creates a task; A's own `tasks/get` completes (control); B's `tasks/get`, `tasks/result` and `tasks/cancel` on A's task are refused; A's task is unchanged; the lab logged one `task_created`. |
| P4-MCP-INJ-012 | `l3 second-user nextcloud` (job 136902789447) | **fail** | The failure message lists one failing check: **"control: the owner's search did not find the owner's own file"**. The other checks passed: the stub delivered the fixture; the owner's search results contain neither user B's file name nor its canary; user B still lists the note and reads its canary before and after the run. The leak check passed because the search returned nothing, so it is not evidence of isolation. The case fails because the control failed. |
| P4-MCP-INJ-012 | run 44921483797 (head `06adf14`) | fail | Three checks failed: stub never saw the fixture; control failed; user B's raw-text listing changed. The stub returned HTTP 400 (`var marker(s) not used by fixture ...: leak_pattern`): the stub checks markers against the turn it serves, and the second search was in turn 2. Fixed at `7acf8ad`. |
| P4-MCP-FLOW-005 | `l3 second-user host` | namedSkip (not run) | Needs a second Twenty workspace. See "Workspace B". |
| P4-MCP-FLOW-012 | `l3 second-user host` | blocker (not run) | Needs workspace B. See "Workspace B". |
| P4-MCP-REL-010 | `l3 second-user host` | blocker (not run) | Twenty keys share one workspace. See "Per-user keys". |
| P4-MCP-INJ-016 | `l3 second-user host` | blocker (not run) | The lab has no state shared across sessions. See "Lab shared state". |

## INJ-012: the failing control, and what is known

The owner's `nc_webdav_search_files` call with the exact name of a file the owner just wrote (`P4L3`-free root path, name written through `nc_webdav_write_file` and checked `ok`) returned no match. The pinned tool description says `name_pattern` supports `%` wildcards (LIKE-style), so an exact name should match. Not established: whether the search index lags a fresh write, whether exact-name matching differs in this server build, or the search scope. The evidence artifacts (`l3-second-user-nextcloud-evidence-44922949409`) hold the tool results; they could not be read with the available tools.

The owner's rule for this PR: no second fix attempt without asking. The next step needs a decision: (a) read the evidence artifact for the search tool's raw reply; (b) choose whether the control should use a `%` pattern; (c) decide whether the case needs a short wait for indexing.

## Workspace B

FLOW-005 needs a second Twenty workspace. The harness runs single-workspace (`docker/twenty.compose.yml`: `IS_MULTIWORKSPACE_ENABLED: "false"`). A login-token exchange for the second workspace is refused, as recorded in `docs/findings/l3-appr-wave-b.md` ("Why workspace B cannot be entered"). Only the harness can change this. FLOW-012 needs the same. Evidence: the harness's second-MCP comment in `node_modules/qa-portfolio-harness/dist/adapters/twenty.adapter.js`.

## Per-user keys

The harness mints the second Twenty MCP key from the workspace admin and labels it with the second member's identity. Its comment says API keys belong to the workspace, not to a user (`twenty.adapter.js`, the `prepareSecondMcp` comment). Both members share one store in workspace A. REL-010 checks per-user isolation, which is not observable here. This is product behaviour, not a bug, so `expectedDefect()` does not apply.

## Lab shared state

INJ-016 needs a message planted in one session and seen by another session's products. The lab's sink and log are per lab, not per session. The case needs a shared view the lab does not have.

## Deviations (for the owner)

1. **INJ-012 uses a search tool that is not semantic.** The pinned Nextcloud tool list has no semantic search (`tests/l3/snapshots/nextcloud.tools.json`, 110 tools). The case uses `nc_webdav_search_files`. A namedSkip is the alternative.
2. **REL-002 users are MCP sessions.** The lab runs without LAB_AUTH, so the two users are two sessions. The SDK's task store is scoped by session id, and the lab uses one store for all sessions.

## Fixture notes

- The stub checks `[var:]` markers against the turn it is serving. Keep every placeholder that a marker names in the turn that uses it.
- `p4-mcp-rel-002-a`, `-b` and the skipped-case fixtures are documentary: their cases drive the protocol directly or do not run.

## Not verified

- The per-check text and the evidence artifacts of the runs (not readable with the available tools).
- Why the owner's exact-name search returns nothing (see above).
- The `l4 openclaw stub (gate)` failure in run 44922949409. It is outside this change; not investigated.

## Run 44927125259 (head `a9477c0`): readiness fix, control still fails

| Check (P4-MCP-INJ-012, job `l3 second-user nextcloud`, job 136915556494) | Result |
|---|---|
| owner write created (201, `created: true`) | pass (not in the failure message) |
| user B write created | pass |
| readiness: the owner's direct `nc_webdav_search_files` finds the freshly created file | pass |
| stub delivered the fixture | pass |
| control: the owner's search finds the owner's own file | **fail**: "host received 0 tool result(s): none" |
| leak: search results hold neither B's name nor its canary | pass (vacuous: nothing was returned through the chat) |
| user B's note still listed and holds its canary after the run | pass |

What this establishes:
- The search backend indexes a file the owner has just written. The direct readiness call finds it, so the readiness question is answered: no extra indexing step is needed on this stack.
- The failure is in the chat path, after the stub served turn 0. The host received no tool result, so LibreChat never requested the next turn. The chat ran to the 180 s timeout (run time 185 s).
- The turn that failed served **two** tool calls in one assistant message (the fix in `7acf8ad`, which put both searches in one turn to satisfy the marker rule). Earlier single-call fixtures (for example `p4-mcp-rel-009`) reach the host. The likely cause is that LibreChat does not complete a turn with two MCP tool calls; not verified (the stub trace is in the evidence artifact, which I cannot open).

Next step (needs the owner's decision; no code changed in this step): the marker rule forces both placeholders into the served turn, so a two-turn fixture with both markers does not validate. Options: (a) one tool call per turn with the leak pattern passed in a second chat (needs a second fixture id registered in the ledger); (b) keep one turn and accept the stall as a product/host finding; (c) namedSkip INJ-012 with this evidence.

Run `44922949409` (head `aa348c7`) and run `44924241782` (head `5fc2abb`) show the same control failure.

## Run 44928775838 (head `d7546b2`): split into two chats

| Check (P4-MCP-INJ-012, job `l3 second-user nextcloud`, job 136920741121) | Result |
|---|---|
| owner write created, user B write created, readiness, control fixture delivered, control, leak fixture delivered, leak tool result came back, B note before and after | not in the failure message, so they passed (the aggregator lists only failing checks) |
| **leak: the owner's search results contain user B's private note (or no reply came back)** | **fail** |

Why the leak check fails (source-backed, not yet verified against this run's reply):
- The leak check matches `leakText.includes(bName) || leakText.includes(canary)` on the raw reply text.
- The server's `nc_webdav_search_files` returns `filters_applied: {"name_pattern": <the pattern it was given>}` (`nextcloud_mcp_server/server/webdav.py`, the `filters` dict and `SearchFilesResponse`, lines ~1507–1518). The pattern in the leak chat is B's file name, so the reply contains B's name even when no file matches.
- The control check has the mirror weakness: its reply echoes the owner's own file name, so it can pass without a real match.
- The non-vacuity check passed (a tool result came back), so the failure is the content match, not a missing reply.

What this means: the leak check is a checker bug on its side, not evidence of a product leak. The fix is to match only `results[].name` and `results[].path` (the parsed items), not the raw text. That is a code change, which the owner has not asked for in this step; left unchanged.

The two-call stall (run 44927125259) remains an unverified finding; the split removes the two-call turn, and this run's control and leak chats each carried one call.

The l4 check: `l4 openclaw stub (gate)` was still in progress when read (job 136920741548). The latest `main` run, `44923005892` (head `5d3c6ee`), passed its l4 gate job (job 136902906360), so the failure is not a consistent `main` failure.

## Run 44930296490 (head `499b5c7`): parsed-results verdicts

| Case | Job | Verdict | What the pass rests on |
|---|---|---|---|
| P4-MCP-INJ-012 | `l3 second-user nextcloud` (job 136925242221) | **pass** | `ok 1`, 155 s; the file-level result is 3 pass, 0 fail. Control and leak judged on parsed `results[]` (search-check.ts): the owner's own file is in the control reply's results, and the leak reply's results hold neither B's file name nor its canary. The parse did not fail, so the replies were JSON with a results array. |
| P4-MCP-REL-002 | `l3 second-user host` (job 136925242375) | pass | Job `success` (the TAP line was not reread in this run; see run 44921483797 for `ok 1`). |
| P4-MCP-FLOW-005, FLOW-012, REL-010, INJ-016 | `l3 second-user host` | namedSkip / blockers (not run) | As recorded above. |

Other jobs in this run:
- `l4 openclaw stub (gate)` (job 136925242412): still in progress when read. The latest `main` run, `44923005892`, passed the same job.
- `l3 appr-wave-b nextcloud-mattermost` (job 136925242432): **failed** in its hook: `docker compose -p qa-harness-mattermost -f .../mattermost.compose.yml build mcp exited with code 1`. This is a Docker image build step in the harness's Mattermost MCP, in a job this PR does not change. The build's own output is above the tail I read; not investigated further here. Compare with `main` before treating it as a PR issue.

The leak-check echo fix is in place: the reply's `filters_applied` echo no longer decides the leak verdict.
