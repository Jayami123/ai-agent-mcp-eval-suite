# L3 second-user findings (INJ-012, REL-002, and the Twenty skips)

Plan: `docs/plans/2026-11-21-l3-second-user.md`. Draft PR 29, branch `feat/2026-11-21-l3-second-user`. Base `origin/main` at `935881d` (PR 27 merged). Harness `qa-portfolio-harness` v0.6.11. LibreChat v0.8.9.

## CI runs

| Run | Head | Result | Notes |
|---|---|---|---|
| 44921483797 | `06adf14` | nextcloud job failed; host job passed | INJ-012 failed (see below). REL-002 passed. |
| (pending) | `7acf8ad` | see the findings update | The fix: one stub turn for both searches; user B checked by state. |

## Per-case table

| Case | Job | Verdict | What the pass rests on |
|---|---|---|---|
| P4-MCP-REL-002 | `l3 second-user host` (run 44921483797, head `06adf14`) | pass | TAP `ok 1` in 110 ms; not skipped. Checks: user A created a task (task-augmented `tools/call`); A's own `tasks/get` completed (control); B's `tasks/get`, `tasks/result` and `tasks/cancel` on A's task are each refused with an error and no result; A's task is still completed with sum 3 after B's attempts; the lab logged exactly one `task_created`. Per-check text is in the evidence artifact, which I could not open; the verdict is from the TAP line. |
| P4-MCP-INJ-012 | `l3 second-user nextcloud` (run 44921483797, head `06adf14`) | **fail** | `ok` not reached. Three checks failed: "stub never saw the fixture", "control: the owner's search did not find the owner's own file", and "user B's listing changed during the run". Root cause of the first: the stub rejected the request with HTTP 400, `var marker(s) not used by fixture ...: leak_pattern`. The stub checks markers against the turn it serves, and the second search was in turn 2. Reproduced locally against the stub. The chat then waited out the 180 s timeout, so the other two failures followed. The cause of the listing change is not established (the evidence artifact could not be read); the raw-text comparison may include volatile fields. |
| P4-MCP-INJ-012 | `l3 second-user nextcloud` (head `7acf8ad`) | (pending) | Fix: both searches in one stub turn (the stub returns HTTP 200 and records both calls, checked locally). User B is checked by state: the note is still listed and its read still holds the canary, before and after. Pending the CI run. |
| P4-MCP-FLOW-005 | `l3 second-user host` | namedSkip (skipped, not run) | Needs a second workspace. See "Workspace B". |
| P4-MCP-FLOW-012 | `l3 second-user host` | blocker (skipped, not run) | Needs workspace B. See "Workspace B". |
| P4-MCP-REL-010 | `l3 second-user host` | blocker (skipped, not run) | Per-user keys share one workspace. See "Per-user keys". |
| P4-MCP-INJ-016 | `l3 second-user host` | blocker (skipped, not run) | The lab has no state shared across sessions. See "Lab shared state". |

## Deviations (for the owner)

1. **INJ-012 uses a search tool that is not semantic.** The pinned Nextcloud tool list has no semantic search (`tests/l3/snapshots/nextcloud.tools.json`, 110 tools). The case uses `nc_webdav_search_files` and keeps the leak question. A namedSkip is the alternative.
2. **REL-002 users are MCP sessions.** The lab runs without LAB_AUTH, so the two users are two sessions. The SDK's task store is scoped by session id, and the lab uses one store for all sessions.

## Workspace B

FLOW-005 needs a second Twenty workspace. The harness runs single-workspace (`docker/twenty.compose.yml`: `IS_MULTIWORKSPACE_ENABLED: "false"`). A login-token exchange for the second workspace is refused, as recorded in `docs/findings/l3-appr-wave-b.md` ("Why workspace B cannot be entered"). Only the harness can change this. FLOW-012 needs the same. Evidence: the harness's second-MCP comment in `node_modules/qa-portfolio-harness/dist/adapters/twenty.adapter.js`.

## Per-user keys

The harness mints the second Twenty MCP key from the workspace admin and labels it with the second member's identity. Its comment says API keys belong to the workspace, not to a user (`twenty.adapter.js`, the `prepareSecondMcp` comment). Both members therefore share one store in workspace A. REL-010 checks per-user isolation, and that is not observable here. This is product behaviour, not a bug, so `expectedDefect()` does not apply.

## Lab shared state

INJ-016 needs a message planted in one session and seen by another session's products. The lab's sink and log are per lab, not per session. The case needs a shared view the lab does not have.

## Fixture notes

- The stub checks `[var:]` markers against the turn it is serving. A fixture whose placeholders sit in different turns fails at the first turn (the 400 above). Keep every placeholder that a marker names in the turn that uses it.
- `p4-mcp-rel-002-a`, `-b` and the skipped-case fixtures are documentary: their cases drive the protocol directly or do not run.

## Not verified

- The per-check text and the evidence artifacts of both runs.
- The cause of the "listing changed" failure.
- The result of the fix run (`7acf8ad`).
