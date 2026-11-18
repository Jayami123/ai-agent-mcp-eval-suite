# Finding: the OpenClaw stub call is blocked by one harness primitive

Gap 3 of the L1 acceptance list needs one benign stub-driven tool call through OpenClaw, with the trace asserted.
Status: **blocked**, with a named missing primitive. The test `tests/l1/openclaw-stub-tool-call.e2e.ts` is written and is
skipped with the blocker text (never a silent pass).

## What works (verified in CI run 44322429635 on commit `ccdf100`)

With harness `9f93892` (0.6.2 content): LiteLLM starts with `P4_STUB_API_BASE` pointing at the stub container, OpenClaw
starts with `OPENCLAW_RESPONSES_API=1`, `runTask()` reaches `POST /v1/responses`, the gateway calls LiteLLM, and LiteLLM
calls the stub twice (two `POST /v1/chat/completions -> 200` in the stub log).

## What fails

`runTask()` throws `OPENCLAW_RUN_FAILED: POST /v1/responses returned HTTP 502`.

The stub's recorder shows why. Request 1 (fixture `smoke-search-001`, turn 0) offered the model only OpenClaw's own
tools: `apply_patch, dispatch_action, edit, exec, heartbeat_respond, ls, message, openclaw, process, read,
sessions_yield, tool_describe, tool_search, write`. The client tool `search_records` was not among them. The stub answered
with a call to `search_records`. OpenClaw replied to the model with the tool result `Tool search_records not found`
(request 2, turn 1). The run then ended with text and no pending client tool call, so the gateway applied
`tool_choice: required` and returned 502.

## Cause

OpenClaw 2026.10.33 enables Tool Search by default. Tool Search compacts the catalog, and client function tools are
hidden behind `tool_search`, `tool_describe` and `dispatch_action` instead of being sent to the model as direct schemas.
The pinned docs (`docs/tools/tool-search.md` in the `openclaw@2026.10.33` npm package) say: "Set `tools.toolSearch:
false` to restore direct schemas."

## Missing primitive (exact)

The harness writes the gateway config in `openClawConfig()` (`src/adapters/openclaw-env.ts`) with no `tools.toolSearch`
key. When `OPENCLAW_RESPONSES_API=1`, it must also write:

```json
{ "tools": { "toolSearch": false } }
```

merged with the existing `tools.exec` block, so client function tools reach the model as direct schemas. This is a
harness change (a 0.6.3 patch) plus a unit test. The suite cannot do it: it must not edit the harness or write the
gateway config itself.

## To unblock

1. Harness PR: add `tools.toolSearch: false` to `openClawConfig()` when `responsesApi` is true, with a unit test.
2. The owner tags it. The suite repins.
3. In the suite, delete `BLOCKER` in `tests/l1/openclaw-stub-tool-call.e2e.ts` and restore the `l1 openclaw stub` job (see
   the removed block in the history of `.github/workflows/pr.yml`).

Not tried: driving the call through `tool_search`, `tool_describe` and `dispatch_action` with a longer fixture. That
would test OpenClaw's catalog path, not a plain client tool call, and it was not asked for.
