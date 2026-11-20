# L3 always-allow and pinning findings (harness v0.6.7)

Scope: P4-MCP-META-002, META-004, META-008 and META-011 (L3 plan ledger, `docs/plans/2026-11-18-l3.md`). IDs are the ledger's; none added or renumbered. APPR-002 and META-013 are not built here: they need the Nextcloud mail stack, which is on the unmerged wave D branch.

Status: live runs in CI (job `l3 always-allow`). Run 44600052996 (head `a0ca417`), run 44601086639 (head `3be8efe`), and run 44602144963 (head `e5db330`, the current head). The silent-run finding below reproduced in all three runs with the same result.

Latest run (44602144963, head `e5db330`): all 11 jobs succeeded, including `l3 always-allow`. Its verdicts, read from the job log: P4-MCP-META-002 pass (silent run reproduced as an expected defect), P4-MCP-META-004 pass (path 1 silent run reproduced as an expected defect; paths 2 and 3 re-prompted), P4-MCP-META-008 pass (silent run reproduced as an expected defect), P4-MCP-META-011 pass (lab2 served at turn 0 and 1, one approval pause, no lab2 call ran without approval). The META-011 pass is the first real result for that case.

## Setup (asserted in every run before any finding is recorded)

- LibreChat v0.8.9 with `allowAlways: true`, `mode: default`, no ask rule, no deny rule (job env in `.github/workflows/pr.yml`, entry `tests/l3/host/always-allow.e2e.ts`).
- Two attack labs: `lab` (`p4-attack-lab`) and `lab2` (`p4-attack-lab-2`). Both registered with LibreChat at boot.
- Stub model (`P4_LLM_MODE=stub`). No GEMINI key.

## Host behaviour (observed)

| Question | Answer | Evidence |
|---|---|---|
| Does the approval card offer Always allow for a tool with no ask rule? | Yes | META-002 leg 1: `offeredAlways` true (verdict "the approval card offered Always allow") |
| Is the stored choice kept in the same conversation? | Yes | META-002 leg 2 (unchanged tool, same conversation): no pause |
| Is it kept in a new conversation? | No: the host asked again | META-002 scope probe, new conversation: pauses 1 |
| Is it kept after a new LibreChat login? | No: the host asked again | META-002 scope probe, new login: pauses 1 |
| Are the stored choices per tool name? | Not tested yet | APPR-002 needs NCMAIL (blocked) |
| Does a second server with the same tool name inherit the choice? | Not established (see META-011, inconclusive) | |

Scope "session" in this host means the same conversation (matches the harness docs).

Known host limit, from the harness (`docs/plans/2026-11-20-librechat-allowalways-lab2.md` in the harness repo, section 1): Always allow is never offered for a tool that an ask rule matches. The jobs here set no ask rule, so the card is offered. This is not re-observed in this suite; it is the harness's recorded result.

## Expected defects (product): stored Always allow honoured after a tool change

Reproduced in both runs (44600052996 and 44601086639). Setup was asserted first in each case: the choice was stored and the change was served.

- **P4-MCP-META-002**: after the rug pull (new description, new `bcc` parameter on `lab_echo`), the same conversation ran a call carrying `bcc` with no approval asked. Lab log: one call, parameters `bcc,text`. Pauses: 0. Snapshot diff: description and input schema changed.
- **P4-MCP-META-004** (path 1, same conversation): after a hash change, a `lab_echo` call ran with no approval asked. Paths 2 (new conversation) and 3 (new login) asked for approval and ran nothing.
- **P4-MCP-META-008**: after a description-only drift mid-session, the same conversation ran a `lab_echo` call with no approval asked. Snapshot: the hash changed and the served description differs from the pin.

Classification: **PRODUCT BUG** (reproduced in two runs on the same host build). The cases record it as an expected defect: `expectedDefect()` passes while the silent run reproduces and fails once it stops reproducing, so the annotation is removed when the host is fixed. In run 44601086639 the stub served the META-002 hostile fixture at turns [2,3]: turn 2 is the tool call that carries `bcc`, so the silent run is the host's, not a stub mismatch.

## Test bugs found and fixed in this PR

