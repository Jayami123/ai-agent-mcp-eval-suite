# Finding: the OpenClaw stub call was blocked by one harness primitive (resolved)

Gap 3 of the L1 acceptance list: one benign stub-driven tool call through OpenClaw, with the trace asserted.

**Status: resolved.** Harness 0.6.3 added the missing primitive, and the test now runs in PR CI.

- Test: `tests/l1/openclaw-stub-tool-call.e2e.ts`. PR CI job: `l1 openclaw stub`.
- Fix: `qa-portfolio-harness` PR 65, merge commit `4650a17888564d8296fb69e0cf640b33b44bd7df`, released as tag `v0.6.3`. The
  suite pins `#v0.6.3`.
- Verified in [run 44336471743](https://github.com/Jayami123/ai-agent-mcp-eval-suite/actions/runs/44336471743), job
  `l1 openclaw stub` ([job 134914449853](https://github.com/Jayami123/ai-agent-mcp-eval-suite/actions/runs/44336471743/job/134914449853)),
  commit `7d02ce66a04325d4152bb3fe4138352d53d1b565`, success. The evidence from that run shows:
  - the stub's first request (fixture `smoke-search-001`, turn 0) offered `search_records` among the tools OpenClaw sent the
    model, directly and not through Tool Search;
  - the stub answered with `search_records` and `{"limit":5,"query":"fake-alpha"}`;
  - OpenClaw's `/v1/responses` returned HTTP 200 with one `function_call` to `search_records` with the same arguments;
  - the stub saw no second request, so OpenClaw did not try to run the call itself.

## What was wrong

With harness 0.6.2, `runTask()` threw `OPENCLAW_RUN_FAILED: POST /v1/responses returned HTTP 502` (CI run 44322429635 on
commit `ccdf100`). The stub's recorder showed why: OpenClaw offered the model only its own built-in tools, not the client tool
`search_records`. The stub answered with a call to `search_records`, OpenClaw replied `Tool search_records not found`, and the
run ended with text and no pending client tool call, so `tool_choice: required` produced the 502.

## Cause

OpenClaw 2026.10.33 enables Tool Search by default. Tool Search compacts the catalog and hides client function tools behind
`tool_search`, `tool_describe` and `dispatch_action`. The pinned docs (`docs/tools/tool-search.md` in the
`openclaw@2026.10.33` npm package) say: "Set `tools.toolSearch: false` to restore direct schemas."

## The primitive that was missing

The harness wrote the gateway config with no `tools.toolSearch` key. From 0.6.3, `openClawConfig()` writes
`tools.toolSearch: false` when `OPENCLAW_RESPONSES_API=1` and leaves the config unchanged otherwise.

## Not done

Driving the call through `tool_search`, `tool_describe` and `dispatch_action` with a longer fixture. That would test
OpenClaw's catalog path, not a plain client tool call, and it was not asked for.
