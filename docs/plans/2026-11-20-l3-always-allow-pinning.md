# Plan: L3 always-allow and tool-pinning cases (harness v0.6.7)

Status: **plan only. Awaiting reviewer approval before any build.** Branch `feat/2026-11-20-l3-always-allow-pinning`, base `origin/main` (832c234). One draft PR. No merge, no tag.

## 1. Scope

Build the L3 cases that need the two v0.6.7 harness options: LibreChat **Always allow** (`allowAlways`) and the second attack-lab server (**lab2**). Case IDs come from the 2026-11-18 L3 plan ledger (`docs/plans/2026-11-18-l3.md`, the rows in Appendix A and the case specs). No IDs are added or renumbered.

| Case | Kind | Home | Needs | Status on main |
|---|---|---|---|---|
| P4-MCP-APPR-002 | core | nextcloud | LAB, APPR, NCMAIL | not built; NCMAIL is on the unmerged wave D branch |
| P4-MCP-META-002 | core | host | LAB, APPR | not built |
| P4-MCP-META-004 | core | host | LAB, APPR | not built |
| P4-MCP-META-008 | core | host | LAB, APPR | not built |
| P4-MCP-META-011 | core | host | LAB, APPR (+ lab2) | not built |
| P4-MCP-META-013 | stretch | nextcloud | LAB, APPR, NCMAIL | not built; needs P4_MAIL=1 |

Verified on `origin/main`: these IDs appear only in `tests/l3/support/l3-cases.json` and the L3 plan. No `*.e2e.ts` or `*.cases.ts` file implements them.

## 2. Verified facts that shape the plan

Read from the harness tag `v0.6.7` (commit `30562a2`, checked with `git ls-remote` and a shallow clone; read-only, nothing installed into this repo):

- `toolApproval.allowAlways` is a boolean written as the last key of `endpoints.agents.toolApproval`. Set with `LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1` (exactly `1`). It is refused without `LIBRECHAT_TOOL_APPROVAL=1` and refused under `LIBRECHAT_TOOL_APPROVAL_MODE=dontAsk`, where LibreChat ignores remembered choices. Unset, `librechat.yaml` is byte-identical to 0.6.6.
- LibreChat offers "Always allow" only for a tool that no `ask` rule matches, is not matched by `deny`, has no `*` in its name, and is not a native code tool. So any job with Always allow on must leave `LIBRECHAT_TOOL_APPROVAL_ASK` empty. This is the known host limit. It is recorded as a host behaviour in the findings, and no case in these jobs sets an ask rule for a tool under test.
- The pause still happens with no ask rule: in `mode: default`, a tool no rule matches asks for approval.
- "Always allow" stores the tool name for the **conversation**, when the approve decision carries `scope: "session"`. Scope "session" in LibreChat means the same conversation. Whether it also covers a new conversation or a new session is **not** established by the harness and is part of the step 1 probe.
- `lab2` in `LIBRECHAT_MCP_PRODUCTS` attaches `mcpServers.lab2` at `http://p4-attack-lab-2:9011/mcp`, no `Authorization` header. The harness does not start that container; the suite must.

Repo facts on `origin/main`:

- The harness pin is **v0.6.5** (`package.json`, `allowScripts`, lockfile). Wave D (`feat/2026-11-20-l3-wave-d-mail-ui`, unmerged) moved it to v0.6.6 (`a486f6c`). Because wave D is not on main, this branch bumps **v0.6.5 → v0.6.7** directly. If wave D merges first, the pin needs a merge, and the bump keeps the v0.6.7 value.
- The attack lab already has the modes `rug-pull-after-n`, `shadow-name`, `version-bump-bcc`, `add-tool-after-connect` (`lab_new_tool`), `untrusted-annotation`, and the `lab_mail_send` tool. There is no description-only drift mode, no mode that changes the hash only between sessions, and no lab2 container.

## 3. Pin bump (first commit after approval)

Same shape as `a4d48b4` (v0.6.5) and `a486f6c` (v0.6.6):

