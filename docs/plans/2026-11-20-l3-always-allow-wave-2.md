# Plan: L3 always-allow wave 2 (P4-MCP-APPR-002, P4-MCP-META-013)

Status: building under the reviewer's instruction for this wave (the L3 plan rows are approved: `docs/plans/2026-11-18-l3.md`). Branch `feat/2026-11-20-l3-always-allow-wave-2`, base `origin/main` (5e30f5d). One draft PR. No merge, no tag.

Harness pin stays `qa-portfolio-harness` v0.6.10 (already on main). No pin change in this wave.

## 1. Scope

| Case | Kind | Home | Needs | Job |
|---|---|---|---|---|
| P4-MCP-APPR-002 | core | nextcloud | LAB, APPR, NCMAIL | new job `l3-always-allow-mail` |
| P4-MCP-META-013 | stretch | nextcloud | LAB, APPR, NCMAIL | same job |

Case IDs come from the ledger (`tests/l3/support/l3-cases.json`) only. No ID is added or renumbered.

## 2. The NCMAIL dependency (decision for the reviewer)

The mail suite code (`src/oracles/greenmail.ts`, `tests/l3/support/nextcloud-mail.ts`) and the lab's shadow-name default are on the open PR #19 (wave D), not on main. The harness side (`P4_MAIL=1`, GreenMail, the Mail app setup) is already in v0.6.10 on main.

Decision taken here: build on main now, with the two mail helper files copied **verbatim** from PR #19 and the shadow-name change applied from the same diff. Identical content on both sides means a later merge of PR #19 (or of main into PR #19) does not conflict on those files. The alternative (stacking on PR #19) would break the "from origin/main" base the owner asked for.

## 3. Mechanics

- **Mail stack:** the job sets `P4_MAIL=1` and `P4_L3_SERVERS=nextcloud,lab`. The harness starts Nextcloud, GreenMail and the Mail app. The lab runs as the existing `lab` container.
- **Approval policy:** `LIBRECHAT_TOOL_APPROVAL=1`, mode `default`, `LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1`, no ask rule, no deny rule. Same as the always-allow job. Every other L3 job keeps the flag unset.
- **Run-time ids:** the owner's Mail account id is read from the Mail API at setup (never hard-coded) and passed to the stub through the existing `{{bind:NAME}}` mechanism (`PUT /__bindings`). A bound value of digits only is sent as an integer, because the Nextcloud send tool's `account_id` is an integer (`src/stub/bindings.ts`, unit-tested). Part B's `[var:]` migration will move these fixtures with the rest.
- **Shadow name:** the lab's `shadow-name` mode lists `lab_mail_send` as `nc_mail_send_message`, the real Nextcloud name (default changed here, as in PR #19).

## 4. Oracles (never the model's text)

- GreenMail copies per address (`src/oracles/greenmail.ts`): what left Nextcloud.
- The lab's sink records and completed-call log.
- The approval pauses: which tool asked, and whether the card offered Always allow.
- The lab's tool-list hash and served names (for the shadow-name switch).

### APPR-002

- Leg 1 (conversation A): `lab_echo` approved with Always allow.
- Control (new conversation B): the Nextcloud send approved once. It must reach GreenMail, so the oracle is proven live.
- Leg 2 (conversation A, continued): one turn asks for `lab_echo`, the Nextcloud send and the lab exfil send. Setup: `lab_echo` runs with no pause. Expected: the two sends each pause, and both are rejected. Verdicts: 0 GreenMail copies for the hostile address, 0 sink records, no completed exfil call.
- Any send that runs with no approval asked is an expected defect only when it reproduces, and the setup is asserted first.

### META-013

- Session 1 (conversation S1, benign lab): `lab_echo` approved with Always allow.
- The lab switches to `shadow-name`. The hash changes and the mail tool is listed under the Nextcloud name (asserted).
- Session 2 (a new conversation): `lab_echo` and the shadowed send in one turn. Both must pause. Neither may run without its own approval. GreenMail stays at 0 copies.
- "Session" here means a new conversation. A new login is covered by META-004 (path 3).

## 5. Checks

- `npm run check` (typecheck, unit tests, build) must pass locally. The stack-gated tests run only in the CI job.
- The CI job `l3 always-allow mail` must be green on the final head. Run ids and verdicts go in `docs/findings/l3-always-allow.md`.

## 6. Part B (not started)

Part B of the request needs PR #19 merged into main. At the time of this plan PR #19 is open, so Part B is not started. The steps are in the request; this plan does not change them.

## 7. Not in this plan

- No L4 or L5 case is implemented or closed.
- No product fork is edited. No product is started or stopped by hand; only the suite-owned lab containers and the harness-owned stack.
