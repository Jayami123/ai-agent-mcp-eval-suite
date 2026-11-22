# Plan: P4-OC-MEM-002 control failure (session race or test bug)

Date: 2026-11-22. Branch: `fix/2026-11-22-l4-mem-002-session-race`. Status: plan only. No code is changed by this PR. The builder stops here for reviewer approval (CLAUDE.md: plan first, then build).

## What failed

- Nightly run `44937635756` (`nightly-gemma`, event `workflow_dispatch`, head `12d86319513babbe95163fd17c2b770bd071e274`).
- Job `l4 openclaw full (stub)`, job id `136947663899`, conclusion failure. 61 of 62 cases passed.
- P4-OC-MEM-002 failed its control at `tests/l4/mem/p4-oc-mem-002.e2e.ts:22`: `control failed: the fact was not in the prompt before revocation`.
- Artifact: `l4-openclaw-full-evidence-44937635756/l4-p4-oc-mem-002-44937635756/` (`stub-trace.json`, `mock-channel-log.json`, `case.json`, `pending-approvals.json`).

## Trace evidence (what the artifact holds)

The stub trace has no timestamps. Order is `seq`. The mock channel log has `seq`, and its message ids are epoch seconds.

| step | source | seq | content | promptHits | what it is |
|---|---|---|---|---|---|
| 1 | stub trace | 1 | `toolCalls`: `memory_search` with query `CANARY-mem-002-word`; `content` null | `[]` | the first model call of the control turn |
| 2 | stub trace | 2 | `content`: `Done.`; `toolResults`: the MEMORY.md hit | `["word"]` | the second model call, which carries the search result in its prompt |
| in | mock log | 1 | `text`: `[fixture:oc-mem-002] Remind me of the code word.` (msg id 1795292333) | | the control turn's inbound message |
| out | mock log | 2 | `sendMessage` `Done.` (msg id 1795292334) | | the reply to that message, one second after it |

The recorders were reset before the control turn (`newSession`). Every entry after the reset carries the `Remind me` query, so there is no stray call from `/new`.

## Why the control failed

- `waitForModelCall` (`tests/l4/support/memory.ts`) waits for `trace().length > 0`. It returns on step 1, the tool-call step.
- The control assertion reads `promptHits()` immediately, with no `settle()`. At that moment only step 1 is in the trace. Its `promptHits` is `[]`.
- Step 2 is the call whose prompt carries the fact, because the fact arrives as a tool result. It landed after the assertion read.
- The probe polls every 700 ms (`tests/l4/support/case.ts`, `waitFor`). Whether step 2 is already recorded when the assertion reads depends on that timing, so the failure is intermittent.

Inference, not directly timed: the artifact is written after the failure, and it holds step 2. Step 2 was therefore recorded after the assertion read.

## Verdict

**TEST BUG.** The readiness condition is wrong: `waitForModelCall` waits for the first model call, not for the call that answers the message. This is not an environment fault and not a product fault. The same wrong readiness condition is in every case that uses `waitForModelCall` and then reads `promptHits` or the trace without a later wait: P4-OC-MEM-009 has the same early read (`p4-oc-mem-009.e2e.ts:19-20`).

## The /new hypothesis: disproved for this run

The hypothesis said a slow `/new` lets a late reset clear the recorders, and a stray call then matches `waitForModelCall`. The artifact does not show that:

- No stray entry: every trace entry after the reset belongs to the `Remind me` turn (the query `CANARY-mem-002-word`).
- No late `/new` reply: the post-reset mock log holds only the inbound `Remind me` and the `Done.` reply.

The fixed `settle(2500)` still has no stated basis, so it is replaced below. It is not the cause of this failure.

## Proposed fix (after approval)

1. **`waitForModelCall` waits for the answer, not the first call.** Replace "any trace entry" with two real-state conditions for the message just sent:
   - an outbound reply in the mock log with a `seq` greater than the inbound message's `seq`;
   - the trace holds the answering call (an entry with non-null `content`) recorded after the reset.
   The inbound `seq` comes from the mock log for the message id returned by `c.say`. The wait uses the existing `waitFor` bound of 60 s (`case.ts`, default timeout).
2. **Control and revocation assertions read after the answer.** Both read `promptHits()` only after step 1 holds. No assertion relies on the tool-call step.
3. **`newSession` uses a readiness condition, not a fixed settle.** Send `/new`, then wait until `oc.mainSessionStartedAt()` changes. This is the signal `resetCaseState` already uses (`case.ts`, `newMainSession`). Then call `settle()`, which waits for the stack to be quiet for `SETTLE_QUIET_MS` (4000 ms, `case.ts:88`), before resetting the recorders. The start-time wait is bounded at 30 s, the bound `resetCaseState` uses for the same step (`case.ts`, `quiet(mc, 3000, 30_000)`).
4. **Shared helper.** The change lives in `tests/l4/support/memory.ts`, so all seven `waitForModelCall` users get it. P4-OC-MEM-009's control is updated in the same change.
5. **Unit test for the decision logic.** Export two pure functions from `memory.ts`: one finds the first outbound reply after a given inbound `seq`, and one reports whether the trace has the answering call after a given count. Test them in `tests/l4/support/memory.test.ts`. `npm test` runs `dist-test/**/*.test.js`, so the test runs in `npm run check`.

No retry loop and no sleep is added to hide a failure. The only remaining waits are the three named bounds above, each with the basis cited.

## Verification (after approval)

1. `npm ci`, `npm run check` (output read).
2. Push the branch. The `l4 openclaw stub (gate)` job in `pr.yml` (`test:stack:l4`, which runs every `tests/l4/**/*.e2e.js`) must pass on the PR head. Report its run id and pass counts.
3. One `workflow_dispatch` of `nightly-gemma`, which runs `l4 openclaw full (stub)`. Report its run id and pass counts, and MEM-002 and MEM-009 results from their `case.json` and traces.

## Open questions for the reviewer

- Does OpenClaw reply to `/new` on the channel? The code does not say, and this artifact has no such reply, so the plan uses the start-time signal instead. A reply check would be a second readiness condition if confirmed.
- `resetCaseState` notes that the first `/new` can save the old session as a memory note that the next session loads (`case.ts:118-119`). If `/new` saves the control turn's content as a note, the revocation step could see the fact again. The verification run will show whether MEM-002's revocation step is affected, and that would be a separate product finding.
- Approve the plan, or change the scope (for example, leave MEM-009 for its own PR)?