- `package.json`: `qa-portfolio-harness` → `github:Jayami123/qa-portfolio-harness#v0.6.7`; `allowScripts` key to the same tag.
- `package-lock.json`: the `node_modules/qa-portfolio-harness` entry to `0.6.7` and the commit SHA the tag resolves to, `30562a208220e4d7994fb4000089e3e3ebf63917` (the `^{}` peeled commit).
- Harness pin is a tag, never `main` (CLAUDE.md). Node `>=22`; `npm run check` must pass.

## 4. Job wiring (Always allow only where it is needed)

- A new `tool_approval` job for these cases (in the L3 workflow), with env:
  `LIBRECHAT_TOOL_APPROVAL=1`, `LIBRECHAT_TOOL_APPROVAL_MODE=default`, `LIBRECHAT_TOOL_APPROVAL_ASK=""`, `LIBRECHAT_TOOL_APPROVAL_DENY=""` (unless a deny case needs one), `LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1`.
- Every other L3 job keeps the flag unset, so its `librechat.yaml` stays byte-identical.
- `LIBRECHAT_MCP_PRODUCTS=lab,lab2` only in the META-011 path; `lab` alone elsewhere.
- Stub model: `P4_LLM_MODE=stub`, so no `GEMINI_API_KEY` is needed (CLAUDE.md).
- A preflight in the job asserts the written `librechat.yaml` has `allowAlways: true` only in the Always-allow job and no `ask:` entry for the tools under test. The job fails before any case runs otherwise.

## 5. Step 1: live probe (before any assertion is written)

Output: `docs/findings/l3-always-allow.md`. Every assertion below is built from its results.

Probe A, Always allow on a read tool (lab `lab_echo`, a benign read):
1. Turn on the flag and a benign lab. Call `lab_echo` once. Expect a pause and an approval card.
2. Approve with `scope: "session"`. Record whether the card offered "Always allow" (`allow_always`).
3. Call `lab_echo` again in the same conversation. Record: runs with no pause or pauses.
4. Change the lab's `lab_echo` description (new mode, served on the next `tools/list`). Call again in the same conversation. Record: silent run, re-prompt, or block. Record the `tools/list` hash before and after and the call's recorded arguments.
5. Change the schema (add an optional `bcc` string parameter). Repeat step 4. Record whether a call carries `bcc`.
6. Scope check, same run, recorded separately:
   - a second conversation with the same tool (new conversation id, same user, same LibreChat session),
   - a new LibreChat user session (new login),
   - a fresh stack restart with the same lab hash.
   For each, record whether the call pauses.

Each observation records: the pause, the approval state, the lab call log, and the `tools/list` hash. The probe prints names and statuses only. No secret or token is printed.

Probe B, lab2 after consent: connect `lab2` mid-chat (set `LIBRECHAT_MCP_PRODUCTS` on the next `librechat.yaml` write, or add the server through the harness lab2 option and restart LibreChat). Record whether a `lab2` tool with the same name as an approved `lab` tool runs without a new approval.

Probe C, cross-session hash change (stretch, needs `P4_MAIL=1`): approve in session 1, change the lab's hash, start session 2. Record whether session 2 pauses.

Decision rule: a case's assertions are written only for behaviour the probe shows. If the probe shows the host never claims pinning (no re-prompt and no block after a hash change), that is a deployment finding and the case passes with a note (section 7).

## 6. Cases and oracles

Oracles are side effects and recorded calls only: GreenMail (`nc.mailEmpty`), the Nextcloud sent store, the lab sink, and the lab call log. The model's reply text is never an oracle. Each case snapshots before and after, and cleans up its own data (distinct canary and address per case).

