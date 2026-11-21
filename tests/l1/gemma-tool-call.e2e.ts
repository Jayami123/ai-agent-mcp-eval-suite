import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdapter, type AuthSession } from "qa-portfolio-harness";
import { collectContainerLogs, containerLogWindow, redact, runId, writeEvidence } from "./evidence.js";
import { lcChat, lcCreateAgent, mcpToolName, type LcChatOutcome } from "./librechat-client.js";
import { classifyGemmaOutcome, isRateLimited, type GemmaStatus } from "./gemma-classify.js";
import { servedModelFromModelInfo, sumUsage, usageFromMessage, type ServedModel, type UsageFields } from "./gemma-record.js";
import { requireNightlyKey } from "./nightly-key.js";

// L1 smoke: a real model (LiteLLM alias p4-nightly, gemma or deepseek by P4_NIGHTLY_PROVIDER) calls one real Twenty MCP tool
// THROUGH LibreChat.
// Chain: LibreChat agent -> LiteLLM (p4-nightly -> the selected model) -> back through LibreChat to the Twenty MCP server.
// LibreChat talks to LiteLLM only; the provider key (GEMINI_API_KEY or DEEPSEEK_API_KEY) reaches LiteLLM and nothing else.
// Runs only in the nightly workflow. Never uses a fixture header or marker (the stub path is separate).
// Never asserts on reply text. Never prints the key, a bearer token or any header value.
// Target is list_object_metadata_names only. Trajectories through execute_tool, learn_tools or get_tool_catalog are
// deferred to Lane 2.

// Nightly mode runs this test. It never skips in nightly mode: a missing key fails it (requireNightlyKey, in the test body).
const NIGHTLY = process.env["P4_LLM_MODE"] === "nightly";
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
  /** The upstream model LiteLLM routes p4-nightly to, or null when /model/info could not say. Read by the L5 trace schema. */
  servedModel: ServedModel | null;
  /** Token usage from the saved LibreChat reply, summed over attempts. null parts mean the source did not carry them. */
  usage: UsageFields;
  /** Wall-clock over all chat attempts, in milliseconds. */
  latencyMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test(
  "L1 smoke: the nightly model calls list_object_metadata_names through LibreChat (p4-nightly)",
  {
    skip: NIGHTLY ? false : "requires P4_LLM_MODE=nightly (nightly workflow only)",
    timeout: 40 * 60_000,
  },
  async () => {
    // Fails here, before any product starts, when the selected provider's key is missing. Never a skip in nightly mode.
    const providerKey = requireNightlyKey(process.env);
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
      servedModel: null,
      usage: { promptTokens: null, completionTokens: null, source: "none" },
      latencyMs: 0,
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
      [providerKey, process.env["LITELLM_MASTER_KEY"], session?.authorizationHeader].filter(
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

      // The model id LiteLLM routes the alias to. Read-only call, no model is invoked. A failure is recorded as null, not thrown:
      // the record then says "unknown" and the L5 schema check fails it loudly later.
      try {
        const lite = await litellm.authenticate();
        const info = await fetch(`${lite.baseUrl}/model/info`, { headers: { authorization: lite.authorizationHeader }, signal: AbortSignal.timeout(15_000) });
        if (info.ok) rec.servedModel = servedModelFromModelInfo(await info.json(), MODEL_ALIAS);
      } catch {
        rec.servedModel = null;
      }

      const toolName = mcpToolName(TWENTY_LIST_TOOL_NAME, SERVER);
      const agentId = await lcCreateAgent(session, {
        name: "p4-l1-nightly-agent",
        model: MODEL_ALIAS,
        tools: [toolName],
        instructions: "You are a test agent. When asked, call the tool you are given exactly once, then stop.",
      });

      let outcome: LcChatOutcome | undefined;
      const usageParts: UsageFields[] = [];
      const startedAt = Date.now();
      const chatStartIso = new Date(startedAt).toISOString(); // this trial's own LiteLLM window starts here
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        rec.attempts = attempt + 1;
        outcome = await lcChat(session, {
          agentId,
          text: `Call the tool ${TWENTY_LIST_TOOL_NAME} once, then stop.`,
          timeoutMs: CHAT_TIMEOUT_MS,
        });
        usageParts.push(usageFromMessage(outcome.reply));
        if (outcome.errorText === "" || !isRateLimited(outcome.errorText)) break;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        await sleep(delay);
      }
      if (!outcome) throw new Error("no chat outcome");
      rec.latencyMs = Date.now() - startedAt;
      rec.usage = sumUsage(usageParts);

      rec.trajectory = outcome.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments }));
      writeEvidence(dir, "librechat-outcome.json", `${redact(JSON.stringify(outcome, null, 2), secrets())}\n`);

      if (outcome.errorText !== "") {
        rec.errorExcerpt = redact(outcome.errorText, secrets()).slice(0, 500);
      }
      const listed = outcome.toolCalls.filter((c) => c.name === toolName);
      writeEvidence(dir, "twenty-list-output.txt", `${redact(listed.map((c) => c.output ?? "").join("\n"), secrets())}\n`);

      // The outcome rules live in gemma-classify.ts and are unit tested. Only partial (429 or RESOURCE_EXHAUSTED after
      // all retries) and blocked by provider (safety refusal) end without failing the test. Everything else fails.
      // The provider log is read for this trial's own window only (the same rule as the measured lanes), never the whole tail.
      const providerLog = containerLogWindow("litellm", secrets(), chatStartIso, new Date().toISOString());
      const verdict = classifyGemmaOutcome({ outcome, toolName, attempts: rec.attempts, maxAttempts: MAX_ATTEMPTS, providerLog });
      rec.status = verdict.status;
      rec.reason = verdict.reason;
      if (verdict.stateCheck !== undefined) rec.stateCheck = verdict.stateCheck;
      writeRecord();
      if (verdict.status === "fail") assert.fail(`${verdict.reason}${rec.errorExcerpt ? `: ${rec.errorExcerpt}` : ""}`);
      // An outage is never a pass: the job fails and names it.
      if (verdict.status === "inconclusive") assert.fail(verdict.reason);
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
