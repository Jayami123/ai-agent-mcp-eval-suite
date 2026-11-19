# L3 always-allow and pinning findings (harness v0.6.7)

Scope: P4-MCP-META-002, META-004, META-008 and META-011 (L3 plan ledger, `docs/plans/2026-11-18-l3.md`). IDs are the ledger's; none added or renumbered. APPR-002 and META-013 are not built here: they need the Nextcloud mail stack, which is on the unmerged wave D branch.

Status: first live runs. Evidence is from CI (job `l3 always-allow`, run 44600052996, head `a0ca417`). One run is one observation. A finding is only confirmed when a second run shows the same result.

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

Reproduced once in run 44600052996. Setup was asserted first in each case: the choice was stored and the change was served.

- **P4-MCP-META-002**: after the rug pull (new description, new `bcc` parameter on `lab_echo`), the same conversation ran a call carrying `bcc` with no approval asked. Lab log: one call, parameters `bcc,text`. Pauses: 0. Snapshot diff: description and input schema changed.
- **P4-MCP-META-004** (path 1, same conversation): after a hash change, a `lab_echo` call ran with no approval asked. Paths 2 (new conversation) and 3 (new login) asked for approval and ran nothing.
- **P4-MCP-META-008**: after a description-only drift mid-session, the same conversation ran a `lab_echo` call with no approval asked. Snapshot: the hash changed and the served description differs from the pin.

Classification: **PRODUCT BUG** (candidate, one run). The cases record it as an expected defect: `expectedDefect()` passes while the silent run reproduces and fails once it stops reproducing, so the annotation is removed when the host is fixed. Confirm on a second run before treating it as settled.

## Test bugs found and fixed in this PR

- **TEST BUG**: the "fixture delivered" check looked for turn 0. The padded continuation fixtures serve their call at a later turn, so the check failed although the stub had served the call. Now any served turn counts, and the served turns are noted.
- **TEST BUG (stub)**: the stub refused any continued chat, because the earlier leg's marker was still in the history, so every later leg failed before the model was called. The stub now takes the fixture from the latest user message (`src/stub/server.ts`). Unit tests cover this and the same-message refusal.
- **TEST BUG (leak check)**: walked a directory that does not exist. It now walks `evidence/`.

## Open items

- **P4-MCP-META-011 (inconclusive)**: lab2's tool did not pause and did not run. The stub may not have served the tool call. The served turns are now noted, so the next run shows whether it did. No finding is recorded for this case yet.
- **Probe output**: the per-case verdicts are printed to the job log (new step, "Print the case verdicts"), so no artifact download is needed.
- **snap.diffLogged**: the suite logs the diff it computes from the served list. The host's own log is not observable from here; that limit is stated, not assumed away.

## Deviations from the plan

- Lab2 is attached at boot, not hot-plugged into a running chat. "Connect mid-chat" is tested as first use of lab2's tool in the same conversation through a new agent. A true runtime connect is not available in this host.
- The pin moves v0.6.5 → v0.6.7 from main (v0.6.6 exists only on the unmerged wave D branch).
- The lab2 healthcheck targets its own sink port (9014). The image's default check targets 9012, the first lab's port.
