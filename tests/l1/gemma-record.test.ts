import { test } from "node:test";
import assert from "node:assert/strict";
import { servedModelFromModelInfo, sumUsage, usageFromMessage } from "./gemma-record.js";

const INFO = {
  data: [
    { model_name: "p4-stub", litellm_params: { model: "openai/stub-upstream-model" } },
    { model_name: "p4-nightly", litellm_params: { model: "gemini/gemma-4-31b-it", rpm: 30 } },
  ],
};

test("served model: the upstream model of the p4-nightly alias", () => {
  assert.deepEqual(servedModelFromModelInfo(INFO, "p4-nightly"), { id: "gemini/gemma-4-31b-it", source: "litellm /model/info" });
});

test("served model: unknown alias, bad shape or empty model gives null, never a guess", () => {
  assert.equal(servedModelFromModelInfo(INFO, "other"), null);
  assert.equal(servedModelFromModelInfo({ data: "x" }, "p4-nightly"), null);
  assert.equal(servedModelFromModelInfo(null, "p4-nightly"), null);
  assert.equal(servedModelFromModelInfo({ data: [{ model_name: "p4-nightly", litellm_params: { model: "" } }] }, "p4-nightly"), null);
});

test("usage: an OpenAI-style usage object gives prompt and completion tokens", () => {
  assert.deepEqual(usageFromMessage({ usage: { prompt_tokens: 5200, completion_tokens: 40 } }), { promptTokens: 5200, completionTokens: 40, source: "message.usage" });
});

test("usage: tokenCount alone counts the reply, so prompt tokens stay null", () => {
  assert.deepEqual(usageFromMessage({ tokenCount: 37 }), { promptTokens: null, completionTokens: 37, source: "message.tokenCount" });
});

test("usage: nothing usable gives nulls and source none, bad numbers are ignored", () => {
  assert.deepEqual(usageFromMessage({}), { promptTokens: null, completionTokens: null, source: "none" });
  assert.deepEqual(usageFromMessage({ usage: { prompt_tokens: -1, completion_tokens: "x" }, tokenCount: Number.NaN }), { promptTokens: null, completionTokens: null, source: "none" });
  assert.equal(usageFromMessage(undefined).source, "none");
});

test("usage: sumUsage adds attempts and keeps null when no attempt had a number", () => {
  const a = { promptTokens: 100, completionTokens: 10, source: "message.usage" as const };
  const b = { promptTokens: 50, completionTokens: null, source: "message.usage" as const };
  assert.deepEqual(sumUsage([a, b]), { promptTokens: 150, completionTokens: 10, source: "message.usage" });
  assert.deepEqual(sumUsage([{ promptTokens: null, completionTokens: null, source: "none" }]), { promptTokens: null, completionTokens: null, source: "none" });
});

// The record fix exists so the L5 trace schema can accept real nightly records. Prove the hand-off with the L5 adapter.
import { trialFromL1GemmaRecord, validateTrial } from "../../src/stats/index.js";

const record = {
  status: "pass" as const,
  model: "p4-nightly",
  trajectory: [{ name: "list_object_metadata_names_mcp_twenty", arguments: {} }],
  reason: "ok",
  servedModel: servedModelFromModelInfo(INFO, "p4-nightly"),
  usage: { promptTokens: 5200, completionTokens: 40, source: "message.usage" as const },
  latencyMs: 1500,
};
const ctx = { caseId: "P4-MCP-REL-006", trial: 0, k: 10, promptSha256: "a".repeat(64) };

test("record fix: a record with served model and usage passes the L5 trace schema", () => {
  const rec = trialFromL1GemmaRecord(record, {
    ...ctx,
    servedModelId: record.servedModel?.id ?? "",
    latencyMs: record.latencyMs,
    usage: { promptTokens: record.usage.promptTokens ?? 0, completionTokens: record.usage.completionTokens ?? 0 },
  });
  assert.deepEqual(validateTrial(rec, "l1"), { ok: true, errors: [] });
  assert.equal(rec.model.servedId, "gemini/gemma-4-31b-it");
});

test("record fix: a record whose served model could not be read fails the L5 schema loudly", () => {
  const rec = trialFromL1GemmaRecord(record, { ...ctx, servedModelId: "", latencyMs: 1, usage: { promptTokens: 0, completionTokens: 0 } });
  assert.ok(validateTrial(rec, "l1").errors.some((e) => e.startsWith("model.servedId")));
});
