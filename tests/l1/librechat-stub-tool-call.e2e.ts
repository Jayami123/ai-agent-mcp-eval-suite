import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdapter, type AuthSession } from "qa-portfolio-harness";
import { collectContainerLogs, redact, runId, writeEvidence } from "./evidence.js";
import { lcChat, lcCreateAgent, mcpToolName } from "./librechat-client.js";
import { checkSeededText } from "./seed-check.js";
import { readStubTrace, requireStubContainer, resetStubTrace, STUB_UPSTREAM_URL, writeTraceEvidence } from "./stub-recorder.js";

// L1 gap 1: one chat through LibreChat's API makes a stub fixture call the Twenty MCP tool list_object_metadata_names.
// Chain: LibreChat agent -> LiteLLM (p4-stub, routed by P4_STUB_API_BASE) -> the stub container -> back through LibreChat
// to the real Twenty MCP. The assertions read the stub's recorder (tool name + arguments, and the tool result LibreChat
// sent back to the model). Stub mode only: no GEMINI_API_KEY, no secrets. The harness starts and stops every product.
// The stub container is started before this test (npm run stub:up) and is not touched here.

const ENABLED = process.env["P4_STACK_TESTS"] === "1";
const FIXTURE = "twenty-list-object-metadata-001";
const TOOL = "list_object_metadata_names";
const MODEL = "p4-stub";
const CHAT_TIMEOUT_MS = 180_000;

test(
  "L1 stub: LibreChat chat triggers the Twenty list_object_metadata_names tool through the stub",
  { skip: ENABLED ? false : "requires P4_STACK_TESTS=1 (PR CI stack job)", timeout: 40 * 60_000 },
  async () => {
    const id = runId();
    const dir = path.join("stack", `librechat-stub-${id}`);
    // Config is read once by the harness, so every setting goes in before the first getAdapter call.
    process.env["TWENTY_MCP"] = "1";
    process.env["P4_LLM_MODE"] = "stub";
    process.env["LIBRECHAT_MCP_PRODUCTS"] = "twenty";
    process.env["P4_STUB_API_BASE"] = STUB_UPSTREAM_URL;
    delete process.env["GEMINI_API_KEY"]; // never needed here, never present

    await requireStubContainer();
    await resetStubTrace();

    const twenty = getAdapter("twenty");
    const litellm = getAdapter("litellm");
    const librechat = getAdapter("librechat");
    let session: AuthSession | undefined;
    const secrets = (): string[] => (session ? [session.authorizationHeader] : []);
    try {
      await twenty.up();
      if (!twenty.waitMcp) throw new Error("TWENTY_ADAPTER_NO_MCP: harness Twenty adapter has no waitMcp");
      await twenty.waitMcp();
      await litellm.up();
      await librechat.up();
      session = await librechat.authenticate();

      const toolName = mcpToolName(TOOL, "twenty");
      const agentId = await lcCreateAgent(session, {
        name: "p4-l1-stub-agent",
        model: MODEL,
        tools: [toolName],
        instructions: "You are a test agent. Use the tool you are given.",
      });
      const outcome = await lcChat(session, {
        agentId,
        text: `[fixture:${FIXTURE}] List the object names.`,
        timeoutMs: CHAT_TIMEOUT_MS,
      });
      writeEvidence(dir, "librechat-outcome.json", `${redact(JSON.stringify(outcome, null, 2), secrets())}\n`);
      assert.equal(outcome.errorText, "", `LibreChat reported an error: ${redact(outcome.errorText, secrets()).slice(0, 300)}`);

      // The recorder is the oracle: what the model host was asked, and what it answered.
      const entries = await readStubTrace(FIXTURE);
      writeEvidence(dir, "stub-trace.json", `${redact(JSON.stringify(entries, null, 2), secrets())}\n`);
      const first = entries.find((e) => e.turn === 0);
      assert.ok(first, "the stub never received the first request for the fixture (fixture marker lost on the way?)");
      assert.deepEqual(first.toolCalls, [{ name: toolName, arguments: {} }], "tool name and arguments in the stub trace");

      const second = entries.find((e) => e.turn === 1);
      assert.ok(second, "LibreChat never sent the tool result back to the model (no second request in the stub trace)");
      assert.equal(second.toolResults.length, 1, "exactly one tool result was sent back");
      const verdict = checkSeededText(second.toolResults.join("\n"));
      assert.equal(verdict.outcome, "pass", `state check: ${verdict.detail}`);
    } finally {
      await writeTraceEvidence(dir);
      collectContainerLogs(dir, ["litellm", "librechat", "p4-suite-stub"], secrets());
      await librechat.down().catch((e: unknown) => console.error(`librechat down failed: ${(e as Error).message}`));
      await litellm.down().catch((e: unknown) => console.error(`litellm down failed: ${(e as Error).message}`));
      await twenty.down().catch((e: unknown) => console.error(`twenty down failed: ${(e as Error).message}`));
    }
  },
);
