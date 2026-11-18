import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getAdapter, type AuthSession } from "qa-portfolio-harness";
import { collectContainerLogs, runId, writeEvidence } from "./evidence.js";
import { readStubTrace, requireStubContainer, resetStubTrace, STUB_UPSTREAM_URL } from "./stub-recorder.js";

// L1 gap 3: one benign stub-driven tool call through OpenClaw, with the trace asserted.
// Chain: OpenClaw gateway POST /v1/responses (harness runTask) -> LiteLLM (p4-stub, routed by P4_STUB_API_BASE) -> the stub
// container. The tool is a client-side function tool, so OpenClaw returns the call as a function_call item and executes
// nothing. The fixture is chosen by the [fixture:<id>] marker in the task text (the X-P4-Fixture header does not pass
// through OpenClaw). Stub mode only: no GEMINI_API_KEY, no secrets.

const ENABLED = process.env["P4_STACK_TESTS"] === "1";
const FIXTURE = "smoke-search-001";
const EXPECTED = { name: "search_records", arguments: { query: "fake-alpha", limit: 5 } };

test(
  "L1 stub: OpenClaw run returns the stub's tool call and the trace matches",
  { skip: ENABLED ? false : "requires P4_STACK_TESTS=1 (PR CI stack job)", timeout: 30 * 60_000 },
  async () => {
    const dir = path.join("stack", `openclaw-stub-${runId()}`);
    process.env["P4_LLM_MODE"] = "stub";
    process.env["P4_STUB_API_BASE"] = STUB_UPSTREAM_URL;
    process.env["OPENCLAW_RESPONSES_API"] = "1";
    delete process.env["GEMINI_API_KEY"];

    await requireStubContainer();
    await resetStubTrace();

    const litellm = getAdapter("litellm");
    const openclaw = getAdapter("openclaw");
    let session: AuthSession | undefined;
    try {
      await litellm.up();
      await openclaw.up();
      session = await openclaw.authenticate();
      if (!openclaw.runTask) throw new Error("OPENCLAW_ADAPTER_NO_RUNTASK: harness OpenClaw adapter has no runTask (needs v0.6.2)");

      const result = await openclaw.runTask(`[fixture:${FIXTURE}] Search the records for fake-alpha.`, {
        tools: [
          {
            name: "search_records",
            description: "Search fake records by query.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, limit: { type: "integer" } },
              required: ["query"],
            },
          },
        ],
        requireTool: true,
        timeoutMs: 180_000,
      });
      writeEvidence(dir, "openclaw-trace.json", `${JSON.stringify({ status: result.status, responseId: result.responseId, toolCalls: result.toolCalls }, null, 2)}\n`);

      // OpenClaw's trace: the function_call it returned.
      assert.equal(result.toolCalls.length, 1, "one tool call in the OpenClaw trace");
      assert.equal(result.toolCalls[0]?.name, EXPECTED.name);
      assert.deepEqual(result.toolCalls[0]?.arguments, EXPECTED.arguments);

      // The recorder: what the stub was asked and answered.
      const entries = await readStubTrace(FIXTURE);
      writeEvidence(dir, "stub-trace.json", `${JSON.stringify(entries, null, 2)}\n`);
      const first = entries.find((e) => e.turn === 0);
      assert.ok(first, "the stub never received the first request for the fixture");
      assert.deepEqual(first.toolCalls, [EXPECTED]);
    } finally {
      collectContainerLogs(dir, ["litellm", "openclaw", "p4-suite-stub"], session ? [session.authorizationHeader.replace(/^Bearer\s+/i, "")] : []);
      await openclaw.down().catch((e: unknown) => console.error(`openclaw down failed: ${(e as Error).message}`));
      await litellm.down().catch((e: unknown) => console.error(`litellm down failed: ${(e as Error).message}`));
    }
  },
);
