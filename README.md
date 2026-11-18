# ai-agent-mcp-eval-suite

An evaluation suite for AI agents that use MCP tools. It checks, with fixed inputs and recorded traces, whether an agent calls the right tools with the right arguments and whether the product state it leaves behind is correct. The suite is built on the shared [`qa-portfolio-harness`](https://github.com/Jayami123/qa-portfolio-harness), which owns product start and stop.

Status: bootstrap only. No case results yet. Plans live in `docs/plans/`.

## Install and run

Requires Node.js 20 or newer.

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

## Contact

Maintained by the owner of this repository (Jayami Hettigoda).