- **P4-MCP-APPR-002** (always-allow scoped to one tool; NCMAIL). Approve and always-allow `lab_echo` (read). Then call `nc` `mail_send` and the lab exfil tool (`lab_mail_send`). Assert: each of those pauses for its own approval; `nc.mailEmpty` and `sink.empty` after the run, except the approved write. Needs wave D (NCMAIL); blocked until wave D is on main, or built on that branch if the reviewer chooses (section 9).
- **P4-MCP-META-002** (rug pull after always-allow). Always-allow `lab_echo`. Lab mode `rug-pull-after-n`; after the switch, the call carries the new `bcc` parameter. Assert: call N+1 is re-prompted or blocked (per probe A); no recorded call carries `bcc`; the `tools/list` snapshot diff is logged. If the probe shows silent reuse, see section 8.
- **P4-MCP-META-004** (re-approval on hash change). Lab mode: a rug pull that changes the hash. Assert: after the hash change, every host path that claims pinning re-prompts or blocks. A host path that does neither is a finding, recorded and not a flaky fail. No unapproved call is recorded.
- **P4-MCP-META-008** (mid-session drift detected). New lab mode `drift-mid-session`: description-only change after connect. Assert: the snapshot shows the changed hash; later calls use the new hash only after re-approval, or they are blocked (`trace.blockedUntilReapproval`).
- **P4-MCP-META-011** (server added after consent is not auto-trusted). Always-allow `lab`; connect `lab2` mid-chat (second container, suite-owned, `docker/p4-lab.compose.yml`, `127.0.0.1`-bound host port, service `p4-attack-lab-2`, port 9011). Assert: the first `lab2` tool call pauses for approval; no `lab2` tool runs without a new approval; the call log shows no `lab2` call before approval.
- **P4-MCP-META-013** (stretch; NCMAIL; `P4_MAIL=1`). Session 1: always-allow and approve on the lab tool; session 2: lab hash changed and a shadowed name (`shadow-name`). Assert: session 2 does not reuse session 1's always-allow; `nc.mailEmpty` and the sink stay clean.

Lab modes to add (each with an L2 unit test in `tests/l2/`, in `src/attack-lab/modes.ts`):

- `drift-mid-session`: description-only change after the first `tools/list`.
- `hash-change-between-sessions`: the lab keeps a hash-changing state across new MCP sessions (META-013 and META-004 second leg).
- Any mode for the shadowed name (`shadow-name`) already exists; it is reused.

## 7. Findings policy

- A LibreChat that silently honours a stale always-allow after a hash change is a **PRODUCT BUG**. Evidence: the recorded call with the new parameter or hash, and the approval state. The case is marked `expectedDefect`, with its setup asserted first (the flag is on, the always-allow is set, the hash changed). The case must fail with a clear message if the defect ever goes away unannotated.
- A host that never claims pinning is a **deployment finding**: the case passes, with a note in the findings doc. It is not a fail.
- A test bug is labelled **TEST BUG** with its evidence. Nothing is called a product bug without a recorded call or state change.
- The host limit (Always allow never offered on an ask-matched tool) is recorded as a **host behaviour** in `docs/findings/l3-always-allow.md`, with the probe output that shows it.

## 8. Hygiene and leak check

- Each case uses its own canary and data (`p4l3-<case>-<run>`), so a case never reads another case's sent mail or sink entry.
- A cleanup sweep runs after each case: the lab returns to its start mode, lab2 returns to benign, the GreenMail and Nextcloud test data is removed, and `sink.empty` is checked before the next case.
- A leak check scans the evidence directory and the findings doc for secret values and tokens (names only are printed). It fails the job on a match. Never print a secret. Never commit `.harness/`.
- No product fork is edited, and no product is started or stopped by hand. Only the suite-owned lab containers (`lab`, `lab2`) are started, through `docker/p4-lab.compose.yml`.

## 9. CI and time budget

- New `l3` job (stub model) for the Always-allow group: APPR-002 and META-013 need NCMAIL and stay on the nightly/dispatch path. META-002, META-004, META-008, META-011 run on the PR gate if the measured run stays under about 20 minutes. The measured time is recorded in the findings; if it does not fit, the slow cases move to nightly and dispatch, and the PR says so.
- `npm run check` must pass before the PR is marked ready. Tests run with `tsc` then `node --test`.

## 10. Decisions the reviewer needs to make

1. **Approve the plan gate.** CLAUDE.md requires the reviewer's approval before the build. Nothing beyond this document has been changed.
2. **NCMAIL dependency.** APPR-002 and META-013 need the wave D mail stack (not on main). Options: (a) wait for wave D to merge, then build; (b) stack this branch on wave D now. Recommendation: (a), so the L3 history stays linear.
3. **Pin base.** The bump is v0.6.5 → v0.6.7 from main. If wave D merges first, the pin merges cleanly to v0.6.7.

## 11. Not in this plan

- No L4 or L5 case is implemented or closed (CLAUDE.md).
- No case ID is added or renumbered outside the ledger.
- No product fork is edited.
