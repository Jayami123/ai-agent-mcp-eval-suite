# Plan: close the three L1 acceptance gaps

Branch: `feat/2026-11-18-suite-l1-gaps`. Builds on `docs/plans/2026-11-18-suite-l1-stub-gemma.md`. Needs harness 0.6.2
(PR 64 in `qa-portfolio-harness`): `P4_STUB_API_BASE`, `LIBRECHAT_MODELS`, `OPENCLAW_RESPONSES_API` and `runTask`.

## Gaps and tests

| Gap | Test | Chain | Where it runs |
|---|---|---|---|
| 1. LibreChat stub tool call | `tests/l1/librechat-stub-tool-call.e2e.ts` | LibreChat agent, LiteLLM `p4-stub`, stub container, back through LibreChat to the Twenty MCP tool `list_object_metadata_names` | PR job `l1 librechat stub` (no secrets) |
| 2. Gemma through LibreChat | `tests/l1/gemma-tool-call.e2e.ts` (rewritten) | LibreChat agent, LiteLLM `p4-nightly`, Gemma, Twenty MCP | nightly workflow only |
| 3. OpenClaw stub call | `tests/l1/openclaw-stub-tool-call.e2e.ts` | harness `runTask` (`POST /v1/responses`), LiteLLM `p4-stub`, stub container | Skipped by name: blocked by a harness primitive, see `docs/findings/l1-openclaw-stub-call.md`. No CI job until unblocked |

## Design

- **Stub as a container.** `docker/stub.compose.yml` runs the stub on `qa-harness-p4` with the alias `p4-stub`, published on `127.0.0.1:8787` only. LiteLLM reaches it at `http://p4-stub:8787/v1` (`P4_STUB_API_BASE`). `npm run stub:up` and `stub:down` start and stop it; the tests only check it is there. Base image pinned by digest. Standard alternative named: a host process on `host.docker.internal`, rejected because it needs a non-loopback bind.
- **Recorder.** The stub keeps an in-memory trace served at `GET /__trace` (cleared with `DELETE`): per request, the fixture, turn, tool results received, and tool calls returned. Tests assert from it (tool name and arguments, and the tool result LibreChat sent back).
- **Streaming (supersedes D4).** LibreChat and OpenClaw always stream, so the stub now answers `stream: true` with server-sent events in the OpenAI chunk format. The bytes still depend only on fixture and turn. The old "stream returns 400" test is replaced by streaming tests.
- **Fixture selection.** The `X-P4-Fixture` header does not survive LibreChat or OpenClaw, so these tests use the `[fixture:<id>]` marker. The stub now also finds the marker in array-of-text-parts message content.
- **Case IDs.** No case ID is added or closed. The new fixture id `twenty-list-object-metadata-001` is a fixture name, not a ledger case.
- **Rate limits (gap 2).** A 429 after the 15 s and 45 s retries is `partial`. Any other error is `fail`.

## Unverified at plan time

The sandbox that wrote this has no Docker. The LibreChat agent API calls (`/api/agents`, `/api/agents/chat`, the stream route, `/api/messages`) follow the public v0.8.7 source. Nothing ran against live containers until CI did.
