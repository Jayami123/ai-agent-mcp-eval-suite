import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getAdapter, type AuthSession, type ProductAdapter } from "qa-portfolio-harness";

// L1 smoke: a real model (Gemma through LiteLLM alias p4-nightly) calls a real MCP tool on Twenty.
// Runs only in the nightly workflow. Never uses a fixture header or marker (the stub path is separate).
// Never asserts on reply text. Never prints the key, a bearer token or any header value.

const ENABLED = process.env["P4_LLM_MODE"] === "nightly" && Boolean(process.env["GEMINI_API_KEY"]);
const MODEL_ALIAS = "p4-nightly";
const MAX_TURNS = 4;
// Pacing from plan section 8.7 (UNVERIFIED limits; 25 s gap between heavy turns).
const PACE_MS = 25_000;
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
  listTool: string | null;
  turns: number;
  trajectory: TrajectoryStep[];
  httpStatuses: number[];
  finishReasons: string[];
  stateCheck: string;
  reason: string;
}

/** Heavy turns are spaced by at least minGapMs (plan section 8.7). No retry on 429. */
export class Pacer {
  private last = 0;
  constructor(private readonly minGapMs: number) {}
  async beforeHeavyTurn(): Promise<void> {
    const wait = this.last + this.minGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  afterHeavyTurn(): void {
    this.last = Date.now();
  }
}

function runId(): string {
  return process.env["GITHUB_RUN_ID"] ?? `local-${Date.now()}`;
}

function evidenceDir(id: string): string {
  return path.resolve(process.cwd(), "evidence", "nightly", id);
}

function writeRecord(rec: E2eRecord): void {
  const dir = evidenceDir(rec.runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "record.json"), `${JSON.stringify(rec, null, 2)}\n`);
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

/** Sends one JSON-RPC message. Accepts a JSON or SSE response and returns the message whose id matches. */
async function mcpSend(
  ctx: McpCtx,
  body: { id?: number; method: string; params?: unknown },
): Promise<{ id?: number; result?: unknown; error?: { code?: number } } | undefined> {
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
        .map((line) => JSON.parse(line.slice(5).trim()) as { id?: number; result?: unknown; error?: { code?: number } })
    : [JSON.parse(text) as { id?: number; result?: unknown; error?: { code?: number } }];
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

/** The list tool is picked by name from tools/list, never guessed. Exactly one candidate must match. */
function pickListTool(tools: McpTool[]): McpTool {
  const candidates = tools.filter((t) => /(^|_)list(_|$)/i.test(t.name));
  if (candidates.length !== 1) {
    // Tool names are product metadata, not secrets. Printed so the exact list tool can be chosen from the real list.
    const names = candidates.map((t) => t.name).join(", ");
    throw new Error(
      `TWENTY_LIST_TOOL_NOT_UNIQUE: found ${candidates.length} candidates in ${tools.length} tools: [${names}]`,
    );
  }
  return candidates[0] as McpTool;
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
  recordCount: number | null;
  knownNames: string[];
}

type StateVerdict = { outcome: "pass" | "fail" | "unverified"; detail: string };

const SEED_EXPECTED_FILE = path.resolve(process.cwd(), "tests", "l1", "twenty-seed.expected.json");

function readSeedExpectation(): SeedExpectation {
  const raw = JSON.parse(fs.readFileSync(SEED_EXPECTED_FILE, "utf8")) as Partial<SeedExpectation>;
  return {
    recordCount: typeof raw.recordCount === "number" ? raw.recordCount : null,
    knownNames: Array.isArray(raw.knownNames) ? raw.knownNames.filter((n): n is string => typeof n === "string") : [],
  };
}

/** First array of objects found in the parsed list result (top level, or one level down). */
function findRecordArray(value: unknown, depth = 0): unknown[] | undefined {
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "object" && v !== null)) {
    return value;
  }
  if (depth >= 2 || typeof value !== "object" || value === null) return undefined;
  for (const child of Object.values(value)) {
    const found = findRecordArray(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Asserts the list tool's result against the seeded Twenty records: the record count and at least one
 * known name. Expectations come from tests/l1/twenty-seed.expected.json, filled from a real seed run.
 * Null or empty expectations are "unverified", which is never a pass.
 */
function checkSeededState(results: McpCallResult[]): StateVerdict {
  const expected = readSeedExpectation();
  if (expected.recordCount === null || expected.knownNames.length === 0) {
    return { outcome: "unverified", detail: "tests/l1/twenty-seed.expected.json has no verified recordCount/knownNames" };
  }
  const last = results[results.length - 1];
  if (!last) return { outcome: "fail", detail: "no successful list-tool result to check" };
  if (last.isError) return { outcome: "fail", detail: "list-tool result has isError set" };
  const text = (last.content ?? []).map((c) => c.text ?? "").join("\n");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { outcome: "fail", detail: "list-tool result text is not JSON" };
  }
  const records = findRecordArray(parsed);
  if (!records) return { outcome: "fail", detail: "no record array in the list-tool result" };
  if (records.length !== expected.recordCount) {
    return {
      outcome: "fail",
      detail: `record count ${records.length} != expected ${expected.recordCount}`,
    };
  }
  const missing = expected.knownNames.filter((name) => !text.includes(name));
  if (missing.length > 0) {
    return { outcome: "fail", detail: `known name(s) not in result: ${missing.length} missing` };
  }
  return {
    outcome: "pass",
    detail: `record count ${records.length} matches; ${expected.knownNames.length} known name(s) found`,
  };
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
  body: ChatBody | null;
}

async function chat(session: AuthSession, messages: unknown[], tools: unknown[]): Promise<ChatResult> {
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
  return { status: res.status, body };
}

test(
  "L1 smoke: Gemma calls a real MCP tool through p4-nightly",
  {
    skip: ENABLED ? false : "requires P4_LLM_MODE=nightly and GEMINI_API_KEY (nightly workflow only)",
    timeout: 15 * 60_000,
  },
  async () => {
    const id = runId();
    const rec: E2eRecord = {
      status: "partial",
      runId: id,
      model: MODEL_ALIAS,
      listTool: null,
      turns: 0,
      trajectory: [],
      httpStatuses: [],
      finishReasons: [],
      stateCheck: "not run: Twenty seed record count is not verified yet (plan section 8.2 step 5)",
      reason: DID_NOT_COMPLETE,
    };

    process.env["TWENTY_MCP"] = "1";
    const twenty = getAdapter("twenty");
    const litellm = getAdapter("litellm");
    const pacer = new Pacer(PACE_MS);
    try {
      // The harness owns start and stop. The test only asks it to bring the products up.
      await twenty.up();
      if (!twenty.waitMcp) throw new Error("TWENTY_ADAPTER_NO_MCP: harness Twenty adapter has no waitMcp");
      await twenty.waitMcp();
      await litellm.up();
      const session = await litellm.authenticate();

      const mcp = readTwentyMcp(twenty);
      const ctx: McpCtx = { url: mcp.url, authorization: mcp.authorization, nextId: 1 };
      const tools = await mcpHandshake(ctx);
      const listTool = pickListTool(tools);
      rec.listTool = listTool.name;
      const llmTools = [
        {
          type: "function",
          function: { name: listTool.name, description: listTool.description ?? "", parameters: listTool.inputSchema ?? {} },
        },
      ];

      const messages: unknown[] = [
        { role: "user", content: "List the records. Call the tool that lists records, then stop." },
      ];

      // Set when the loop stops on a non-assertion outcome (plan section 8.6).
      let stopped: Status | null = null;
      const listResults: McpCallResult[] = [];
      for (let turn = 0; turn < MAX_TURNS && stopped === null; turn++) {
        await pacer.beforeHeavyTurn();
        const result = await chat(session, messages, llmTools);
        pacer.afterHeavyTurn();
        rec.turns = turn + 1;
        rec.httpStatuses.push(result.status);

        if (result.status === 429 || result.body?.error?.message?.includes("RESOURCE_EXHAUSTED")) {
          stopped = "partial";
          rec.reason = `quota exhausted at turn ${turn} (HTTP ${result.status}); no retry`;
          break;
        }
        if (result.status !== 200 || !result.body) {
          stopped = "partial";
          rec.reason = `provider HTTP ${result.status} at turn ${turn}; run stopped early`;
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
          if (call.function.name === listTool.name && out) listResults.push(out);
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
          const dir = evidenceDir(id);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, "finding-gemma-tool-calling.md"),
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
      const state = checkSeededState(listResults);
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
        rec.reason = `run error before completion: ${(err as Error).message}`;
      }
      writeRecord(rec);
      throw err;
    } finally {
      await litellm.down().catch((e: unknown) => console.error(`litellm down failed: ${(e as Error).message}`));
      await twenty.down().catch((e: unknown) => console.error(`twenty down failed: ${(e as Error).message}`));
    }
  },
);
