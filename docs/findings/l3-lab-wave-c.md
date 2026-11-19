# L3 wave C findings: attack-lab cases (protocol-only subset)

Branch `feat/2026-11-19-l3-wave-c`. Plan: `docs/plans/2026-11-18-l3.md` section 12 (PR 6). The attack-lab (L2) is the product;
the cases read its MCP port, its control API and its state. Modes and their expected detections: `docs/lab-modes.md` and
`src/attack-lab/README.md`.

## Built, and passing on the host lab (local run, and CI job `l3 lab`)

| Case | Mode | Result | What the verdict rests on |
|---|---|---|---|
| P4-MCP-PROT-005 | rug-pull-after-n | pass | After the trigger, `lab_mail_send` gains an optional `bcc` parameter. Both a same-session list and a new-session list show it. |
| P4-MCP-PROT-006 | benign | pass | Streamable HTTP and stdio (a child process with its ports at 0) serve the same five tools under the same server name. |
| P4-MCP-META-009 | poisoned-description | pass | The description linter flags the `<IMPORTANT>` block in `lab_echo` on the poisoned list, and stays silent on the benign list (negative control). |
| P4-MCP-SUPP-002 | version-bump-bcc | pass | The benign list matches the committed pin (`tests/l3/snapshots/lab.tools.json`). After the trigger, `serverInfo.version` moves from 1.0.0 to 1.0.1 and the drift is detected at initialize. |

No case is skipped for a blocker. No expected defect was recorded.

## Gap the pin cannot see (recorded, not a verdict)

For SUPP-002, the tool metadata is unchanged after the version bump (the lab says so: "hash pinning cannot see it"). A pin on
tool metadata alone would miss this drift. The case detects it through the version at initialize, which is why the version is
part of the pin.

## Not built in this wave (reasons)

- **The other 27 lab IDs.** Of the 31 IDs that need the lab, 23 need only the lab, or the lab plus approval (H3, which the
  harness v0.6.5 provides). Four of those 23 are built now (above). The remaining 19 need a LibreChat chat through the stub
  (G mode) with the `lab` product in `LIBRECHAT_MCP_PRODUCTS` and per-case lab tool fixtures. That is the next PR.
  The other 8 are blocked by other blockers: NCMAIL (META-003, META-013, APPR-002), USR2 (INJ-016, REL-002), PW (META-012,
  APPR-004, APPR-005).
- **LibreChat wiring (item 1, the `lab` product).** Not done in this PR. The four built cases do not use LibreChat. The
  harness v0.6.5 has `librechatMcpServerFor("lab")`, but `startStack` calls `getAdapter` for every server, and the harness has
  no lab adapter. The next PR needs a lab branch in `startStack` that starts the lab through `lab:up` before LibreChat.
- **Twenty cases (item 3).** Not done in this PR. The Twenty source is not in this sandbox, and building the TW1 seed from
  memory is not allowed. The next step is a CI capture of the Twenty endpoint shapes, or reading them from the pinned image.
- **Lab container locally.** The lab image's `npm ci` cannot reach the registry from inside the sandbox's containers (the proxy
  limit in the sandbox README). Local runs use the same server as a host process (`node dist/attack-lab/main.js`). CI builds the
  container as in the L2 job, and the `l3 lab` job checks the container bring-up.

## Operational notes

- The lab's control token is read from `.harness/lab/control-token` for each call and never printed. The file is git-ignored.
- The cases reset the lab to its start mode before and after each case, so a failure cannot leak into the next case.
- The benign pin (`tests/l3/snapshots/lab.tools.json`) was captured from the running benign lab. A change to the lab's benign
  tools needs a deliberate re-capture.
