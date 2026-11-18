import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getAdapter, type AuthSession, type ProductAdapter } from "qa-portfolio-harness";

// L1 smoke: a real model (Gemma through LiteLLM alias p4-nightly) calls one real Twenty MCP tool.
// Target is list_object_metadata_names only. Trajectories through execute_tool, learn_tools or
// get_tool_catalog are deferred to Lane 2 (see plan section 8.2).
// Runs only in the nightly workflow. Never uses a fixture header or marker (the stub path is separate).
// Never asserts on reply text. Never prints the key, a bearer token or any header value.

const ENABLED = process.env["P4_LLM_MODE"] === "nightly" && Boolean(process.env["GEMINI_API_KEY"]);
const MODEL_ALIAS = "p4-nightly";
const MAX_TURNS = 4;
// Exact Twenty MCP tool name, from the real tools/list. Pinned, no pattern matching.
const TWENTY_LIST_TOOL_NAME = "list_object_metadata_names";
// Rate limits (429 or RESOURCE_EXHAUSTED): retry after 15 s, then 45 s. Still limited = partial.
const RETRY_DELAYS_MS = [15_000, 45_000];
// A Google-side overload (503 whose body says UNAVAILABLE or overloaded) gets one retry after 30 s. Any other 503 = fail.
const OVERLOAD_RETRY_MS = 30_000;
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 5_000;
const LOG_TAIL_LINES = 400;
const REQUEST_TIMEOUT_MS = 120_000;
const MCP_PROTOCOL_VERSION = "2025-03-26";
const DID_NOT_COMPLETE = "run did not complete";

type Status = "pass" | "fail" | "blocked by provider" | "partial" | "finding:gemma-tool-calling";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface TrajectoryStep {
  turn: number;
  name: string;
  arguments: unknown;
}

interface E2eRecord {
  status: Status;
  runId: string;
  model: string;
  listTool: string;
  toolNames: string[];
  modelListed: boolean | null;
  turns: number;
  trajectory: TrajectoryStep[];
  httpStatuses: number[];
  finishReasons: string[];
  providerErrorExcerpt: string | null;
  stateCheck: string;
  reason: string;
}

function runId(): string {
  return process.env["GITHUB_RUN_ID"] ?? `local-${Date.now()}`;
}

function evidenceDir(id: string): string {
  return path.resolve(process.cwd(), "evidence", "nightly", id);
}

function writeEvidence(id: string, name: string, text: string): void {
  const dir = evidenceDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
}

function writeRecord(rec: E2eRecord): void {
  writeEvidence(rec.runId, "record.json", `${JSON.stringify(rec, null, 2)}\n`);
}

/** Removes known secret values and common key and token shapes before anything is written to evidence. */
function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[REDACTED]");
  }
  return out
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
    .replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]");
}

function secretsInUse(session: AuthSession | undefined): string[] {
  const values = [process.env["GEMINI_API_KEY"], process.env["LITELLM_MASTER_KEY"], session?.authorizationHeader];
  return values.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** LiteLLM container logs, tail only, redacted. Written even when the run failed. Never throws. */
function collectLitellmLogs(id: string, secrets: string[]): void {
  try {
    const ps = spawnSync("docker", ["ps", "-a", "--filter", "name=litellm", "--format", "{{.Names}}"], {
      encoding: "utf8",
      timeout: 60_000,
    });
    const names = (ps.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) {
      writeEvidence(id, "litellm-logs.txt", "no litellm container found\n");
      return;
    }
    for (const name of names) {
      const logs = spawnSync("docker", ["logs", "--tail", String(LOG_TAIL_LINES), name], {
        encoding: "utf8",
        timeout: 60_000,
      });
      const text = `${logs.stdout ?? ""}${logs.stderr ?? ""}`;
      writeEvidence(id, `litellm-${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.log`, `${redact(text, secrets)}\n`);
    }
  } catch (err) {
    writeEvidence(id, "litellm-logs.txt", `log collection failed: ${redact((err as Error).message, secrets)}\n`);
  }
}

/** The MCP credential is written by the harness to the Twenty run-state file. It is read here and never printed. */
function readTwentyMcp(twenty: ProductAdapter): { url: string; authorization: string } {
  const stateFile = twenty.mcpRunStateFile?.();
  if (!stateFile) throw new Error("TWENTY_MCP_RUN_STATE_MISSING: adapter has no run-state file");
  const raw = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<string, unknown>;
  const url = raw["mcpUrl"];
  const authorization = raw["mcpAuthorization"];
  if (typeof url !== "string" || typeof authorization !== "string") {
    throw new Error("TWENTY_MCP_RUN_STATE_INVALID: mcpUrl or mcpAuthorization missing");
  }
  return { url, authorization };
}

interface McpCtx {
  url: string;
  authorization: string;
  sessionId?: string;
  nextId: number;
}

interface McpMessage {
  id?: number;
  result?: unknown;
  error?: { code?: number };
}

/** Sends one JSON-RPC message. Accepts a JSON or SSE response and returns the message whose id matches. */
async function mcpSend(ctx: McpCtx, body: { id?: number; method: string; params?: unknown }): Promise<McpMessage | undefined> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: ctx.authorization,
  };
  if (ctx.sessionId) headers["mcp-session-id"] = ctx.sessionId;
  const res = await fetch(ctx.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) ctx.sessionId = sid;
  if (!res.ok) throw new Error(`MCP ${body.method} HTTP ${res.status}`);
  const text = await res.text();
  if (body.id === undefined || text.trim() === "") return undefined;
  const contentType = res.headers.get("content-type") ?? "";
  const messages = contentType.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5).trim()) as McpMessage)
    : [JSON.parse(text) as McpMessage];
  return messages.find((m) => m.id === body.id);
}

