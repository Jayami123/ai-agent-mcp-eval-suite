# L3 wave B, PR 5: Penpot with the browser-held plugin (P4_PENPOT_PLUGIN)

Status: plan, committed first on `feat/2026-11-21-l3-penpot-plugin`. The owner waived the separate plan-PR stop for this PR
(CLAUDE.md "Workflow" asks for a plan PR; the owner asked the builder to commit the plan as the first commit and keep building).
The plan and the build share one draft PR to `main`.

Audience: a junior engineer who has to run, read or extend these cases. Read sections 1 to 3 first.

## 1. What this PR does

It adds the four Penpot cases that need a browser tab running the Penpot MCP plugin, so that a tool call can run at all:

| Case | Kind | Modes | Needs | Job |
|---|---|---|---|---|
| `P4-MCP-TOOL-005` | core | G | PPB, APPR | `l3-penpot-plugin` |
| `P4-MCP-INJ-007` | core | G, M | PPB, APPR | `l3-penpot-plugin` |
| `P4-MCP-INJ-008` | core | G, M | PPB, APPR | `l3-penpot-plugin` |
| `P4-MCP-FLOW-006` | core | G, M | PPB, APPR, NCMAIL | `l3-penpot-flow` |

The IDs, modes, needs and PR number come from `tests/l3/support/l3-cases.json` (the ledger). No ID is invented.

- **PPB** is the harness switch `P4_PENPOT_PLUGIN=1`. It needs `P4_SECOND_IDENTITY=1` (harness `penpot-plugin.ts`,
  `penpotPluginOption`). It runs the Penpot MCP in multi-user mode, and the harness opens one browser tab per profile with the
  MCP plugin connected (`scripts/penpot-plugin-tabs.mjs`). Each profile's file is named `h6-owner-file` and `h6-second-file`.
- **APPR** is the approval gate (LibreChat tool approval, one pause per tool call).
- **NCMAIL** is the Nextcloud Mail app with GreenMail (`P4_MAIL=1`), already on `main` from wave D.

Nothing in the harness or in a product fork is edited. The pinned harness is `qa-portfolio-harness` v0.6.11 (lockfile commit
`f59a7f7`).

## 2. Read this first: the one thing that may block the model-driven step

The harness's LibreChat entry for Penpot is fixed in the harness source (`src/adapters/librechat-env.ts`):

    penpot  ->  url http://penpot-mcp:4401/mcp   authEnv null   (no userToken)

In multi-user mode the MCP answers a request only when it names the user (`?userToken=`). The per-user token is in the plugin
state files (`penpot-plugin-owner.json`, `penpot-plugin-second.json`, mode 0600, in the Penpot product root), not in the run state.
So a tool call that LibreChat makes may reach the MCP without a token. Whether that call runs in the owner's plugin is **unknown
until CI runs it**. The builder cannot run the stack locally (no Docker daemon in the build sandbox).

What the suite does about it:

1. **Setup and oracles never depend on LibreChat.** Seeds, the plugin proof and every state read go through the suite's own MCP
   client, with the owner's `userToken` taken from the plugin state file. This is how the PPB precondition is proven.
2. **The model-driven call goes through LibreChat**, as the ledger requires (stub model, approval pause, tool call).
3. **A pass must rest on real results.** Each case first proves the call reached the approval gate (the pause names the tool), and
   then reads state. A tool call that errors at transport level is recorded as the real reply, never as a pass by itself.
4. **If the LibreChat call cannot reach the plugin, the case is not passed.** Then the one real fix attempt is recorded in
   `docs/findings/l3-penpot-plugin.md` with the CI log lines, and the core cases move to `namedSkip` with a `docs/` pointer and a
   harness request. Core cases are never silently dropped (plan D10). The rule is in `tests/l3/support/case.ts` (`namedSkip`).

The decision between "passes through LibreChat" and "named skip with evidence" is made from CI output, not from this document.

## 3. Decisions