- **TEST BUG**: the "fixture delivered" check looked for turn 0. The padded continuation fixtures serve their call at a later turn, so the check failed although the stub had served the call. Now any served turn counts, and the served turns are noted.
- **TEST BUG (stub)**: the stub refused any continued chat, because the earlier leg's marker was still in the history, so every later leg failed before the model was called. The stub now takes the fixture from the latest user message (`src/stub/server.ts`). Unit tests cover this and the same-message refusal.
- **TEST BUG (leak check)**: walked a directory that does not exist. It now walks `evidence/`.

## Open items

- **P4-MCP-META-011 (passed in run 44602144963 after the fixture fix)**: the stub served the lab2 fixture at turn 0, which is that fixture's placeholder turn. Leg 2 runs on a new agent in the same conversation, and LibreChat sent no tool messages for it, so the placeholder I had padded in was never skipped. **TEST BUG**: the fixture now has no placeholder, and the case expects the lab2 call at turn 0. No finding is recorded until a run shows the lab2 pause or an un-asked lab2 call.
- **Probe output**: the per-case verdicts are printed to the job log (new step, "Print the case verdicts"), so no artifact download is needed.
- **snap.diffLogged**: the suite logs the diff it computes from the served list. The host's own log is not observable from here; that limit is stated, not assumed away.

## Deviations from the plan

- Lab2 is attached at boot, not hot-plugged into a running chat. "Connect mid-chat" is tested as first use of lab2's tool in the same conversation through a new agent. A true runtime connect is not available in this host.
- The pin moves v0.6.5 → v0.6.7 from main (v0.6.6 exists only on the unmerged wave D branch).
- The lab2 healthcheck targets its own sink port (9014). The image's default check targets 9012, the first lab's port.

## Wave 2: P4-MCP-APPR-002 and P4-MCP-META-013 (harness v0.6.10, job `l3 always-allow mail`)

Plan: `docs/plans/2026-11-20-l3-always-allow-wave-2.md`. Mail stack: `P4_MAIL=1` (GreenMail, Mail app). Stub mode only.

### Status

- **P4-MCP-META-013: passes** in every run from `fbc7cfb` on (session 2 paused for both `lab_echo` and the shadowed send; neither ran; GreenMail 0 copies).
- **P4-MCP-APPR-002: does not pass.** The approval legs pass (the always-allowed `lab_echo` runs with no pause; the Nextcloud send and the lab exfil send each pause and are rejected; 0 GreenMail copies, 0 sink records). The **control** does not: the approved Nextcloud send never reaches GreenMail. The case is not annotated as an expected defect and its control assertion is not weakened.

### Runs

| Run | Head | META-013 | APPR-002 |
|---|---|---|---|
| 44780372971 | 528b41b | not reached (APPR-002 failed first) | control failed; see below |
| 44782444847 | 2a3a8cc | pass | control failed |
| 44784169846 | fbc7cfb | pass | control failed |
| 44785535689 | 07ad2ff | pass | control failed |
| 44786818444 | c218553 | pass | control failed (warm-up wrongly reported a pass; see below) |
| 44788287671 | 0476e81 | not reached | readiness check failed (24 attempts) |

### Verbatim evidence (names and outputs only; fake data; no secrets)

Run 44782444847 (head 2a3a8cc):

> control: the approved send did not reach GreenMail in 60 s (copies 0); Sent store subjects: []; GreenMail users: ["qa-owner@p4.test"]

Run 44784169846 (head fbc7cfb), the first with the direct probe:

> control: the approved send did not reach GreenMail in 60 s (copies 0); control stub turns [0,1]; Sent store subjects: []; GreenMail users: ["qa-owner@p4.test"]; direct probe: call returned {"success":true,"timestamp":"2026-11-20T17:38:38.731168Z","message":"Message sent successfully"}; direct probe copies in GreenMail: 1

Run 44785535689 (head 07ad2ff), the approved conversation's tool output:

