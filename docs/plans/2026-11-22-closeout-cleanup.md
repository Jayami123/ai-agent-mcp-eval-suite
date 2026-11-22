# Plan: closeout cleanup (answer text, test conventions, served model id)

Date: 2026-11-22. Branch: `chore/2026-11-22-closeout-cleanup`. The owner waived a separate plan PR for this change, so this plan is the first commit of the draft PR, and the build follows in the same PR.

## Scope

1. **Answer text in the trial record.** `tests/l3/support/turn-evidence.ts` writes `finalMessage.text` from the top-level `text` field only. The answer for a turn can sit in a content part of type `text` (run 44927082500, INJ-013: top-level `text` `""`, a `text` part of 1,584 characters). The verdict already reads the answer through `messageText` (`tests/l3/support/approval.ts`), which falls back to the content parts. The record must hold the same text the verdict used. Change: `text: messageText(m)` in `toTurnEvidence`. Test: a unit test for an answer held only in a content part, and one for a `text` field that is set.
2. **Test conventions for substitution.** Document when a suite uses `[var:name=value]` markers and when it uses `{{bind:NAME}}` bindings. Cite the actual call sites: `tests/l3/` uses of `[var:`, and `src/stub/bindings.ts` for `bind:`. The existing location for test conventions is `docs/stub-markers.md`, which already covers the markers. Extend it; do not add a new file.
3. **DeepSeek served model id.** `APPROVED_MODELS` (`src/stats/config.ts`) lists `deepseek/deepseek-flash`. Read the id LiteLLM served from the latest `nightly-gemma` run's recorded response metadata, and check it with `isApprovedModel`. If it does not match, fix the list and cite the run. Keys are never printed.

## Out of scope

- No case files under `tests/l3/<product>/` change.
- The harness pin does not change.

## Verification

- `npm ci`, `npm run check` (output read).
- Push the draft PR head and watch CI to completion. Report the run id and the result.

## Open questions for the owner

- None. If the nightly record has an empty `servedId` (partial records write `""` by design, `tests/l3/support/case.ts`), the served id is taken from a non-partial trial of the same run, and the result is reported as unknown if no non-partial trial exists.

## Results

- **Served model id (item 3).** Nightly run `44983411023` (`nightly-gemma`, head `686c24d`). Ten trial records in `nightly-l3-mattermost-measured-evidence-44983411023/nightly/P4-MCP-INJ-013/` (trial-0 to trial-9 with a non-empty `servedId`) hold `model.alias` `p4-nightly` and `model.servedId` `deepseek/deepseek-flash`. `isApprovedModel("deepseek/deepseek-flash")` returns true against `APPROVED_MODELS` (`src/stats/config.ts`). The list needed no change. Keys were never read.
- **Answer text (item 1).** `toTurnEvidence` writes `messageText(m)`. Three unit tests in `tests/l3/turn-evidence.test.ts` cover an answer held only in a content text part, a set top-level text, and a turn with no text.
- **Conventions (item 2).** `docs/stub-markers.md` now states when a suite uses `[var:]` and when it uses `{{bind:NAME}}`, with the call sites, and the whole-fixture marker rule.
