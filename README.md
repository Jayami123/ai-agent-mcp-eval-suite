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

Three tests run real products through the harness. The two stub tests (LibreChat and OpenClaw) run in PR CI and need Docker:

```bash
npm run build
npm run stub:up                      # fixture stub as a container on qa-harness-p4, 127.0.0.1:8787
P4_STACK_TESTS=1 npm run test:stack:librechat   # also needs PRODUCTS_ROOT with the Twenty fork
P4_STACK_TESTS=1 npm run test:stack:openclaw
npm run stub:down
```

L4 (the OpenClaw cases) starts one stack for all 62 tests, with the fixture stub already up:

```bash
npm run build
npm run stub:up
npm run l4:up            # LiteLLM, OpenClaw with the mock Telegram channel, and the mock channel container (about 8 minutes the first time)
npm run test:stack:l4    # serial; each case resets OpenClaw's state first
npm run l4:down
npm run stub:down
```

Cases that replay advisories need files kept outside the repo: set `P4_PRIVATE_FIXTURES_DIR` to a directory holding `p4-oc-adv-NNN.json`. Without it those cases skip with a named reason. Findings are in `docs/findings/l4-openclaw.md`.

The Gemma test (`npm run test:nightly`) goes LiteLLM, LibreChat, Twenty MCP and runs only in the nightly workflow. See `docs/plans/2026-11-18-suite-l1-gaps.md`.

## Recorded deviations (L4, OpenClaw lane)

Recorded in `docs/plans/2026-11-18-l4-openclaw.md`, section 1. Each names the standard alternative there.

- **Telegram is the WhatsApp-style mock channel.** The master plan routes WhatsApp-style traffic through a mock channel with no real WhatsApp numbers. L4 models it as a Telegram Bot API-shaped server, because OpenClaw's own QA channel is not in the release image and its bundled Telegram channel accepts a custom API root. Approved by the reviewer.
- L4 tests live in `tests/l4/`, not `tests/openclaw/`.
- L4 stub fixtures live in `src/stub/fixtures/oc-*.json`.
- The L4 stack is started once by a script, not by each test.

## Contact

Maintained by the owner of this repository (Jayami Hettigoda).