async function mcpRequest(ctx: McpCtx, method: string, params: unknown): Promise<unknown> {
  ctx.nextId += 1;
  const msg = await mcpSend(ctx, { id: ctx.nextId, method, params });
  if (!msg) throw new Error(`MCP ${method}: no response with the request id`);
  if (msg.error) throw new Error(`MCP ${method} error code ${String(msg.error.code)}`);
  return msg.result;
}

async function mcpHandshake(ctx: McpCtx): Promise<McpTool[]> {
  await mcpRequest(ctx, "initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "p4-suite-l1", version: "0.1.0" },
  });
  await mcpSend(ctx, { method: "notifications/initialized" });
  const listed = (await mcpRequest(ctx, "tools/list", {})) as { tools?: McpTool[] };
  return listed.tools ?? [];
}

/** The pinned list tool must exist in the real tools/list. Fails closed otherwise. */
function pickListTool(tools: McpTool[]): McpTool {
  const found = tools.find((t) => t.name === TWENTY_LIST_TOOL_NAME);
  if (!found) {
    const names = tools.map((t) => t.name).join(", ");
    throw new Error(`TWENTY_LIST_TOOL_MISSING: ${TWENTY_LIST_TOOL_NAME} is not in tools/list: [${names}]`);
  }
  return found;
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { _unparsed: true };
  }
}

interface McpCallResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

interface SeedExpectation {
  requiredObjects: string[];
}

type StateVerdict = { outcome: "pass" | "fail" | "unverified"; detail: string };

const SEED_EXPECTED_FILE = path.resolve(process.cwd(), "tests", "l1", "twenty-seed.expected.json");

function readSeedExpectation(): SeedExpectation {
  const raw = JSON.parse(fs.readFileSync(SEED_EXPECTED_FILE, "utf8")) as Partial<SeedExpectation>;
  return {
    requiredObjects: Array.isArray(raw.requiredObjects)
      ? raw.requiredObjects.filter((n): n is string => typeof n === "string")
      : [],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The list result must include each required standard object as a whole word (person, company, opportunity).
 * Null or empty expectations are "unverified", which is never a pass.
 */
function checkSeededState(result: McpCallResult | undefined): StateVerdict {
  const expected = readSeedExpectation();
  if (expected.requiredObjects.length === 0) {
    return { outcome: "unverified", detail: "tests/l1/twenty-seed.expected.json has no requiredObjects" };
  }
  if (!result) return { outcome: "fail", detail: "no successful list-tool result to check" };
  if (result.isError) return { outcome: "fail", detail: "list-tool result has isError set" };
  const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
  const missing = expected.requiredObjects.filter((name) => !new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text));
  if (missing.length > 0) {
    return { outcome: "fail", detail: `required object(s) not in result: ${missing.join(", ")}` };
  }
  return { outcome: "pass", detail: `required objects present: ${expected.requiredObjects.join(", ")}` };
}

interface ChatBody {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  error?: { message?: string };
}

interface ChatResult {
  status: number;
  text: string;
  body: ChatBody | null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function chatOnce(session: AuthSession, messages: unknown[], tools: unknown[]): Promise<ChatResult> {
  const res = await fetch(`${session.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: session.authorizationHeader },
    body: JSON.stringify({ model: MODEL_ALIAS, messages, tools, tool_choice: "auto", stream: false }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let body: ChatBody | null = null;
  try {
    body = JSON.parse(text) as ChatBody;
  } catch {
    body = null;
  }
  return { status: res.status, text, body };
}

function isRateLimited(result: ChatResult): boolean {
  return result.status === 429 || result.text.includes("RESOURCE_EXHAUSTED");
}

function isGoogleOverload(result: ChatResult): boolean {
  return result.status === 503 && /UNAVAILABLE|overloaded/i.test(result.text);
}

/** Waits for LiteLLM readiness before the first model call. Times out as a fail. */
async function waitReady(session: AuthSession, rec: E2eRecord): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${session.baseUrl}/health/readiness`, { signal: AbortSignal.timeout(10_000) });
      last = `HTTP ${r.status}`;
      if (r.status === 200) return;
    } catch (err) {
      last = (err as Error).name;
    }
    await sleep(READY_POLL_MS);
  }
  rec.status = "fail";
  rec.reason = `LITELLM_NOT_READY: /health/readiness did not return 200 (last: ${last})`;
  throw new Error(rec.reason);
}

