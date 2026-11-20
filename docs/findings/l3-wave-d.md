# L3 wave D findings (mail and UI cases)

Branch `feat/2026-11-20-l3-wave-d-mail-ui`. Harness pinned to `v0.6.6` (tag object `5824bd6`, commit `8a8a5f4`). Stub model only.
Case IDs come from the 2026-11-18 ledger (`tests/l3/support/l3-cases.json`); none were invented or renumbered.

Every observation below was recorded by the probes in `tests/l3/probe/` (`PROBE|` lines in the CI log) on the real stack:
LibreChat v0.8.9, Nextcloud 35 with Mail app 5.13.3, GreenMail 2.1.15, the attack-lab. The probe runs are CI run
`44589285958` (first UI probe), `44590431418` (UI probe, mail setup race) and `44591815424` (both probes, first full pass).

## Live observations

### Mail stack (P4_MAIL=1)

| What | Observed |
|---|---|
| Nextcloud MCP | `Nextcloud MCP` 0.213.2. Send tool `nc_mail_send_message`, fields `account_id` (integer), `to` (list of `{email}`), `subject`, `body`; optional `cc`, `bcc`, `is_html`, `references`. |
| Owner account | `nc_mail_list_accounts` gives one account: id `1`, `qa-owner@p4.test`. Mailboxes: INBOX id 1, Sent id 2. The fixtures name account 1; each case asserts it first. |
| GreenMail REST | `GET /api/user` gives `[{login,email}]`. `GET /api/user/{address}/messages` is **200 with a list for a user** and **400 `{"message":"User '<address>' not found"}` for an address with no user**. A delivery creates the user. `/folders` is 404. |
| Delivery | A send through the MCP reached GreenMail at once (first poll). The recipient then exists as a GreenMail user. |
| Sent store | Right after a send, `nc_mail_list_messages` on Sent is **empty** (the Mail app caches a mailbox and the stack has no cron). `POST /index.php/apps/mail/api/mailboxes/{sentId}/sync` with `{"init":true,"ids":[]}` and the owner's own credential gives 200 and the message; `GET .../api/messages?mailboxId=` then lists it. `GET` on `/sync` is 405. The Sent oracle does the sync first. |
| Approval pause | A mail send through LibreChat pauses with `allowed_decisions` `approve`, `reject`, `edit`, `respond`, and shows the arguments. |
| Edit decision | The probe sent `edit` with a new recipient. The run had **one** pause, finished, and GreenMail then held the edited message for the **new** address. No second prompt. |
| Shadow tool | In `shadow-name` mode the lab lists `nc_mail_send_message` (5 tools). Through LibreChat it is `nc_mail_send_message_mcp_lab`, a different tool from `nc_mail_send_message_mcp_nextcloud`. It paused for its own approval; after a reject the lab's sink held 0 records and the turn finished. |
| Lab initialize | `{"client":"@librechat/api-client","elicitationForm":false,"elicitationUrl":false}`. |

### LibreChat UI (Playwright, Chromium)

| What | Observed |
|---|---|
| Sign-in | The harness does not export the owner's password. The page is signed in by answering the client's own `POST /api/auth/refresh` with the API bearer token and the user from `GET /api/user`. Every other request goes to the real server. |
| Composer | `getByTestId("text-input")`, accessible name `Message input`. Enter sends. |
| Approval card | `region "Review 1 action"` holding `region "<tool>_mcp_<server>"` with `heading` (the tool name), `Proposed arguments` and the JSON, buttons `Approve`, `Reject`, `Edit`, `Respond`, the text `0 of 1 decisions selected`, and a button **`Continue`** (disabled until a decision is picked). The earlier guess "Submit" was a test bug and is fixed. |
| Server identity on the card | The only server reference is the host's own alias: the call header reads `Preparing lab_echo in lab` and `Ran lab_connect_account in lab`. Neither the lab's real server name (`p4-attack-lab`), nor its origin (`p4-attack-lab:9010`), nor its display title (`Nextcloud (official)`) appears anywhere on the page. |
| Elicitation | No dialog, alert dialog or alert at any step. 0 popups, 0 requests to any host but LibreChat, 0 sink records. The lab logged `elicitation_unsupported` in both `elicitation-url` and `elicitation-form` mode. LibreChat's client declares no `elicitation` capability (the source of v0.8.9 has no elicitation handler either). |

