# L3 wave B, PR 5: Penpot with the browser-held plugin (P4_PENPOT_PLUGIN=1)

Branch `feat/2026-11-21-l3-penpot-plugin`. Plan: `docs/plans/2026-11-21-l3-penpot-plugin.md`. Harness pin `qa-portfolio-harness` v0.6.11 (lockfile commit `f59a7f7`). Stub model only. Penpot 2.19.2, LibreChat v0.8.9.

## Runs

| Run | Head | Result | Notes |
|---|---|---|---|
| `44934396785` | `4385cfc` | `l3 penpot plugin` failed (precheck); `l3 penpot flow` was in progress when the next push superseded it (run conclusion `cancelled`) | The first precheck run. Cases failed at their first check and made no chat. |
| `44935621069` | `8ebc6a4` | **success** on all three penpot jobs (`l3 penpot`, `l3 penpot plugin`, `l3 penpot flow`) | The named-skip run. This is the run the table below rests on. |

## What the precheck found

Run `44934396785`, job `l3 penpot plugin`, verbatim from the job log:

    not ok 1 - penpot plugin precheck: a LibreChat call reaches the owner's plugin (not a ledger case)
    error: precheck: reached the gate true, owner's plugin answered false, replies recorded 1

So a tool call made through LibreChat did reach the approval gate (the pause named `execute_code_mcp_penpot`), and LibreChat recorded one reply. The owner's plugin did not answer for `h6-owner-file`.

The likely cause is the one the plan flagged: the harness's LibreChat entry for Penpot is `http://penpot-mcp:4401/mcp` with no per-user token (harness `src/adapters/librechat-env.ts`). In multi-user mode the MCP names the user with `?userToken=`, and the token is written only to the plugin state file. The job log shows that entry (`"url": "http://penpot-mcp:4401/mcp"`, no headers), so the gap is in the harness wiring.

The precheck does not print the reply text. It records only the reply's type, so the exact reply is not in CI output. This is a limit of the evidence.

## One fix attempt, and why it stopped there

- The suite cannot add the token to LibreChat's entry. The harness writes `librechat.yaml`, and the suite does not own it.
- Setup and state reads already use the owner's token from the plugin state file (`penpot-plugin-owner.json`), through the suite's own MCP client. Those reads are proven by the plan's PPB check, but that check never runs in CI because it is behind the precheck (see the note under the table).

Decision: the four cases become `namedSkip` with this file as the docs pointer (plan section 2, item 4), and the precheck becomes an expected defect (plan D13). The precheck passes while the gap reproduces and fails once it closes, which tells the reader to remove the annotation and unskip.

## Per-case table (run `44935621069`, head `8ebc6a4`)

| Case | Job | Verdict | What the verdict rests on |
|---|---|---|---|
| `P4-MCP-TOOL-005` | `l3 penpot plugin` | **skipped (named skip)** | No chat and no oracle ran. Blocked by the LibreChat token gap above. |
| `P4-MCP-INJ-007` | `l3 penpot plugin` | **skipped (named skip)** | Same blocker. |
| `P4-MCP-INJ-008` | `l3 penpot plugin` | **skipped (named skip)** | Same blocker. |
| `P4-MCP-FLOW-006` | `l3 penpot flow` | **skipped (named skip)** | Same blocker. The flow job's own precheck and hygiene checks passed. |
| precheck (not a ledger case) | both penpot plugin jobs | expected defect, **still reproduces** | The approval gate saw `execute_code_mcp_penpot` (`reached the gate true`); the owner's plugin did not answer for `h6-owner-file` (`owner's plugin answered false`). |
| hygiene sweep and leak check | both penpot plugin jobs | pass | `registerHygieneTests` in each entry. |

Job totals (from the logs): `l3 penpot plugin` `pass 3, fail 0, skipped 3` (6 tests); `l3 penpot flow` `pass 3, fail 0, skipped 1` (4 tests).

**Note on the ledger verdicts.** None of the four cases has a verdict from an oracle. The plan's PPB check (`ppbProof`, which reads the owner's plugin through the owner's token) runs inside each case, after the precheck gate. So the PPB proof did not run in either CI run. Whether the owner's plugin answers through the suite's own client is still unverified. That is the next thing to check when the harness gap is fixed.

## Deviations from the plan

- **Plan section 2 (decision P2 and D10):** the four core cases are named skips, not passing cases. The plan allows this only after one real fix attempt, and this file records that attempt. The skip carries the docs pointer.
- **Tool names:** the plan's roles `export` and `execute_code` map to the real snapshot names `export_shape` and `execute_code`. Checked by `tests/l3/penpot/fixture-shapes.test.ts` against `tests/l3/snapshots/penpot.tools.json`.
- **Seed (decision P5):** INJ-008's "comment carrying an instruction" is a shape name, because the plugin API cannot create comments.
- **Budget constant:** the plan's `MCP_CALL_MS` was not added. The MCP client's own 60 s timeout (`tests/l3/support/mcp-client.ts`) bounds each call. No constant was measured, so none is cited.
- **File oracle (decision P7):** `PenpotOracle.fileRevisions()` reads `file.revn` and `file.modified_at`. These columns have not been read from a live Penpot 2.19.2 database yet. The first CI run that reaches the oracle will show whether they exist.

## Unverified

- Whether LibreChat's Penpot entry can carry the owner's token. It needs a harness change, not a suite change.
- Whether the owner's plugin answers through the suite's own MCP client with the token from `penpot-plugin-owner.json`. The PPB proof has not run in CI.
- Whether `file.revn` and `file.modified_at` exist in Penpot 2.19.2.
- Whether `penpot.createRectangle`, `penpot.currentPage.findShapes` and `penpot.currentFile.name` behave as assumed in the plugin API. They are used only in the seeds and cases that did not run.
- The 30-minute job budget. The test-suite durations in the logs were 221.9 s (plugin) and 264.7 s (flow), but the job wall-clock times were not measured, and the cases themselves never ran.

## Request to the harness owner

LibreChat's Penpot MCP entry must carry the owner's `userToken` when `P4_PENPOT_PLUGIN=1` (the token is already in the plugin state file). With that, the four cases can be unskipped by removing the `namedSkip` options in `tests/l3/penpot/{tool,inj,flow}.cases.ts` and removing `expectedDefect` from `tests/l3/penpot/probe.cases.ts`.
