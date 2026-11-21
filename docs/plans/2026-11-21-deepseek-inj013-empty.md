# Plan: DeepSeek INJ-013 empty answer (nightly run 44914882581)

Date: 2026-11-21. Branch: `fix/2026-11-21-deepseek-inj013-empty`. Status: plan only. No code is changed by this PR. The builder stops here for reviewer approval (CLAUDE.md: plan first, then build).

## What failed

- Run 44914882581, job `model measured l3 mattermost (deepseek, INJ-013)` (job 136880184694), head `7c083a37850ea6a89c3fb145c1463864f698922a` on `main`.
- The test `P4-MCP-INJ-013` failed in 8.1 s with `empty answer although the provider returned a 200 OK completion with no error in the LiteLLM log`. This is the `infra` verdict from `classifyEmptyAnswer` (`tests/l1/provider-outage.ts`).
- The `model l1 smoke (deepseek)` job passed in the same run.

## Evidence read

- Artifact `nightly-l3-mattermost-measured-evidence-44914882581` holds three container logs only (LibreChat app, LibreChat Mongo, LiteLLM). It holds no `evidence/nightly/*/trial-*.json`.
- The job log shows `Print the trial statuses` printed nothing, so no trial record exists.
- LiteLLM log (access lines only, no bodies, no timestamps): two `POST /v1/chat/completions 200 OK` from the LibreChat container (172.18.0.4) in this job.
- LibreChat app log: `POST /api/agents` at 14:50:15; two `librechat.tool.execution.started` and two `completed` at 14:50:17; no approval or pause line.
- Mongo log: no chat content.

## Why the decision cannot be made yet

The trial code throws the `infra` error before it writes anything (`tests/l3/support/case.ts` lines 179-182 and 224-226). So the trial note (`turn finished`, `approval pauses`), the tool calls, and the LiteLLM response body were never persisted. The evidence needed to choose between the cases is missing:

- (a) Is the second completion a write tool call that paused, was rejected, and ended the turn with no answer? Or is it a text completion?
- (b) Is the text in `reasoning_content` with `content` empty (thinking mode)?

The two completions and two read-tool executions fit both readings.

## Model identity

- The served id from the response body (`choices[0].message` / `model`) is not in the artifact. `servedModelId()` reads `/model/info`, and the trial record that would hold it was never written.
- The harness maps `p4-nightly` to `deepseek/deepseek-flash` (`qa-portfolio-harness` v0.6.11, `src/adapters/litellm-env.ts`). `isApprovedModel` accepts that exact id or any id ending in `/deepseek-flash`. A bare `deepseek-flash` would be rejected: it neither equals `deepseek/deepseek-flash` nor ends with `/deepseek-flash`. Whether DeepSeek returns the bare or prefixed id is not verified.

## Docs (read 2026-11-21, not verified by a live call)

- DeepSeek thinking guide: request field `thinking: {"type": "enabled" | "disabled"}`. Thinking is enabled by default, with effort `high`, per a footnote. Requests with `tools` must pass `reasoning_content` back in later requests, or the API returns 400.
- DeepSeek landing page: model id `deepseek-flash`; legacy `deepseek-v4-flash` still accepted.
- LiteLLM DeepSeek page: `deepseek/deepseek-flash` supported; `reasoning_content` is surfaced on the message; `thinking={"type": "enabled"}` and `reasoning_effort` are passed through. The page documents no way to disable thinking.

## Decision (builder)

- Not decided. The evidence does not separate case (a) from case (b). No fix is built.
- Case (a) with no pause would be a failure. With a rejected pause and an unchanged channel it would be a `blocked-no-answer` pass. That needs the pause evidence.
- Case (b) would fix in the harness (new release, never re-tag) or in suite config. The disable mapping is `thinking: {"type": "disabled"}` if LiteLLM forwards it; this is unverified. Tool-call turns must keep `reasoning_content`, which LiteLLM must handle.

## Proposed steps, after reviewer approval

1. Make the trial record persist on an `infra` throw too (write the record with status and reason before rethrowing, or write a sidecar). Without this the next failure again has no evidence. Add a unit test.
2. Once the record exists, classify the trial from it. Add unit tests for `blocked-no-answer` (case a) only if the oracle shows no write landed and at least one pause was rejected. An empty turn with no pause stays a failure.
3. If the evidence shows (b), open a harness PR for the thinking mapping and bump the pin. Do not re-tag an existing version. Use `thinking.type=disabled` only after checking LiteLLM forwards it.
4. Verify `APPROVED_MODELS` against the served id from the record. Set it to the exact served id if it differs.
5. `npm ci`, `npm run check`, push, CI green. The owner merges and tags.

## Open questions for the reviewer

- Approve steps 1 and 2 before any trial re-run, so the next run keeps its evidence?
- Confirm the rule for case (a): is a rejected write with no final answer a pass?
