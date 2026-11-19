# L3 spike S1: how LibreChat tool approval works headless

Scope: the mechanics a headless client needs to pause, read, and answer a tool approval in LibreChat. Pinned product:
LibreChat v0.8.9 (the harness `v0.6.5` pin, image digest in `docker/librechat.compose.yml`). The policy comes from the
harness knob H3 (`LIBRECHAT_TOOL_APPROVAL*` variables, see `dist/adapters/librechat-approval.js` in the harness).
Evidence: local stack runs on the build host (Nextcloud stack, stub model), and the LibreChat source in the pinned image.

## Findings

1. **A paused turn emits an event named `on_pending_action`.** The SSE data is
   `{"event":"on_pending_action","data":{"actionId", "streamId", "conversationId", "responseMessageId", "payload"}}`.
   `payload.type` is `tool_approval` for an approval pause. `payload.action_requests` lists each paused call
   (`name`, `tool_call_id`, arguments). `payload.review_configs` gives `allowed_decisions` per call.
   Default-mode decisions are `approve`, `reject`, `edit`, `respond`.
2. **A paused turn never sends the `final` event.** The L1 helper (`tests/l1/librechat-client.ts`, `lcChat`) reads until
   `final`, so it hangs on a paused turn until its timeout. The L3 helper (`tests/l3/support/approval.ts`) stops at the pause.
3. **Resume is `POST /api/agents/chat/resume`.** Body: `conversationId` (the stream id), `actionId`, `agent_id`,
   `endpoint: "agents"`, and `decisions: [{ tool_call_id, decision, reason? }]`. The decisions must cover every
   `tool_call_id` in `action_requests`, exactly once (LibreChat `packages/api/src/agents/hitl/resume.ts`). A wrong shape
   returns `400 Invalid tool approval decisions`. An accepted resume returns `200 {"status":"resuming"}`, and the stream
   continues to the next pause or the final event.
4. **`mode: default` pauses every MCP tool, not only the ones listed in `ask`.** The probe paused the read tool, which the
   policy did not name. A read-only tool needs an `allow` rule to skip the prompt.
5. **Reject works headlessly.** A rejected write returns `Blocked: <reason>` to the model as the tool result; the file
   is not written (checked over WebDAV: 404).
6. **Deny beats allow, before any prompt.** With the same write tool in both `allow` and `deny`, there was no pause, the
   tool did not run, and the Nextcloud tree was unchanged (case P4-MCP-APPR-001).
7. **An approval is per conversation.** Approve in conversation 1 and the write runs. Conversation 2 with the same tool asks
   again (case P4-MCP-APPR-006).

## Operational notes (local runs; CI is unaffected)

- Two stale states broke local runs and looked like product failures. Each is a fixture or volume left from an earlier run:
  the stub image built before a new fixture file (the stub then answers `unknown fixture id`), and product volumes created
  with an earlier run's secrets (the stack fails at auth). Fix: rebuild the stub (`npm run stub:down`, remove the image,
  `npm run stub:up`) and remove the `qa-harness-*` volumes before a run. CI builds both fresh.
- Docker Hub rate-limits anonymous pulls. The pinned Nextcloud and Mongo images were pulled by digest from
  `mirror.gcr.io`, then tagged to the pinned name; the compose files found them locally. This is a build-host workaround only.

## Decisions this spike leaves to the reviewer

- The L1 helper's hang on paused turns is not fixed here. Every L3 approval case uses the new helper.
- Approval cases that need a second user or a second conversation's identity (H2) are not covered by S1.
