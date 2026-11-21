# Plan: L3 second identity cases (`feat/2026-11-21-l3-second-user`)

Read this first if you are new to the L3 second-identity lane. The master plan is `docs/plans/2026-11-18-l3.md` (case specs in
its section 11; the lab-only and USR2 PR table in section 13). The IDs and their `kind`, `needs` and `pr` fields are in
`tests/l3/support/l3-cases.json`. Case IDs come from that file only. Nothing here invents an ID.

This plan is the first commit of the branch, as the owner allowed (the separate plan-PR stop in `CLAUDE.md` is waived). Review it
with the code. Branch base: `origin/main` at `935881d` (PR #27 merged).

## 1. What this PR does

Six cases need USR2, a second identity (harness H2, `P4_SECOND_IDENTITY=1`). They fall into three outcomes:

| Case | Kind | Home | Outcome in this PR | Why |
|---|---|---|---|---|
| P4-MCP-INJ-012 | core | Nextcloud | **build** (deviation D2) | The harness makes Nextcloud user `qa-user-b` with its own MCP credential. The pinned tool list has no semantic search, so the case uses the WebDAV name search. |
| P4-MCP-REL-002 | core | host (lab) | **build** (decision D3) | Lab tasks: two MCP sessions, the SDK's session-scoped task store. A lab change is needed. |
| P4-MCP-FLOW-005 | core | Twenty | **namedSkip** (decision D1) | Needs workspace B. The harness runs Twenty single-workspace, so B cannot be entered. Same blocker as TOOL-006. |
| P4-MCP-INJ-016 | stretch | host (lab) | **blocker** (decision D4) | Needs a lab state shared across sessions, which the lab does not have. A product feature, not a case fix. |
| P4-MCP-FLOW-012 | stretch | Twenty | **blocker** (decision D1) | Needs user B's Twenty workspace. Same as FLOW-005. |
| P4-MCP-REL-010 | stretch | Twenty | **blocker** (decision D1) | Twenty MCP keys are workspace-scoped; both members share workspace A, so per-user store isolation cannot be observed. |

A namedSkip cites a docs file (the rule in `tests/l3/support/case.ts`). A blocker is a stretch-only registered skip. Nothing is
skipped silently.

## 2. The second identity, as the harness gives it

Read from the pinned harness (`qa-portfolio-harness` v0.6.11, `dist/adapters/`):

- `p4-second-identity.js`: `P4_SECOND_IDENTITY=1` (exact value) turns H2 on. The second identity's run state is
  `<product>-b-run.json`; `secondIdentityProduct(product)` gives `<product>-b`.
- **Nextcloud** (`nextcloud.adapter.js` lines 156-194): a plain user `qa-user-b` is created over OCS, and its app password becomes
  the MCP Basic credential. The owner and user B are distinct users, so the Nextcloud MCP acts as each user.
- **Twenty** (`twenty.adapter.js` lines 240-250, comment near 240): API keys belong to the workspace, not a user. The second key is
  minted by the workspace admin and labelled with the second member's identity. Both keys act in workspace A.
- **Mattermost, Outline, Penpot** also write second run state. They are not used here.

## 3. Cases, fixtures, oracles

### 3.1 P4-MCP-INJ-012 (Nextcloud, core, built)

- Seed: the owner (`qa-owner`) writes `P4L3/p4l3-second-a-<run>.md` through its own MCP (control: A's own file). User B writes
  `P4L3/p4l3-second-b-<run>.md` with a canary body, through B's MCP credential. Names come from the run (`<run>` is a random
  token per run), so nothing is hard-coded.
- Fixture `p4-mcp-inj-012-search`: the stub model makes two `nc_webdav_search_files` calls as the owner. The first searches for
  the owner's own file (control). The second searches for user B's file name (the leak attempt). Both patterns come in as
  `[var:]` markers, so the fixture holds no ids.
- Oracles: (a) the control result contains the owner's file (the search path works); (b) the leak result does not contain
  `p4l3-second-b-<run>` or the B canary; (c) user B's listing of `P4L3/` is unchanged by the run.
- If the leak result does contain B's file, the case calls `expectedDefect()` with the product summary. It is a confirmed product
  behaviour only after the owner accepts it, so the first run decides.

### 3.2 P4-MCP-REL-002 (lab, core, built)

- The lab's tasks support is new (section 4). Two MCP sessions are the two users: LAB_AUTH is off, and the SDK's task store is
  scoped by session id.
- Session A calls `lab_add` with `task` (task-augmented `tools/call`). Session A polls its own task (`tasks/get`, control).
  Session B polls A's task id (`tasks/get`, `tasks/result`, `tasks/cancel`).
- Oracles: (a) session A's `tasks/get` succeeds (control); (b) session B's `tasks/get`, `tasks/result` and `tasks/cancel` each
  return a JSON-RPC error and no task data; (c) A's task status and result are unchanged after B's cancel attempt.
- Fixtures `p4-mcp-rel-002-a` and `p4-mcp-rel-002-b` are the two halves. They are not LibreChat fixtures: this case drives the
  lab directly. They are kept so the registry and the fixture checks stay consistent, and their tool names are checked against
  the lab's own tool list.

### 3.3 Skipped and blocked Twenty and lab cases

- FLOW-005 (namedSkip, `docs/findings/l3-second-user.md` section "Workspace B"): the body is kept as designed. Its fixture
  `p4-mcp-flow-005-pivot` is written, with arguments copied from `tests/l3/snapshots/twenty.catalog.json`.
- FLOW-012, REL-010 (blocker, same findings section) and INJ-016 (blocker, "Lab shared state"): the bodies are kept, not run.

## 4. Lab change (`src/attack-lab`)

- A task store per runtime (`InMemoryTaskStore` from the pinned SDK). It is shared by all sessions, and the SDK scopes each lookup
  by the caller's session id. Two sessions cannot read each other's tasks.
- Every session advertises the `tasks` capability for `tools/call`. A `tools/call` with a `task` field creates a task, returns
  `{ task }` at once, and runs the tool in the background. The result is stored with `storeTaskResult`. `tasks/get`,
  `tasks/result`, `tasks/list` and `tasks/cancel` are handled by the SDK through the store.
- The benign tool list and pin are unchanged. Plain calls without `task` behave as before.
- Unit tests in `tests/l2/l3-second-user.test.ts`: task creation, background completion, the session scoping of the store.

## 5. Decisions (the builder's, for the reviewer to confirm or redirect)

- **D1. Twenty cases are not built.** Twenty's MCP keys are workspace-scoped (section 2). FLOW-005 needs workspace B, which the
  harness does not enable (`IS_MULTIWORKSPACE_ENABLED=false`; the earlier evidence is in `docs/findings/l3-appr-wave-b.md`,
  "Why workspace B cannot be entered"). FLOW-012 and REL-010 need the same. Only the harness can change this. Options were a
  harness change (not ours), skipping with a docs pointer, or building against shared-workspace isolation (which would test
  nothing about users). Chose: namedSkip for the core case, blocker for the stretch cases.
- **D2. INJ-012 uses the WebDAV name search, not "semantic search".** The pinned Nextcloud snapshot (`tests/l3/snapshots/
  nextcloud.tools.json`, 110 tools) has no semantic or vector search. The closest real search tool is `nc_webdav_search_files`.
  The case keeps the leak question (can user A's search see user B's file?). Options: a namedSkip (the tool does not exist) or
  build the closest variant. Chose the variant, flagged here. The owner can redirect.
- **D3. REL-002 is lab-only, with sessions as users.** The lab has no user accounts without LAB_AUTH, and the ownership rule under
  test is the task store's session scoping. Options: build LAB_AUTH tokens per user, or use sessions. Chose sessions: the SDK
  enforces the scoping, and the case checks that the lab uses it. The spec's "second user" becomes "second session" in the
  evidence.
- **D4. INJ-016 is a stretch blocker.** The spec wants a message planted in one session and seen by another. The lab's sink and
  log are per lab, not per session, so there is nothing for a second session to see unless the product gains a shared view.
  The blocker text says so.
- **D5. Fixtures for skipped cases are written** because the registry test requires every landed case's fixtures to exist and
  parse. Their arguments are copied from the pinned catalogs, not guessed.
- **D6. The rel-host nit.** The bare `5_000` in `LATE_WRITE_WINDOW_MS` becomes a named margin constant with its basis in a comment.

## 6. CI

Two jobs in `.github/workflows/pr.yml`, each `timeout-minutes: 30`, following the wave-B pattern (stub container, one stack or
lab, one entry file, evidence upload):

| Job | Start | npm script | Cases |
|---|---|---|---|
| `l3 second-user nextcloud` | stub, Nextcloud stack with `P4_L3_SERVERS=nextcloud` and `P4_SECOND_IDENTITY=1` | `test:stack:l3:second-user:nextcloud` | INJ-012 |
| `l3 second-user host` | stub, standard lab (`npm run lab:up`) | `test:stack:l3:second-user:host` | REL-002, plus the namedSkip and blocker registrations |

Both run the hygiene sweep and leak check (`registerHygieneTests`). Stub mode only. No provider keys. No secrets in the repo.

## 7. Not touched

`tests/l3/support/case.ts`, `tests/l3/mattermost/*` and the nightly workflow, as the owner asked (a parallel PR changes them).

## 8. Done means

- INJ-012 and REL-002 pass in CI, or the findings file records the failing check and its output.
- FLOW-005 is a documented namedSkip; FLOW-012, REL-010 and INJ-016 are documented blockers.
- `npm run check` passes locally.
- `docs/findings/l3-second-user.md` has the run id, the head SHA and a per-case table of real verdicts from the job logs.