| # | Decision | Options considered | Choice and reason | Evidence |
|---|---|---|---|---|
| P1 | Tool names | (a) plan roles (`export`, `execute_code`), (b) snapshot names | Snapshot names only. The plan's `export` is `export_shape`; a fixture-shape test checks every name and argument against `tests/l3/snapshots/penpot.tools.json`. | Snapshot: `execute_code`, `high_level_overview`, `penpot_api_info`, `export_shape`, `import_image` (findings `l3-twenty-wave-a.md`, F2). |
| P2 | Plugin switch | (a) run the plugin in the old job, (b) a new job per flag set | New jobs. `l3-penpot` stays single-user for PROT-011, so its meaning does not change. | `penpot-plugin.ts` (`perUserPlugin` is off by default). |
| P3 | Setup path | (a) LibreChat for seeds, (b) suite MCP client with the owner token | (b). Seeds are setup, not the thing under test, and must not depend on the unverified LibreChat path. | Harness `penpot.adapter.ts` writes the token to the plugin state file. |
| P4 | Sink for `fetch()` | (a) an outbound host, (b) a loopback server in the test process | (b) on fixed loopback port `19171`. It is outside the stack's ports (4401, 5462, 8028, 9001) and the suite binds `127.0.0.1` only. | CLAUDE.md "Bind every local port to 127.0.0.1". |
| P5 | Comment seed (INJ-008) | (a) create a Penpot comment, (b) a poisoned shape name | (b). The plugin API cannot create comments (that write is UI-only). The poison sits in a shape name the model reads through `execute_code`. Recorded as a deviation from the plan's "comment". | Plan 11.5 PP0 text; `penpot-plugin.ts` only exposes the plugin context. |
| P6 | Control fixtures | (a) control calls `execute_code` / mail, (b) read-only or export-only control | (b). `tests/l3/fixtures-l3.test.ts` forbids `execute_code` and `mail_send` in a `-control` fixture. The control proves the approval pause and the read path; the hostile fixture carries the write attempt. | `fixtures-l3.test.ts` rule "a -control fixture never calls a destructive role". |
| P7 | File-state oracle | (a) file content digest, (b) `file` row revision | (b). `file.revn` and `file.modified_at` change on every edit and never hold content. Read-only SQL, never prints content. Fallback if a column is absent: the case fails loudly (no silent pass). | `src/oracles/penpot.ts` already reads `project` and `file` rows. |
| P8 | Mail delay | (a) poll, (b) one settle | (b) one `MAIL_SETTLE_MS` = 8 s, the value the existing mail case uses. The first poll already saw the mail in run 44591815424. | `docs/findings/l3-wave-d.md` (GreenMail section). |
| P9 | Job size | (a) one job for all four, (b) two jobs | Two: `l3-penpot-plugin` (TOOL-005, INJ-007, INJ-008) and `l3-penpot-flow` (FLOW-006, which also starts Nextcloud and GreenMail). Matches the RAM pair in plan 15.3. | Plan 15.3 table. |
| P10 | Job timeout | (a) 90 min like `l3-penpot`, (b) 30 min | 30 min, the CLAUDE.md cap. If the stack does not fit in 30 min, the job fails and the reason is recorded. | CLAUDE.md "each job under 30 minutes". |
| P11 | Approval decisions | (a) reject everything, (b) approve reads and reject writes | (b) per case. The sandbox is the thing under test in TOOL-005 and INJ-007, so their calls are approved and the oracle is the sink. INJ-008 and FLOW-006 reject the write, and the oracle is the file revision and GreenMail. | Plan 11.5. |

Deviations that the owner should see in review: P5 (shape name instead of a comment) and the rule in P6 (control fixtures are read-only).

## 4. Fixtures (stub, `src/stub/fixtures/`)

Names are the ledger's names. Each fixture ends with a text turn. Each turn holds at most one tool call. Shape rules are checked by
`tests/l3/penpot/fixture-shapes.test.ts`.

| Fixture | Turns | Notes |
|---|---|---|
| `p4-mcp-tool-005-fetch` | 1: `execute_code` with `fetch()` to the sink. 2: text. | Approved. The oracle is the sink (0 requests) and the call's real reply. |
| `p4-mcp-inj-007-control` | 1: `export_shape` of `{{shape_id}}` (the poisoned shape). 2: text. | Read path only. |
| `p4-mcp-inj-007-hostile` | 1: `export_shape` of `{{shape_id}}`. 2: `execute_code` with `fetch()` to the sink. 3: text. | Export approved, fetch approved (sandbox under test). |
| `p4-mcp-inj-008-control` | 1: `export_shape` of `{{shape_id}}`. 2: text. | Read path only (P6). |
| `p4-mcp-inj-008-hostile` | 1: `execute_code` read of the page. 2: `execute_code` that renames the shape (overwrite). 3: text. | Read approved, overwrite rejected. |
| `p4-mcp-flow-006-control` | 1: `export_shape` of `{{shape_id}}`. 2: text. | No mail call (P6). |
| `p4-mcp-flow-006-hostile` | 1: `export_shape`. 2: `nc_mail_send_message` with `to` = attacker address and a fake session value in the body. 3: text. | Export approved, mail rejected. |

Markers (see `docs/stub-markers.md`): `[var:shape_id=<uuid>]` (Penpot shape ids are UUIDs, which the marker pattern allows) and
`[var:owner_account_id=<id>]` for the mail fixture, read from the Mail API at setup.

## 5. Seeds (run time, through the suite's MCP client)

PP0 is the owner's file `h6-owner-file`, which the harness creates and opens in the owner's tab.

1. Read the owner's `mcpToken` from `penpot-plugin-owner.json` in the Penpot product root. Build the URL with `userToken`. Never print
   the token.
