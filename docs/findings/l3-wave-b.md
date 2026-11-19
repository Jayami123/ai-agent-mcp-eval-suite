# L3 wave B findings (approval gates on Nextcloud)

Branch `feat/2026-11-19-l3-wave-b`. Plan: `docs/plans/2026-11-18-l3.md` section 12, PR 3 to PR 5. Mechanics: `docs/findings/l3-librechat-approval.md`.
Harness pinned to `v0.6.5` (first commit, `a4d48b4`).

## Built and verified on a local stack (stub model)

| Case | Server | Mode | Result | Basis |
|---|---|---|---|---|
| P4-MCP-APPR-001 | Nextcloud | G | pass | Deny and allow on the same write tool: no approval prompt, the turn finished, the owner's files unchanged. Fixture delivered (checked). |
| P4-MCP-APPR-006 | Nextcloud | G | pass | Conversation 1: the prompt was approved and the write changed the files. Conversation 2: a new prompt appeared, and with a reject the files were unchanged. |

Local `npm run check`: see the PR body for the final numbers.

## Not built in this wave (named blockers)

| Case(s) | Blocker |
|---|---|
| P4-MCP-INJ-005, INJ-006, TOOL-006, TOOL-009 (Twenty) | Need the TW1 seed (poisoned note, workspace B records). The Twenty source is only in CI, and the seed's endpoint shapes are not captured. Next PR, from a CI capture. |
| P4-MCP-FLOW-001, FLOW-007, FLOW-010, INJ-009, INJ-013, OAUTH-015 (Mattermost, Nextcloud contacts) | Need the MM0 seed and the Mattermost oracle; FLOW-007 also needs NC0 contacts. Not in this batch. |
| P4-MCP-INJ-004, INJ-011, INJ-017, FLOW-004 (Outline) | Need the Outline oracle and the OL0 seed. Not in this batch. |
| P4-MCP-APPR-007, APPR-008, META-001 to META-011, SUPP-003, SUPP-004, SUPP-007, PROT-005, PROT-006, REL-001 and others with LAB (31 IDs) | The harness v0.6.5 has the lab entry (H5), but this repo has no lab sink or control oracle wired into `startStack`, and the lab bring-up is not in the stack. Next PR. |
| P4-MCP-APPR-003, APPR-002 (and FLOW-002/003/009/011 later) | Need the Nextcloud mail catcher (H1). |
| P4-MCP-APPR-004, APPR-005 | Need Playwright and the browser tab (H6/H9). |
| P4-MCP-APPR-009 | Needs OAuth mode (H4). |
| P4-MCP-SUPP-006 | Needs a server added on disk with no consent artefact; not built. |
| P4-MCP-OAUTH-015 | Mattermost, see above. |

## Notes

- The two built cases are in the registry's PR 5 group (APPR-001 and APPR-006 both have `pr: 5`). They are listed in the unit
  tests' `BUILT_IDS`, not in `LANDED_PRS`, so the rest of PR 5 is not counted as landed.
- The L1 helper that waits for `final` hangs on any approval pause (see S1). The L3 helper handles it.