## Cases

Counts are from the CI run named in the report (see the PR). Labels follow the rules in the task: a proven product bug gets
`expectedDefect` with the setup asserted first; a spec or config gap is a deployment finding that passes, with a note.

| Case | Oracle | Label | Basis |
|---|---|---|---|
| P4-MCP-APPR-003 | GreenMail copies for the new address; prompts counted | **PRODUCT BUG** (expectedDefect), owner may reclassify | An `edit` decision runs the edited arguments (new recipient) on the same approval: 1 prompt, 1 copy at the new address. The ledger asks for a new prompt and 0 copies. LibreChat's UI says the edit decision is the reviewer's own change, so the owner may rule this by design; the case then needs its oracle changed, not the product. |
| P4-MCP-META-003 | lab sink, GreenMail, Nextcloud Sent store | pass | The shadow tool stopped for its own approval, named for the lab server. Sink 0, GreenMail and Sent unchanged. A control leg (the real tool, approved) proves both oracles move. |
| P4-MCP-APPR-004 | page watch (popups, navigations, requests), lab sink, lab log | pass, **DEPLOYMENT FINDING** | LibreChat v0.8.9 declares no elicitation, so there is no dialog to read. The dialog assertion (server name and full origin) is not claimed; it is made automatically if a dialog ever appears. Nothing was auto-opened and the sink got 0 visits and 0 posts. |
| P4-MCP-APPR-005 | page, lab sink | pass, **DEPLOYMENT FINDING** | Same: no form reached the UI. No password field on the page, 0 `form-credential` records. |
| P4-MCP-META-012 | page text | **PRODUCT BUG** (expectedDefect) | The approval card shows the tool name and the host's own alias `lab`, never the real server name or the origin. Setup asserted first: the lab serves the look-alike title under its real name, and the card is on screen. |

## Deviations and harness gaps

- **No separate plan document.** The L3 plan (`docs/plans/2026-11-18-l3.md`) is approved and already covers wave D, and the task asked for a build straight through. A plan PR was not opened.
- **Browser sign-in.** The harness exports no LibreChat owner login. The suite answers `/api/auth/refresh` itself. Harness request: export a `librechatOwnerLogin()` (or a browser storage state) so UI tests sign in the way a person does.
- **Mail setup race (harness v0.6.6).** In run `44590431418` the harness's own setup stopped with `Mail accounts list for qa-owner returned HTTP 404`, a few seconds after `app:enable mail`. It did not recur in `44591815424`. Harness request: retry that call until the Mail routes load.
- **GreenMail cleanup.** No delete route was verified for GreenMail users, so the sweep does not delete them; GreenMail's store is in memory and recreated by every `up`. Each case uses its own addresses and subjects.
- **Account id in fixtures.** Stub fixtures are static JSON, so the Mail account id (1) is written into them. Each case asserts the id before it runs.
- **Edit semantics.** See APPR-003 above: a decision for the owner.
- **Look-alike title.** No new lab mode was needed: `LAB_SERVER_TITLE` has existed since L2. This change only passes it (and `LAB_SHADOW_NAME`) through the lab compose file, and sets the shadow default to the real tool name `nc_mail_send_message` (follow-up F2).

## Not built

APPR-002, META-013, META-002, META-004, META-008 and META-011 are out of scope until harness v0.6.7 (`allowAlways`).

## Harness note: the owner's Mail account id is not stable between runs

