# Plan: PR gate split, measured cases in the nightly, SUPP-004 wording

Date: 2026-11-21. Branch: `chore/2026-11-21-ci-gates-nightly`. Status: draft, written before the build.

## Goal

1. Make PR CI faster. The L4 OpenClaw job ran all 62 cases (about 70 minutes). The PR gate runs a fast subset. The full 62 move to the nightly workflow, unchanged in behaviour.
2. Run the measured cases in the nightly Gemma lane, one lane at a time (shared 16K tokens-per-minute free-tier limit). PR gates stay stub-only.
3. Describe SUPP-004 as a config-level check wherever it appears.
4. No new test cases. No new case IDs. Case IDs come from the ledger only.

## Decisions

- **One switch, one list.** `P4_L4_SCOPE=gate|full` is read by the case runner (`tests/l4/support/case.ts`). The 12-case gate list is `tests/l4/gate.ts`. Nothing is duplicated. Unset means `full`, so local runs are unchanged.
- **Gate choice.** One or two core cases per family (ADV, APPR, INJ, MEM, MSG, REL, SKILL), none measured, none restarting OpenClaw (REL-002, REL-004, REL-005 are left out), none needing a private fixture or the private-fetch host. Each entry has its reason in `tests/l4/gate.ts`, and `docs/ci.md` repeats the list.
- **Nightly full set.** A new job `l4-openclaw-full` in `nightly.yml` runs `npm run test:stack:l4` with `P4_L4_SCOPE=full`, stub model, no key. It runs beside the Gemma lanes because it uses no quota.
- **Measured lanes.** The nightly Gemma lanes run one after another. The L1 smoke runs first, then `gemma-measured-mattermost`. Each lane waits for the one before it. `GEMINI_API_KEY` comes only from the `nightly-gemma` GitHub Environment, and no job prints it.
- **Measured trial record.** A trial is written in the existing stats format (`src/stats/schema.ts`, `TrialRecord`) to `evidence/nightly/<id>/trial-<n>.json`, and validated by `validateTrial` before it is written. A measured verdict is a measured result, not a failed gate. Only an infrastructure error turns the lane red. Quota (429 or RESOURCE_EXHAUSTED) is `partial`.
- **Pacing.** At least one trial per minute (`TRIAL_SPACING_MS`), which keeps the lane under the 16K TPM limit between trials. The real spend per trial is not measured yet. L5 should read it from the usage fields once they are captured.

## What is wired, and what is not (stated plainly)

Wired now:

- **P4-MCP-INJ-013** (L3 Mattermost, mode M). Its nightly branch sends the real model (`p4-nightly`) a plain prompt with no stub fixture. The gate is the channel: the injected write must not land. Every write is rejected by the approval policy. The trial's `toolCalls` hold what the model tried.

Not wired in this change:

- **The seven L4 measured cases** (APPR-006, INJ-003, INJ-005, INJ-006, INJ-008, MEM-005, MSG-011). Their bodies read the stub's request log (`traceAll`, `results`, `calls`, `promptHits`, which come from the stub recorder). Under a real model those reads are empty, so a nightly run would measure nothing. Wiring them needs a recorder that does not depend on the stub: a LiteLLM callback that writes the model's requests and tool calls, read by the L4 oracles. That is a separate change, listed in `docs/ci.md`.
- **The other 28 L3 M-mode cases** (INJ-001 to INJ-017, FLOW-*, META-001/006/007, and the rest). Their bodies send the stub fixture marker and have no nightly branch. They run in the stub gate only, as before.

## Acceptance

- `npm run check` exits 0 with 0 failures.
- The PR CI is green. The L4 gate job time is reported from the run.
- One `workflow_dispatch` of `nightly-gemma` on this branch is run. The run id and each lane's result are reported. If the Environment does not allow this branch, that is reported instead.
- `README.md` and `docs/ci.md` say what the PR gate runs (stub, fast subset) and what the nightly runs (full L4 plus the measured Gemma lanes).

## Risks

- The nightly Gemma lane has not run this code before. It may fail on the first real call. The lane reports that as a red job, not as a measured fail.
- The `nightly-gemma` Environment may restrict deployment branches. If so, the Gemma lanes cannot run from this branch, and the report says so.
- Gate timing is measured in CI, not here. Docker here cannot run the L4 stack in time to be useful.

## Deviation from CLAUDE.md

CLAUDE.md asks for a plan-only draft PR and the reviewer's approval before building. This request asked for the work to be completed in one run, so the build continues after this commit. The plan stays in the PR for the reviewer to reject.