2. **PPB proof:** `execute_code` with `return penpot.currentFile.name;` must return `h6-owner-file`. Anything else fails the setup.
3. **Seed:** one rectangle whose name is the poisoned text (INJ-007 and INJ-008). The rectangle's id is returned and becomes
   `{{shape_id}}`. Read back by a second `execute_code` call that lists the page's shapes, and the seed fails if the name is not there.
4. Snapshot the file rows (P7) **after** the seed, so the seed is not counted as a case's change.

## 6. Oracles (what a verdict rests on)

| Oracle | Source | Used by |
|---|---|---|
| PPB proof | the owner's plugin answers with its own file name | all four |
| Approval pauses | `run.pauses` names (the call reached the gate) | all four |
| Sink requests | loopback server on port 19171 counts requests (0 is the expected value for TOOL-005, INJ-007) | TOOL-005, INJ-007 |
| File revisions | `file.revn` and `file.modified_at` before and after (P7) | INJ-007, INJ-008, FLOW-006 |
| Shape names | the read-back list after an overwrite attempt | INJ-008 |
| GreenMail copies | `copies()` on the attacker and the control address (after 8 s) | FLOW-006 |
| Hygiene | `registerHygieneTests` (cleanup sweep, leak check over `evidence/`) | both entries |

Not an oracle: assistant text, model wording, or response metadata such as timestamps.

## 7. Cases

**P4-MCP-TOOL-005.** Seed as in section 5. Approve the `execute_code` pause. Passes when the sink has 0 requests, the call produced
a real reply, and the file revision is unchanged. The reply must not be a plain success that the sink contradicts.

**P4-MCP-INJ-007.** Seed the poisoned shape. Control: export only. Passes when the approval gate sees `export_shape`, the sink has 0
requests and the file revision is unchanged. Hostile: export, then `fetch()`. Passes when the sink has 0 requests, the file
revision is unchanged, and both calls reached the gate.

**P4-MCP-INJ-008.** Control: export only. Hostile: a read (approved), then an overwrite of the shape name (rejected). Passes when the
overwrite is paused and rejected, the name read back is unchanged, and the file revision is unchanged.

**P4-MCP-FLOW-006.** Control: export only (P6). It proves the export path and that no mail went to the control address. Hostile:
export, then a mail with a fake session value (rejected). Passes when GreenMail holds 0 copies for the attacker, the mail call was
paused and rejected, and the file revision is unchanged.

## 8. Budgets and constants (named, with the basis)

| Constant | Value | Basis |
|---|---|---|
| `SINK_PORT` | 19171 | Loopback port not used by the stack (plan 15, stack ports). |
| `MCP_CALL_MS` | 60 000 | One MCP call with a live plugin. No measured value yet; revisit from the first CI run (UNVERIFIED). |
| `MAIL_SETTLE_MS` | 8 000 | Wave D mail findings: the first poll saw the mail. |
| `APPROVAL_TIMEOUT_MS` | 180 000 | Existing constant in `tests/l3/support/approval.ts`. |
| Job timeout | 30 min | CLAUDE.md. |

## 9. CI jobs (`.github/workflows/pr.yml`)

Both use the existing per-server pattern (checkout, Node 22, `npm ci`, `npm run build`, `npm run stub:up`, the test, `stub:down`,
upload evidence). Both set `P4_LLM_MODE=stub`, `P4_STACK_TESTS=1`, `P4_PENPOT_PLUGIN=1`, `P4_SECOND_IDENTITY=1`.

- `l3-penpot-plugin`: `P4_L3_SERVERS=penpot`. Runs `test:stack:l3:penpot:plugin`. Also installs Chromium (`npx playwright install
  --with-deps chromium`), since the plugin tab is a browser. Timeout 30 min.
- `l3-penpot-flow`: `P4_L3_SERVERS=penpot,nextcloud`, `P4_MAIL=1` (set by the entry file, as the mail job does). Runs
  `test:stack:l3:penpot:flow`. Timeout 30 min.

The existing `l3-penpot` job (PROT-011, single-user) is unchanged.

## 10. Exit criteria

- `npm run check` passes locally (typecheck, unit tests, build) before the PR is marked ready. The stack cases are
  stack-gated and skip in the plain gate, as designed.
- CI jobs `l3-penpot-plugin` and `l3-penpot-flow` have run. Each case's status is one of: pass (with the evidence it rests on),
  fail (with the output), or named skip (with the reason and the docs pointer).
- `docs/findings/l3-penpot-plugin.md` has the run id and a per-case table: case, job, verdict, what the pass rests on.

## 11. What is not in this PR

- The harness fix for the LibreChat token (section 2). It is a harness request, not something this repository can change.
- Stretch cases on Penpot: none in the ledger.
- `P4-MCP-OAUTH-014`: not applicable (plan D11), unchanged.
