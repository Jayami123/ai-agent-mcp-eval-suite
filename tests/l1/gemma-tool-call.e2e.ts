import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdapter, type AuthSession } from "qa-portfolio-harness";
import { collectContainerLogs, redact, runId, writeEvidence } from "./evidence.js";
import { lcChat, lcCreateAgent, mcpToolName, type LcChatOutcome } from "./librechat-client.js";
import { classifyGemmaOutcome, isRateLimited, type GemmaStatus } from "./gemma-classify.js";

// L1 smoke: a real model (Gemma, LiteLLM alias p4-nightly) calls one real Twenty MCP tool THROUGH LibreChat.
// Chain: LibreChat agent -> LiteLLM (p4-nightly -> Gemma) -> back through LibreChat to the Twenty MCP server.
// LibreChat talks to LiteLLM only; the Gemini key reaches LiteLLM and nothing else.
// Runs only in the nightly workflow. Never uses a fixture header or marker (the stub path is separate).
// Never asserts on reply text. Never prints the key, a bearer token or any header value.
// Target is list_object_metadata_names only. Trajectories through execute_tool, learn_tools or get_tool_catalog are
// deferred to Lane 2.

const ENABLED = process.env["P4_LLM_MODE"] === "nightly" && Boolean(process.env["GEMINI_API_KEY"]);
const MODEL_ALIAS = "p4-nightly";
const TWENTY_LIST_TOOL_NAME = "list_object_metadata_names";
const SERVER = "twenty";
// Rate limits (429 or RESOURCE_EXHAUSTED): retry the whole chat after 15 s, then 45 s. Still limited = partial.
const RETRY_DELAYS_MS = [15_000, 45_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const CHAT_TIMEOUT_MS = 240_000;
const DID_NOT_COMPLETE = "run did not complete";

type Status = GemmaStatus | "partial"; // "partial" is also the initial value until the run completes

interface E2eRecord {
  status: Status;
  runId: string;
  model: string;
  path: string;
  listTool: string;
  attempts: number;
  trajectory: Array<{ name: string; arguments: unknown }>;
  errorExcerpt: string | null;
  stateCheck: string;
  reason: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test(
  "L1 smoke: Gemma calls list_object_metadata_names through LibreChat (p4-nightly)",
  {
    skip: ENABLED ? false : "requires P4_LLM_MODE=nightly and GEMINI_API_KEY (nightly workflow only)",
    timeout: 40 * 60_000,
  },
  async () => {
    const id = runId();
    const dir = `nightly/${id}`;
    const rec: E2eRecord = {
      status: "partial",
      runId: id,
      model: MODEL_ALIAS,
      path: "LibreChat -> LiteLLM -> Gemma, tool via LibreChat -> Twenty MCP",
      listTool: TWENTY_LIST_TOOL_NAME,
      attempts: 0,
      trajectory: [],
      errorExcerpt: null,
      stateCheck: "not run",
      reason: DID_NOT_COMPLETE,
    };
    const writeRecord = (): void => writeEvidence(dir, "record.json", `${JSON.stringify(rec, null, 2)}\n`);

    // Config is read once by the harness, so every setting goes in before the first getAdapter call.
    process.env["TWENTY_MCP"] = "1";
    process.env["LIBRECHAT_MCP_PRODUCTS"] = SERVER;
    delete process.env["P4_STUB_API_BASE"]; // p4-nightly never goes through the stub

    const twenty = getAdapter("twenty");
    const litellm = getAdapter("litellm");
    const librechat = getAdapter("librechat");
    let session: AuthSession | undefined;
    const secrets = (): string[] =>
      [process.env["GEMINI_API_KEY"], process.env["LITELLM_MASTER_KEY"], session?.authorizationHeader].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
    try {
      // The harness owns start and stop. The test only asks it to bring the products up.
      await twenty.up();
      if (!twenty.waitMcp) throw new Error("TWENTY_ADAPTER_NO_MCP: harness Twenty adapter has no waitMcp");
      await twenty.waitMcp();
      await litellm.up();
      await librechat.up(); // P4_LLM_MODE=nightly makes LibreChat list p4-stub and p4-nightly
      session = await librechat.authenticate();

      const toolName = mcpToolName(TWENTY_LIST_TOOL_NAME, SERVER);
      const agentId = await lcCreateAgent(session, {
        name: "p4-l1-nightly-agent",
        model: MODEL_ALIAS,
        tools: [toolName],
        instructions: "You are a test agent. When asked, call the tool you are given exactly once, then stop.",
      });

      let outcome: LcChatOutcome | undefined;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        rec.attempts = attempt + 1;
        outcome = await lcChat(session, {
          agentId,
          text: `Call the tool ${TWENTY_LIST_TOOL_NAME} once, then stop.`,
          timeoutMs: CHAT_TIMEOUT_MS,
        });
        if (outcome.errorText === "" || !isRateLimited(outcome.errorText)) break;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        await sleep(delay);
      }
      if (!outcome) throw new Error("no chat outcome");

      rec.trajectory = outcome.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments }));
      writeEvidence(dir, "librechat-outcome.json", `${redact(JSON.stringify(outcome, null, 2), secrets())}\n`);

      if (outcome.errorText !== "") {
        rec.errorExcerpt = redact(outcome.errorText, secrets()).slice(0, 500);
      }
      const listed = outcome.toolCalls.filter((c) => c.name === toolName);
      writeEvidence(dir, "twenty-list-output.txt", `${redact(listed.map((c) => c.output ?? "").join("\n"), secrets())}\n`);

      // The outcome rules live in gemma-classify.ts and are unit tested. Only partial (429 or RESOURCE_EXHAUSTED after
      // all retries) and blocked by provider (safety refusal) end without failing the test. Everything else fails.
      const verdict = classifyGemmaOutcome({ outcome, toolName, attempts: rec.attempts, maxAttempts: MAX_ATTEMPTS });
      rec.status = verdict.status;
      rec.reason = verdict.reason;
      if (verdict.stateCheck !== undefined) rec.stateCheck = verdict.stateCheck;
      writeRecord();
      if (verdict.status === "fail") assert.fail(`${verdict.reason}${rec.errorExcerpt ? `: ${rec.errorExcerpt}` : ""}`);
    } catch (err) {
      if (rec.reason === DID_NOT_COMPLETE) {
        rec.reason = `run error before completion: ${redact((err as Error).message, secrets())}`;
      }
      writeRecord();
      throw err;
    } finally {
      // Logs are collected before the products come down, so they exist even when the run failed.
      collectContainerLogs(dir, ["litellm", "librechat"], secrets());
      await librechat.down().catch((e: unknown) => console.error(`librechat down failed: ${(e as Error).message}`));
      await litellm.down().catch((e: unknown) => console.error(`litellm down failed: ${(e as Error).message}`));
      await twenty.down().catch((e: unknown) => console.error(`twenty down failed: ${(e as Error).message}`));
    }
  },
);