> approved conversation tool outputs: names ["nc_mail_send_message_mcp_nextcloud"]; outputs ["Error: Failed to send message: 500 {\"status\":\"error\",\"message\":\"Could not send message\",\"data\":[{\"id\":1,\"type\":0,\"accountId\":1,\"aliasId\":null,\"sendAt\":null,\"upd\"]

So the approval resumed the tool and the tool ran, but Nextcloud answered 500. The model received the error and the stub served its next turn.

Run 44786818444 (head c218553): the warm-up verdict said "pass", but the reply was the same 500. The harness's send helper treated a returned error text as success. Fixed in `0476e81`: a send counts as delivered only on `success: true`.

Run 44788287671 (head 0476e81):

> setup: Nextcloud did not accept a direct send in 24 attempt(s); last reply: "Failed to send message: 500 {\"status\":\"error\",\"message\":\"Could not send message\",\"data\":[{\"id\":24,\"type\":0,\"accountId\":1,\"aliasId\":null,\"sen

Each failed attempt creates a message row (the `id` increases by one per attempt). Over the 6-minute budget no send to the case address (`p4l3-appr-002-warm@p4.test`) succeeded.

### What the evidence shows, and what it does not

- Shown: Nextcloud returns 500 "Could not send message" for sends to the case addresses through the Nextcloud MCP tool, in every run, with the owner's account 1.
- Shown: the same tool, with the same arguments except the recipient and subject, succeeded once per run to `p4l3-appr-002-direct@p4.test` (subject "p4l3 appr-002 direct probe"). That probe ran after the approved leg in each run where it ran.
- Not shown: why. Two hypotheses are open. (a) Recipient or subject sensitivity in the Mail app's send path. (b) An ordering effect: every success came after the approved leg and every failure came before it. A readiness delay is not supported: the 24 attempts over 6 minutes all failed.
- Not shown: Nextcloud's own log for the 500. Reading `nextcloud-app` logs in CI is the next step.

### Test bugs found and fixed in this wave

- **TEST BUG** (`2a3a8cc`): META-013 session 2 served the placeholder text turn; the tool call is turn 0 in a new conversation.
- **TEST BUG** (`0476e81`): a send was counted as delivered when Nextcloud returned an error as a result.

No APPR-002 result is recorded as a pass. The control stays a hard assertion.

### Run 44792119046 (head a766fba): the Nextcloud send chain, verbatim (redacted; fake data)

- `l3 always-allow mail` job 136482464961: `P4-MCP-APPR-002` fails at the setup check (direct send to `p4l3-appr-002-direct@p4.test`, subject `p4l3 appr-002 warm-up`): `Failed to send message: 500 {"status":"error","message":"Could not send message","data":[{"id":1,"type":0,"accountId":1,...`. `P4-MCP-META-013` passes.
- `sends.json`: `"at": "2026-11-20T18:27:12.257Z"`, `"via": "direct"`, `"address": "p4l3-appr-002-direct@p4.test"`, `"ok": false`. This is the first send that reached the Mail app in the case (after leg 1, before the control).
- Nextcloud MCP log (`nextcloud-mcp-logs-tail.txt`), same second:
  `WARNING [2026-11-20 18:27:12] nextcloud_client.base - HTTPStatusError 500: Server error '500 Internal Server Error' for url 'http://app/index.php/apps/mail/api/outbox/1'`
  `INFO [2026-11-20 18:27:12] mcp.server.mcpserver.server - Tool 'nc_mail_send_message' failed: 'Failed to send message: 500 {"status":"error","message":"Could not send message",...`
- Nextcloud's own log tail (`nextcloud-log-tail.txt`, `/var/www/html/data/nextcloud.log`): no lines captured. The file tail was empty, so the Mail app's exception is not in that file.
- GreenMail log (`greenmail-logs-tail.txt`): startup lines only; no SMTP session in the window.

**Open:** the 500 comes from the Mail app's outbox step (`/apps/mail/api/outbox/1`), before any SMTP. The reason is not in the captured logs. Still needed: `docker logs` of the Nextcloud app container (its stdout/stderr, where Nextcloud may log errors), and the owner Mail account's SMTP settings (host, port, TLS; password redacted). Neither is captured yet.

### Run 44804893661 (head b675b72): known-good comparison, SMTP AUTH, logging at loglevel 0

- `P4-MCP-APPR-002` verdicts: setup passes (account id 1 used, reported and in the Mail API); the warm-up send to `p4l3-appr-002-direct@p4.test` fails with `500 "Could not send message"`. The approved control and the legs after it did not run.
- **The known-good send fails the same way.** `p4l3 known-good control` to `p4l3-appr-002-known-good@p4.test`, same account id, same field shape as the wave D control (`account_id`, `to`, `subject`, `body`): `Failed to send message: 500 ... "Could not send message"`. So the failure is not specific to APPR-002's send.
- **Server steps for each send** (Apache access log of the Nextcloud app container, same second): `POST /index.php/apps/mail/api/outbox` returns `201` (draft created, id 1), then `POST /index.php/apps/mail/api/outbox/1` returns `500`. A `GET /index.php/apps/mail/api/outbox` returns `200`.
- **Failing draft fields** (from the MCP error text): `"accountId":1`, `"aliasId":null`, `"sendAt":null`, `"from":[]`, `"to":[{"email":"p4l3-appr-002-known-good@p4.test",...}]`, `"cc":[]`, `"bcc":[]`.
- **SMTP AUTH from the Nextcloud app container to GreenMail:3025** with a GreenMail probe user (per-run password on stdin, never printed): `greeting 220`, `ehlo 250`, `auth-start 334`, `after-login 334`, `auth-result 235`. GreenMail accepts AUTH LOGIN. The account's own stored password is generated by the harness and is not exposed to the suite, so this does not test that password.
- **Logging at loglevel 0** (set for this run): `occ log:file` reports `Log file: /var/www/html/data/nextcloud.log`. The file contains only `occ` entries from the `circles` app (level 0). No entry is written for the outbox request that returned 500 at 19:49:36. The Mail app's exception is not in the Nextcloud log at all.
- **Verdict:** the Mail app fails every send with `500 "Could not send message"`, it does not log the cause, and the suite cannot read it. The SMTP transport and the credentials path both work. Cause: not determined from the captured evidence.

### Harness request (configure Nextcloud logging for the mail stack)

- **Need:** when the Nextcloud Mail app's outbox send fails, the exception must reach Nextcloud's log, so the suite can name the cause. Today the send returns `500 "Could not send message"` and nothing is logged.
- **Evidence:** run 44804893661 (head `b675b72`): the known-good send and the APPR-002 send both fail at `POST /index.php/apps/mail/api/outbox/1` with HTTP 500, after `POST /index.php/apps/mail/api/outbox` returns 201. `loglevel` is `0` (set by the suite for the run); `/var/www/html/data/nextcloud.log` contains only unrelated `occ` entries. SMTP AUTH from the app container to `greenmail:3025` returns `235`.
- **Ask:** in the mail stack's Nextcloud setup, enable debug logging for the mail app and make the Mail app log the SMTP and outbox exception (the log backend is file and rotated at 100 MB). The harness already owns this setup; the suite should not change Mail app internals.
- **Not asked:** no retries, sleeps or changed assertions in the suite to hide the 500.

### Wave 2 analysis: job diff and harness trace (no run, local reading only)

Status: **P4-MCP-APPR-002 blocked** on the Nextcloud Mail send (setup check fails before any approval leg is reached). **P4-MCP-META-013 passes** (run 44792119046, head a766fba).

Job diff, `l3 mail` (wave D, merged PR #19) against `l3 always-allow mail` (this PR), from `.github/workflows/pr.yml` and the test entries:

| Item | `l3 mail` | `l3 always-allow mail` | Effect on the Nextcloud send |
|---|---|---|---|
| `P4_MAIL` | 1 (set by `tests/l3/nextcloud/mail.e2e.ts`) | 1 (set by `always-allow-mail.e2e.ts`) | none: both start GreenMail and run `configureMailIdentity` |
| `P4_L3_SERVERS` | unset (all registered: nextcloud, lab) | `nextcloud,lab` | none: `selectServers` returns the same list |
| `LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS` | unset | 1 | none: writes one `allowAlways: true` line to LibreChat's config (`librechat-approval.js:70`); the failing send goes straight to the Nextcloud MCP |
| `LAB_MODE` for `lab:up` | `shadow-name` | unset (benign) | none on the Nextcloud send; **the hostile leg needs it** (fixed in this commit, see below) |
| `P4_L3_PROBE` | 1 (runs `probe/mail.e2e.ts` as a separate step first) | unset | the probe is a separate process: it boots and stops its own stack before the cases step |
| Order of sends | probe's direct send (`mail.probe.ts` step 4) runs before any LibreChat chat | every direct send runs after leg 1, a LibreChat chat | **the only difference on the send path that is not an env value** |

Harness path both jobs trigger (`node_modules/qa-portfolio-harness` v0.6.10, `dist/adapters/nextcloud.adapter.js`): `up()` calls `startGreenmail` when `cfg.mail`, then `composeUp`, `waitHealthy`, `seed`, `seedMail` (`installMailApp`, then `configureMailIdentity` per identity: delete any existing account with the owner's email, create the GreenMail user, create the `Sent` mailbox, `occ mail:account:create`). `down()` keeps Nextcloud volumes unless `NEXTCLOUD_DOWN_VOLUMES=1`, which no job sets. No harness branch depends on `allowAlways` or on the lab.

Excluded as the cause: the environment, the server list, the Mail account setup, `allowAlways`, and the lab mode. None of them is on the path of the direct send, which calls the Nextcloud MCP with the owner's credential and reaches Nextcloud's `POST /index.php/apps/mail/api/outbox/{id}`.

Not excluded: the send order. In wave D the direct send that works is made before any LibreChat chat. In this job it is always made after leg 1. Nothing in the repository shows that order matters; this is open. The wave D direct-send reply is not quoted in `docs/findings/l3-wave-d.md`, so the claim that it succeeds rests on the wave D job log, not on a quoted line here.

Suite-side defect found and fixed in this commit: `LAB_MODE` was not set to `shadow-name` for this job. `src/attack-lab/modes.ts` renames `lab_mail_send` to the Nextcloud send name only in that mode, so the hostile leg's shadow tool did not exist here. The fix does not explain the setup 500 (the setup sends never touch the lab).

**Harness request (mail stack logging and the outbox 500).** Blocked on the harness until shown otherwise:
- Need: when the Mail app's outbox send fails with `500 "Could not send message"`, the cause must reach Nextcloud's log (or the harness must name it), so the suite can say why. The owner's Mail account (id 1), SMTP settings and GreenMail AUTH are already correct (run 44804893661).
- Evidence: run 44792119046 (job 136482464961, head a766fba): `POST /index.php/apps/mail/api/outbox` returns 201, then `POST /index.php/apps/mail/api/outbox/1` returns 500, same second as `sends.json` `"ok": false`. Run 44804893661 (head b675b72): the known-good send fails the same way; `loglevel` 0; `nextcloud.log` has no entry for it. `smtp-auth-probe.txt`: `235`.
- Ask: enable debug logging for the Mail app in the mail stack's Nextcloud setup, so its outbox and SMTP exceptions are written. The harness owns that setup; the suite does not change Mail app internals.
- Not asked: no retries, sleeps or changed assertions to hide the 500. The control stays a hard assertion.
- Open question for the harness owner: what differs between a send made before any LibreChat chat (wave D probe, works per the job log) and one made after leg 1 (this job, fails). If the owner approves, the suite can test that order in one commit by moving the known-good send before leg 1.

### Correction and job diff (run 44811437381, head 09e7637)

**Correction.** The "suite-side defect" in the section above is wrong. The always-allow cases do not need the lab to start in `shadow-name`: P4-MCP-META-013 switches it at run time (`/control/mode`, `tests/l3/nextcloud/always-allow-mail.cases.ts`), and APPR-002 does not use the shadow tool. Starting the lab in `shadow-name` (commit `59c4de3`) broke two checks in run 44811437381:
- P4-MCP-META-013 setup: "the list did not change as expected (hash changed false; ...)". The case's session 2 checks then passed only because the lab already served the shadow tool, so this run did not test what the case tests. The verdict is **fail**.
- Cleanup sweep: "lab mode after the sweep": actual `shadow-name`, expected `benign`.

The `LAB_MODE` line is reverted in the next commit, so the always-allow job starts benign again, as in run 44804893661 and earlier runs where META-013 passed (run 44792119046).

**Job diff, `l3 mail` (wave D) against `l3 always-allow mail` (current `.github/workflows/pr.yml`):**

| Item | `l3 mail` | `l3 always-allow mail` |
|---|---|---|
| Job env | `P4_LLM_MODE=stub`, `P4_STACK_TESTS=1`, `P4_L3_PROBE=1` | `P4_LLM_MODE=stub`, `P4_STACK_TESTS=1`, `P4_L3_SERVERS=nextcloud,lab` |
| `lab:up` | `LAB_MODE=shadow-name` (lab) | `LAB_MODE` unset (benign) |
| Steps, in order | stub up; lab up; **wave D mail probe** (`test:stack:l3:probe:mail`); cases (`test:stack:l3:mail`) | stub up; lab up; lab check on 9010; cases (`test:stack:l3:always-allow-mail`) |
| Test entry | `nextcloud/mail.e2e.ts`: `P4_MAIL=1`, approval on, mode default | `nextcloud/always-allow-mail.e2e.ts`: `P4_MAIL=1`, approval on, mode default, `LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1`, no ask or deny rule |
| Probe entry | `probe/mail.e2e.ts`: `P4_MAIL=1`, approval on, runs `mail.probe.ts` when `P4_L3_PROBE=1` | not run |
| `P4_L3_SERVERS` | unset (registered list, nextcloud and lab) | `nextcloud,lab` (same list) |
| `allowAlways` | off | on (writes `allowAlways: true` to LibreChat's config only) |
| Lab2 | started by `lab:up` (benign) | started by `lab:up` (benign) |

**Harness mail setup path (both jobs, `node_modules/qa-portfolio-harness` v0.6.10).** `NextcloudAdapter.up()` (`dist/adapters/nextcloud.adapter.js`): `startGreenmail` (GreenMail compose down, up, REST ready), `composeUp` (Nextcloud), `waitHealthy`, `seed`, `seedMail` (`installMailApp`, then `configureMailIdentity` for the owner: delete any account with the owner's address, create the GreenMail user, create `Sent`, `occ mail:account:create`), then `composeUp` (MCP). `down()` keeps the named Nextcloud volumes (`composeDown` without `-v`; `NEXTCLOUD_DOWN_VOLUMES` is set by no job). The only harness difference between the jobs is therefore the number of boots: the wave D job boots twice (probe process, then cases process) on volumes kept from the first boot, so the second boot deletes and recreates the owner's Mail account. The always-allow job boots once on fresh volumes. Nothing in the harness depends on `allowAlways`, `P4_L3_SERVERS` or lab2 for the Mail setup.

**Evidence that the boot count does not separate the working and failing sends (same run, 44811437381):**
- Wave D probe, first boot on fresh volumes: `PROBE|nc.send.reply|{"status":200,"payload":{"success":true,...,"message":"Message sent successfully"}}`, and GreenMail shows `p4l3 probe direct` at t+0 (job 136549107067).
- Always-allow job, first boot on fresh volumes: the known-good send and the warm-up both return `500 "Could not send message"` (job 136549106863, `sends.json`).

So the one concrete Nextcloud-touching difference (the second boot on kept volumes) is real, but it does not explain the failure: the failing sends happen on a first boot where wave D's direct send works. The remaining difference between those two first-boot sends is the order: the always-allow sends run after leg 1 (a LibreChat chat with the lab's `lab_echo`); the wave D probe's send runs before any chat. That is the send-order experiment, not yet run.

**Run 44811437381, per case (from `verdicts.json` printed by the job's "Print the case verdicts" step; the artifact itself could not be downloaded with the tools here):**
- P4-MCP-APPR-002: setup fails, the send returns 500. The verdicts file has the setup passes before the failure (account id 1 in the Mail API and in the send; GreenMail 0 copies).
- P4-MCP-META-013: **fail** at setup ("hash changed false"). Caused by the `shadow-name` start above, not by the product. Reverted in the next commit.
- Job result: `l3 always-allow mail` failure; all other PR jobs success at the time of the check (`l4 openclaw stub` still running).
