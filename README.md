# ai-agent-mcp-eval-suite

An evaluation suite for AI agents that use MCP tools. It checks, with fixed inputs and recorded traces, whether an agent calls the right tools with the right arguments and whether the product state it leaves behind is correct. The suite is built on the shared [`qa-portfolio-harness`](https://github.com/Jayami123/qa-portfolio-harness), which owns product start and stop.

Status: bootstrap only. No case results yet. Plans live in `docs/plans/`.

## Install and run

Requires Node.js 22 or newer (CI runs 22 and 24).

```bash
npm ci
npm run check
```

`npm run check` runs `typecheck`, `test` and `build` in that order.

## Stub vs nightly

| Mode    | `P4_LLM_MODE` | What runs                                              | Needs a provider key |
|---------|---------------|--------------------------------------------------------|----------------------|
| stub    | `stub` (default) | Scripted fake model server, unit tests, determinism checks | No                   |
| nightly | `nightly`     | Real Gemma through LiteLLM on a schedule, from GitHub Actions only | Yes (`GEMINI_API_KEY`, Actions secret) |

## Stack tests (L1)

Three tests run real products through the harness. The LibreChat stub test runs in PR CI and needs Docker. The OpenClaw stub test is written but skipped by name until the harness gains one primitive (`docs/findings/l1-openclaw-stub-call.md`):

```bash
npm run build
npm run stub:up                      # fixture stub as a container on qa-harness-p4, 127.0.0.1:8787
P4_STACK_TESTS=1 npm run test:stack:librechat   # also needs PRODUCTS_ROOT with the Twenty fork
P4_STACK_TESTS=1 npm run test:stack:openclaw
npm run stub:down
```

The Gemma test (`npm run test:nightly`) goes LiteLLM, LibreChat, Twenty MCP and runs only in the nightly workflow. See `docs/plans/2026-11-18-suite-l1-gaps.md`.

## Contact

Maintained by the owner of this repository (Jayami Hettigoda).
