# Plan: L3 Outline wave

Date: 2026-11-20. Branch: `feat/2026-11-20-l3-outline-wave`. Base: `main` at `cf02bcc`.

Reviewer pre-approval: the owner has approved building straight through after this plan PR (no stop for review before the build).

## 1. Source of IDs

The case ledger named in CLAUDE.md (`p4-case-ledger.csv`) is not in this repository. The IDs and their rows are taken from:

- `docs/plans/2026-11-18-l3.md` section 11.2 (Outline, 9 IDs: 8 core, 1 stretch), and
- `tests/l3/support/l3-cases.json`, which carries the same nine rows (`home: outline`).

No ID is invented or renumbered. The gap is recorded here as a finding; the ledger file should be added to the repo or the reference corrected.

## 2. What is built now

Harness pin: `qa-portfolio-harness` moves from `v0.6.7` to `v0.6.10` (tag object `9bb4d36`, peeled commit `84d2d35`). The v0.6.8 to v0.6.10 entries add Nextcloud mail route waits, the MCP recording proxy (H9, off by default) and Twenty-only OAuth (H4). Outline is not OAuth-capable in this harness (CHANGELOG 0.6.10), so the OAUTH-family cases here run in mode G without OAuth.

| ID | Kind | Built now | Needs (plan tags) | Harness support | Reason if not built |
|---|---|---|---|---|---|
| P4-MCP-OAUTH-012 | core | **yes** | USR2 | H2: Outline second member with its own key | - |
| P4-MCP-OAUTH-013 | core | **yes** | USR2 | H2 | - |
| P4-MCP-INJ-004 | core | **yes** | APPR | H3 (`LIBRECHAT_TOOL_APPROVAL*`) | - |
| P4-MCP-INJ-011 | core | **yes** | APPR | H3 | - |
| P4-MCP-INJ-017 | stretch | **yes** (stretch) | APPR | H3 | - |
| P4-MCP-FLOW-003 | core | no | APPR, NCMAIL | H1 (GreenMail, `P4_MAIL=1`) | Needs the Outline and Nextcloud stacks in one run, plus GreenMail. The 20-minute Outline job cannot carry a second product stack. Deferred to an outline+nextcloud pair job in the next wave. |
| P4-MCP-FLOW-004 | core | no | APPR | H3 | Needs TW1 (Twenty seed with an injected note, not in the repo) and a Twenty workflow-run oracle (not in the repo). Needs an outline+twenty pair job. Deferred. |
| P4-MCP-FLOW-008 | core | no | APPR, NCMAIL, WIRE | H1, H3, H9 (recording proxy) | Needs the Nextcloud mail oracle and a wire oracle that reads the recorder log (neither is in the repo), plus a pair job. Deferred. |
| P4-MCP-FLOW-009 | core | no | APPR, NCMAIL | H1, H3 | Three products (Outline, Twenty, Nextcloud) and TW1, which is above the RAM the single-product job uses. Deferred until a three-server job is designed. |

Deviation from the plan: none of the four deferred cases is blocked by the harness. The reasons are repo oracles, seeds and pair-job scope. The owner should confirm the split.

## 3. Mode and stack decisions

- Mode: stub only (`P4_LLM_MODE=stub`). No `GEMINI_API_KEY` anywhere.
- One stack: `P4_L3_SERVERS=outline`, with `P4_SECOND_IDENTITY=1` (H2 second member, own run state `outline-b-run.json`).
- **OAUTH-012 and OAUTH-013 call the MCP directly** with the second identity's key, not through LibreChat. LibreChat carries only the owner key (the harness has no second LibreChat login). The viewer's own credential is the only way to test what the viewer may do. This is a deviation from the plan's "stub fixture" wording: these cases use no model, which is the plan's mode G shape anyway. Stub fixtures are used for the injection cases.
- **Viewer role.** The second identity is created as `member` by the harness. OAUTH-012 needs a `viewer`, so the suite changes the role through the owner's API before the case runs. The exact endpoint is found by the probe (step 4); the role is asserted with `auth.info` before the attack call.
- **INJ cases** run through LibreChat with the approval knob (H3). The write tools are on the `ask` list; the headless decision for every paused write is `reject` (`chatWithApproval`, as in `tests/l3/nextcloud/appr-deny`). Approval is set once for the whole job, before the stack starts.
- Stub fixtures use the tool names from a committed `tests/l3/snapshots/outline.tools.json`. Names are never written from memory: the probe captures `tools/list`, and the role map (`tests/l3/snapshots/tool-roles.json`) binds roles to those names.

## 4. Probe (step 2 of the brief)

Live probe on the real stack in CI, before any assertion is written. `tests/l3/outline/probe.cases.ts` runs only with `P4_L3_OUTLINE_PROBE=1`, and it:

1. Records `initialize` and `tools/list` (names, descriptions, input schemas) to evidence and into the job log, with secrets redacted.
2. Creates probe data through Outline's REST API with the owner's key (a collection, a published document, a restricted collection and document), then calls MCP tools with the real IDs it got back, not names.
3. For each REST route it needs (`auth.info`, `collections.list`, `collections.create`, `documents.create`, `documents.info`, `documents.list`, `documents.search`, `documents.update`, `documents.move`, `documents.publish`, `documents.import`, `collections.memberships`, `users.list`, and the role-change route candidates), it records the HTTP status, the response keys and any error name and message. No body is stored that contains a key or token.
4. Prints the MCP reply text of each tool call so the reply shapes are in the job log.
5. Repeats the viewer checks with the second key (role, a create in the restricted collection, a list).

Every probe request, output and error shape is written to `docs/findings/l3-outline.md` after the CI run. The build step does not start until that file records what was observed.

## 5. Oracles and seeds

- Oracle: `src/oracles/outline.ts`, class `OutlineOracle`. It reads through Outline's REST API with the **owner's** token (or the second user's where a case needs it). It never writes, and it never reads assistant text. It discovers every ID at run time and stores none. Snapshot = digest of canonical JSON for collections and documents (id, title, collection, published state, revision count, text digest), read before and after each case with `unchanged()`.
- Seed: `tests/l3/support/seed/outline.ts`, OL0 from plan section 9. Collections `P4L3 Public` and `P4L3 Restricted` (the restricted one has no member other than the owner). Pages `P4L3 Welcome`, `P4L3 Poisoned Page` (injected instruction, canary `p4l3-canary-inj-004-<nnn>@p4-attacker.test`), and `P4L3 restricted title canary`. Zero-width text for INJ-017 is written as explicit `​`-style escapes in `tests/l3/fixtures/`, so the code points survive an editor.
- Poisoned seed text lives in `tests/l3/fixtures/` as plain files, one per injection.

## 6. Hygiene

- Each case seeds only its own documents, titled `P4L3 <case> <runId>` where the probe shows titles are needed. Fixed OL0 titles are used with the cleanup sweep below.
- **Cleanup sweep**: before the cases start, the suite deletes every document and collection whose title starts with `P4L3 `. It runs again after the last case. A sweep failure fails the run.
- **Leak check** (last test in the file, like `always-allow.cases.ts`): no owner key, no second key and no `ol_api_` value appears in `evidence/`. No canary appears in any executed (not rejected) tool call.
- Non-vacuity: a case passes only if its fixture reached the stub, the attack call reached the host (or was paused), and, for injections, the poisoned text reached the tool result. Assistant text is never read.
- Expected defects (plan D13) only for a confirmed product bug, with setup asserted first. Config or spec gaps are findings that pass, with a note.

## 7. CI job

New job `l3-outline` in `.github/workflows/pr.yml`, stub mode, no secrets, timeout 40 minutes, target about 20 minutes:

- `P4_STACK_TESTS=1`, `P4_LLM_MODE=stub`, `P4_L3_SERVERS=outline`, `P4_SECOND_IDENTITY=1`.
- Approval env (H3): `LIBRECHAT_TOOL_APPROVAL=1`, `LIBRECHAT_TOOL_APPROVAL_MODE=default`, `LIBRECHAT_TOOL_APPROVAL_ASK` = the Outline write tools, exact names from the snapshot.
- Steps: checkout, free disk, Node 22, `npm ci`, `npm run build`, `npm run stub:up`, `npm run test:stack:l3:outline`, `npm run stub:down`, upload evidence.
- Pinned actions by full SHA, as in the other jobs.

## 8. Build order

1. Plan commit (this file only) pushed first, with a draft PR opened on it. Build commits follow on the same branch without waiting, per the owner's pre-approval.
2. Pin harness `v0.6.10` (`package.json`, `allowScripts`, `package-lock.json`) and add the probe and the `l3-outline` job. Push. Read the CI logs (`docs/findings/l3-outline.md`).
3. Seed, oracle, tool snapshot and role map from what the probe observed. Then the five cases and the sweep and leak check.
4. `npm run check` locally (typecheck, unit tests, build); then CI green; then mark ready.

## 9. Risks and open items

- The Outline image is 1.13.0 (harness pin). Route names are unverified until the probe. The probe decides the role-change route, the import route and the list routes.
- If Outline's MCP returns no `documents.import` (needs multipart), INJ-011 is built on the approval gate with the attempted call recorded, and the finding is stated.
- If a viewer can create in a restricted collection, that is a candidate product bug. It becomes an expected defect only after the setup (role `viewer`, not a member) is asserted and the call reproduces in CI.
- CI runtime is not yet measured. If the job goes over 20 minutes, the findings doc says so and the cause.