Not a product bug. The cause is not confirmed; it may be harness retries in `configureMailIdentity` (it deletes stale Mail accounts
and creates new ones, and v0.6.8 adds a wait before that call). Observed owner account ids:

| CI run | Harness | Owner Mail account id |
|---|---|---|
| 44590431418 | v0.6.6 | (setup failed before listing: HTTP 404, the route race) |
| 44591815424 | v0.6.6 | 1 |
| 44604176433 | v0.6.6 | (setup failed before listing: HTTP 404) |
| 44691283731 | v0.6.8 | 2 |

Harness request: keep the owner's account id fixed for each run (for example, create it once, with a documented id), or export it
from the adapter. Until then the cases read the id from the Mail API at setup and pass it with a `[var:owner_account_id=<id>]`
marker (see `docs/stub-markers.md`), so no fixture depends on the number.

## Mail setup race on v0.6.6 (fixed in v0.6.8)

On v0.6.6 the owner's Mail accounts list returned HTTP 404 a few seconds after `app:enable mail` in 2 of 3 runs. On v0.6.8 the mail
setup ran through in every run since the pin bump (44691283731 and later).

## Evidence from CI run 44693268501 (head 158085c)

Artifacts downloaded with `gh run download` (`l3-mail-evidence-44693268501`, `l3-ui-evidence-44693268501`). Quoted lines are verbatim.

### P4-MCP-APPR-003 (artifact `traces/P4-MCP-APPR-003/verdicts.json`)

Verdict lines:
- `expected defect, still reproduces (librechat: an edit decision runs the edited arguments (new recipient) on the same approval, with no new prompt)`
- `the original address holds 0 copies`

Note line (the approval count and the copy for the new address):
- `prompts: 1; copies for the new address: 1; Sent store messages 0 -> 1; GreenMail users now: ["p4l3-appr-003-b@p4.test","qa-owner@p4.test"]`

What this shows: one approval prompt, one copy at the new address `p4l3-appr-003-b@p4.test` (the edited recipient), and 0 copies at the original `p4l3-appr-003-a@p4.test`.

What it does not show: the approval record itself (the pause's `calls` and `sent`). The verdict file keeps only the count. Those fields were printed by the probe in an earlier run (44691283731: `appr.pause#1` with `"allowed":["approve","reject","edit","respond"]` and the edited arguments), not in this run.

**Discrepancy, not resolved here:** the probe job of the same run (`l3 mail`, log line `PROBE|appr.run`) printed `{"pauses":[],"finished":true}` and `PROBE|greenmail.B after edit flow|{"status":400,"subjects":[]}`. The probe's fixture now uses `{{owner_account_id}}`, and the probe's prompt has no `[var:owner_account_id=…]` marker, so the stub refused the turn before any approval. The probe's assertions are log lines only, so the job stayed green. The case itself sends the marker and paused once. Fix: give the probe's prompt the same marker (a one-line change in `tests/l3/probe/mail.probe.ts`); not made, as no code change was requested unless the evidence disagreed.

### P4-MCP-META-012 (artifact `traces/P4-MCP-META-012/approval-aria.txt` and `verdicts.json`)

Card text from the accessibility tree (verbatim, lines 69 to 85 of the artifact):

    - text: Preparing lab_echo
    - button "Preparing lab_echo in lab 0 seconds elapsed"
    - region "Review 1 action":
      - region "lab_echo_mcp_lab":
        - heading "lab_echo_mcp_lab" [level=3]
        - paragraph: Proposed arguments
        - button "Approve"
        - button "Continue" [disabled]

The verdict note (verbatim): `friendly title shown: false; real server name shown: false; origin shown: false`.

The lab name (`p4-attack-lab`) and the origin (`p4-attack-lab:9010`) appear 0 times in the card text. The only server reference is the alias `in lab`. The setup verdict (`setup: the lab serves name p4-attack-lab and the look-alike title`) passed, so the title was real and the card still did not show it.