/** Checks that the p4-nightly alias is listed by GET /v1/models. No model call. */
async function checkModelListed(session: AuthSession): Promise<boolean> {
  const r = await fetch(`${session.baseUrl}/v1/models`, {
    headers: { authorization: session.authorizationHeader },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`MODELS_HTTP_${r.status}`);
  const body = (await r.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).some((m) => m.id === MODEL_ALIAS);
}

/** Bounded retries: rate limits (15 s, 45 s) and a single Google-side overload (30 s). */
async function chatWithRetry(session: AuthSession, messages: unknown[], tools: unknown[], rec: E2eRecord): Promise<ChatResult> {
  let result = await chatOnce(session, messages, tools);
  rec.httpStatuses.push(result.status);
  for (const delay of RETRY_DELAYS_MS) {
    if (!isRateLimited(result)) break;
    await sleep(delay);
    result = await chatOnce(session, messages, tools);
    rec.httpStatuses.push(result.status);
  }
  if (isGoogleOverload(result)) {
    await sleep(OVERLOAD_RETRY_MS);
    result = await chatOnce(session, messages, tools);
    rec.httpStatuses.push(result.status);
  }
  return result;
}

test(
  "L1 smoke: Gemma calls list_object_metadata_names through p4-nightly",
  {
    skip: ENABLED ? false : "requires P4_LLM_MODE=nightly and GEMINI_API_KEY (nightly workflow only)",
    timeout: 20 * 60_000,
  },
  async () => {
    const id = runId();
    const rec: E2eRecord = {
      status: "partial",
      runId: id,
      model: MODEL_ALIAS,
      listTool: TWENTY_LIST_TOOL_NAME,
      toolNames: [],
      modelListed: null,
      turns: 0,
      trajectory: [],
      httpStatuses: [],
      finishReasons: [],
      providerErrorExcerpt: null,
      stateCheck: "not run",
      reason: DID_NOT_COMPLETE,
    };

    process.env["TWENTY_MCP"] = "1";
    const twenty = getAdapter("twenty");
    const litellm = getAdapter("litellm");
    let session: AuthSession | undefined;
    try {
      // The harness owns start and stop. The test only asks it to bring the products up.
      await twenty.up();
      if (!twenty.waitMcp) throw new Error("TWENTY_ADAPTER_NO_MCP: harness Twenty adapter has no waitMcp");
      await twenty.waitMcp();
      await litellm.up();
      session = await litellm.authenticate();

      await waitReady(session, rec);
      rec.modelListed = await checkModelListed(session);
      if (!rec.modelListed) {
        rec.status = "fail";
        rec.reason = `${MODEL_ALIAS} is not listed by GET /v1/models`;
        throw new Error(rec.reason);
      }

      const mcp = readTwentyMcp(twenty);
      const ctx: McpCtx = { url: mcp.url, authorization: mcp.authorization, nextId: 1 };
      const tools = await mcpHandshake(ctx);
      rec.toolNames = tools.map((t) => t.name);
      const listTool = pickListTool(tools);
      const llmTools = [
        {
          type: "function",
          function: { name: listTool.name, description: listTool.description ?? "", parameters: listTool.inputSchema ?? {} },
        },
      ];

      const messages: unknown[] = [{ role: "user", content: `Call the tool ${listTool.name} once, then stop.` }];

      // Set when the loop stops on a non-assertion outcome (plan section 8.6).
      let stopped: Status | null = null;
      let listResult: McpCallResult | undefined;
      for (let turn = 0; turn < MAX_TURNS && stopped === null; turn++) {
        const result = await chatWithRetry(session, messages, llmTools, rec);
        rec.turns = turn + 1;

        if (isRateLimited(result)) {
          stopped = "partial";
          rec.reason = `rate limited at turn ${turn} after retries (last HTTP ${result.status})`;
          break;
        }
        if (result.status !== 200 || !result.body) {
          // Any other provider error is a fail. The body is kept as redacted evidence.
          const secrets = secretsInUse(session);
          rec.providerErrorExcerpt = redact(result.text, secrets).slice(0, 500);
          writeEvidence(id, `provider-${result.status}-body.txt`, `${redact(result.text, secrets)}\n`);
          stopped = "fail";
          rec.reason = `provider HTTP ${result.status} at turn ${turn} (not a rate limit): see provider-${result.status}-body.txt`;
          break;
        }
        const choice = result.body.choices?.[0];
        const finish = choice?.finish_reason ?? "unknown";
        rec.finishReasons.push(finish);
        if (finish === "content_filter") {
          stopped = "blocked by provider";
          rec.reason = `provider safety filter at turn ${turn} (finish_reason content_filter)`;
          break;
        }
        const calls = choice?.message?.tool_calls ?? [];
        if (calls.length === 0) {
          if (turn === 0) {
            stopped = "finding:gemma-tool-calling";
            rec.reason = "no tool_calls on the first request that requires them";
          }
          break;
        }

        messages.push({ role: "assistant", content: null, tool_calls: calls });
        for (const call of calls) {
          const args = parseArgs(call.function.arguments);
          rec.trajectory.push({ turn, name: call.function.name, arguments: args });
          ctx.nextId += 1;
          const out = (await mcpRequest(ctx, "tools/call", { name: call.function.name, arguments: args })) as
            | McpCallResult
            | undefined;
          if (call.function.name === listTool.name && out) listResult = out;
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(out?.content ?? null),
          });
        }
      }

      if (stopped !== null) {
        rec.status = stopped;
        if (stopped === "finding:gemma-tool-calling") {
          writeEvidence(
            id,
            "finding-gemma-tool-calling.md",
            [
              "# Finding: Gemma did not return tool_calls",
              "",
              `Run: ${id}. Alias: ${MODEL_ALIAS}. Tool offered: ${listTool.name}.`,
              "The first request required a tool call and the response had none.",
              "A human commits this finding through a feat/ PR (plan section 8.6, Q4). The test does not push.",
              "",
            ].join("\n"),
          );
        }
        writeRecord(rec);
        if (stopped === "fail") assert.fail(rec.reason);
        return;
      }

      const listed = rec.trajectory.filter((s) => s.name === listTool.name);
      if (listed.length === 0) {
        rec.status = "fail";
        rec.reason = `no call to ${listTool.name} in the trajectory`;
        writeRecord(rec);
        assert.fail(rec.reason);
      }
      const argsAreObject = listed.every((s) => typeof s.arguments === "object" && s.arguments !== null);
      if (!argsAreObject) {
        rec.status = "fail";
        rec.reason = `a ${listTool.name} call had non-object arguments`;
        writeRecord(rec);
        assert.fail(rec.reason);
      }

      // Raw list output is kept as CI evidence (object names only; no credentials). Used to verify the expectations.
      if (listResult) {
        const text = (listResult.content ?? []).map((c) => c.text ?? "").join("\n");
        writeEvidence(id, "twenty-list-output.txt", `${redact(text, secretsInUse(session))}\n`);
      }

      const state = checkSeededState(listResult);
      rec.stateCheck = state.detail;
      if (state.outcome === "fail") {
        rec.status = "fail";
        rec.reason = `state check failed: ${state.detail}`;
        writeRecord(rec);
        assert.fail(rec.reason);
      }
      if (state.outcome === "unverified") {
        // A pass must not mean only "the tool was called". Without verified expectations it is partial.
        rec.status = "partial";
        rec.reason = `Gemma called ${listTool.name}; state check unverified: ${state.detail}`;
        writeRecord(rec);
        return;
      }
      rec.status = "pass";
      rec.reason = `Gemma called ${listTool.name} ${listed.length} time(s); state check passed`;
      writeRecord(rec);
    } catch (err) {
      if (rec.reason === DID_NOT_COMPLETE) {
        rec.reason = `run error before completion: ${redact((err as Error).message, secretsInUse(session))}`;
      }
      writeRecord(rec);
      throw err;
    } finally {
      // Logs are collected before LiteLLM is brought down, so they exist even when the run failed.
      collectLitellmLogs(id, secretsInUse(session));
      await litellm.down().catch((e: unknown) => console.error(`litellm down failed: ${(e as Error).message}`));
      await twenty.down().catch((e: unknown) => console.error(`twenty down failed: ${(e as Error).message}`));
    }
  },
);
