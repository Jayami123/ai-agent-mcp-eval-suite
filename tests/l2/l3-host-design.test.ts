import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelledRequestId } from "../../src/attack-lab/cancel.js";
import { createSink } from "../../src/attack-lab/sink.js";
import {
  APP_HTML,
  APP_MIME_TYPE,
  APP_RESOURCE_URI,
  buildTools,
  callTool,
  configFromEnv,
  SLOW_MS_DEFAULT,
  SLOW_TASK_DONE_TEXT,
  type CallContext,
  type LabTool,
} from "../../src/attack-lab/modes.js";
import { LabState } from "../../src/attack-lab/state.js";

// Unit tests for the L3 host-design lab additions (app-tool, slow-task, always-fail, the cancel notification and the UI
// resource). No network: each test drives callTool and buildTools directly, on a fresh state and sink.

function labWith(env: Record<string, string>): { state: LabState; sink: ReturnType<typeof createSink> } {
  const state = new LabState(configFromEnv({ ...env }));
  return { state, sink: createSink() };
}

function ctxFor(sink: ReturnType<typeof createSink>, signal: AbortSignal = new AbortController().signal): CallContext {
  return { sink, signal, clientElicitation: { form: false, url: false }, elicit: undefined };
}

const names = (tools: LabTool[]) => tools.map((t) => t.name);
const count = (state: LabState, event: string, tool: string) => state.log.filter((e) => e.event === event && e.detail["tool"] === tool).length;

test("LAB_SLOW_MS defaults to the documented wait and rejects a bad value", () => {
  assert.equal(configFromEnv({}).slowMs, SLOW_MS_DEFAULT);
  assert.equal(configFromEnv({ LAB_SLOW_MS: "5" }).slowMs, 5);
  assert.throws(() => configFromEnv({ LAB_SLOW_MS: "0" }), /LAB_SLOW_MS must be an integer >= 1/);
  assert.throws(() => configFromEnv({ LAB_SLOW_MS: "soon" }), /LAB_SLOW_MS/);
});

test("app-tool lists lab_app_view with MCP Apps UI metadata; benign does not", () => {
  const app = buildTools(labWith({ LAB_MODE: "app-tool" }).state).find((t) => t.name === "lab_app_view");
  assert.ok(app, "app-tool mode lists lab_app_view");
  const ui = (app._meta as { ui: { resourceUri: string; visibility: string[] } }).ui;
  assert.equal(ui.resourceUri, APP_RESOURCE_URI);
  assert.ok(APP_RESOURCE_URI.startsWith("ui://"), "the resource URI uses the ui:// scheme");
  assert.deepEqual(ui.visibility, ["model", "app"]);
  assert.equal(app.annotations?.["readOnlyHint"], true);
  assert.equal(names(buildTools(labWith({ LAB_MODE: "benign" }).state)).includes("lab_app_view"), false, "the benign pin is unchanged");
});

test("the UI resource is an app page without script, under the MCP Apps MIME type", () => {
  assert.equal(APP_MIME_TYPE, "text/html;profile=mcp-app");
  assert.ok(APP_HTML.includes("<html"), "the resource is an HTML document");
  assert.equal(APP_HTML.includes("<script"), false, "the lab app carries no script");
});

test("slow-task lists lab_slow_task as a write; always-fail adds no tool", () => {
  const slow = buildTools(labWith({ LAB_MODE: "slow-task" }).state).find((t) => t.name === "lab_slow_task");
  assert.ok(slow, "slow-task mode lists lab_slow_task");
  assert.equal(slow.annotations?.["readOnlyHint"], false);
  assert.equal(slow.annotations?.["destructiveHint"], true);
  assert.equal(names(buildTools(labWith({ LAB_MODE: "benign" }).state)).includes("lab_slow_task"), false);
  assert.deepEqual(names(buildTools(labWith({ LAB_MODE: "always-fail" }).state)), names(buildTools(labWith({ LAB_MODE: "benign" }).state)));
});

test("slow-task: an aborted call writes nothing, records call_aborted and never call_completed", async () => {
  const { state, sink } = labWith({ LAB_MODE: "slow-task", LAB_SLOW_MS: "5000" });
  const ac = new AbortController();
  ac.abort();
  const result = await callTool(state, "lab_slow_task", {}, ctxFor(sink, ac.signal));
  assert.equal(result.isError, true);
  assert.equal(count(state, "call_aborted", "lab_slow_task"), 1);
  assert.equal(count(state, "call_completed", "lab_slow_task"), 0);
  assert.equal(sink.records().filter((r) => r.kind === "task-write").length, 0, "no write after a cancel");
  assert.equal(JSON.stringify(result).includes(SLOW_TASK_DONE_TEXT), false, "no completion text in the result");
});

test("slow-task: a call that is not cancelled writes once and completes", async () => {
  const { state, sink } = labWith({ LAB_MODE: "slow-task", LAB_SLOW_MS: "5" });
  const result = await callTool(state, "lab_slow_task", {}, ctxFor(sink));
  assert.equal(result.isError, undefined);
  assert.equal(JSON.stringify(result).includes(SLOW_TASK_DONE_TEXT), true);
  assert.equal(sink.records().filter((r) => r.kind === "task-write").length, 1);
  assert.equal(count(state, "call_completed", "lab_slow_task"), 1);
  assert.equal(count(state, "call_aborted", "lab_slow_task"), 0);
});

test("always-fail: every lab_add fails, is logged, and never completes", async () => {
  const { state, sink } = labWith({ LAB_MODE: "always-fail" });
  for (let i = 0; i < 4; i += 1) {
    const result = await callTool(state, "lab_add", { a: 1, b: 2 }, ctxFor(sink));
    assert.equal(result.isError, true);
  }
  assert.equal(count(state, "call_failed", "lab_add"), 4);
  assert.equal(count(state, "call_completed", "lab_add"), 0);
  assert.equal(sink.records().length, 0, "always-fail never writes");
});

test("cancelledRequestId reads the id of a notifications/cancelled and nothing else", () => {
  assert.equal(cancelledRequestId({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7, reason: "stop" } }), "7");
  assert.equal(cancelledRequestId({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "abc" } }), "abc");
  assert.equal(cancelledRequestId({ jsonrpc: "2.0", method: "tools/call", params: { requestId: 7 } }), undefined);
  assert.equal(cancelledRequestId({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} }), undefined);
  assert.equal(cancelledRequestId({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "x".repeat(129) } }), undefined);
  assert.equal(cancelledRequestId([{ method: "notifications/cancelled", params: { requestId: 1 } }]), undefined);
  assert.equal(cancelledRequestId(null), undefined);
  assert.equal(cancelledRequestId("notifications/cancelled"), undefined);
});
