import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyGemmaOutcome, isRateLimited, isSafetyRefusal } from "./gemma-classify.js";

const TOOL = "list_object_metadata_names_mcp_twenty";
const GOOD_OUTPUT = '{"objectNames":["companies","opportunities","people"]}';
const call = (over: Partial<{ name: string; arguments: unknown; output: string | undefined }> = {}) => ({
  name: TOOL,
  arguments: {} as unknown,
  output: GOOD_OUTPUT as string | undefined,
  ...over,
});
const classify = (errorText: string, toolCalls: ReturnType<typeof call>[], attempts = 3) =>
  classifyGemmaOutcome({ outcome: { errorText, toolCalls }, toolName: TOOL, attempts, maxAttempts: 3 });

test("pass: the tool was called with object arguments and the state check passes", () => {
  const v = classify("", [call()]);
  assert.equal(v.status, "pass");
  assert.match(v.stateCheck ?? "", /people, companies, opportunities/);
});

test("partial: a 429 that is still there after every retry", () => {
  assert.equal(classify("provider returned 429 Too Many Requests", []).status, "partial");
});

test("partial: RESOURCE_EXHAUSTED that is still there after every retry", () => {
  assert.equal(classify('{"error":{"status":"RESOURCE_EXHAUSTED"}}', []).status, "partial");
});

test("fail: a rate limit seen before the retries were used up is not partial", () => {
  const v = classify("429", [], 2);
  assert.equal(v.status, "fail");
  assert.match(v.reason, /retries were not used up/);
});

test("fail: the words rate limit without 429 or RESOURCE_EXHAUSTED are not partial", () => {
  assert.equal(classify("you hit a rate limit", []).status, "fail");
  assert.equal(isRateLimited("error 1429 in stream"), false);
});

test("blocked by provider: a safety refusal", () => {
  assert.equal(classify("finish_reason content_filter", []).status, "blocked by provider");
  assert.equal(classify("blocked: SAFETY", []).status, "blocked by provider");
  assert.equal(isSafetyRefusal("the model was unsafe"), false);
});

test("inconclusive: a 503 UNAVAILABLE is a provider outage, not a plain failure (rule changed in this step)", () => {
  assert.equal(classify("503 UNAVAILABLE", []).status, "inconclusive");
});

test("fail: no tool call at all", () => {
  const v = classify("", []);
  assert.equal(v.status, "fail");
  assert.match(v.reason, /no tool call/);
});

test("fail: a tool call to the wrong tool", () => {
  const v = classify("", [call({ name: "get_tool_catalog_mcp_twenty" })]);
  assert.equal(v.status, "fail");
  assert.match(v.reason, /no call to list_object_metadata_names_mcp_twenty/);
});

test("fail: non-object arguments", () => {
  assert.equal(classify("", [call({ arguments: null })]).status, "fail");
  assert.equal(classify("", [call({ arguments: "text" })]).status, "fail");
});

test("fail: the state check finds a required object missing", () => {
  const v = classify("", [call({ output: '{"objectNames":["companies","people"]}' })]);
  assert.equal(v.status, "fail");
  assert.match(v.reason, /opportunities/);
});

test("fail: no tool output to check", () => {
  assert.equal(classify("", [call({ output: undefined })]).status, "fail");
});

// ---- Provider outage: inconclusive, never a pass. Shared with the measured lanes (provider-outage.ts). ----
import { outageLogLine, isProviderOutage } from "./provider-outage.js";

const LOG_WITH_OUTAGE = [
  "22:13:58 - LiteLLM Proxy: request ok",
  "22:14:18 - LiteLLM Proxy:ERROR: proxy_server.py:11039 - Exception occured - litellm.ServiceUnavailableError: Vertex_ai_betaException - UNAVAILABLE - This model is currently experiencing high demand.",
  "litellm.llms.vertex_ai.common_utils.VertexAIError: UNAVAILABLE - high demand",
].join("\n");
const LOG_CLEAN = "22:13:58 - LiteLLM Proxy: request ok\n22:14:02 - LiteLLM Proxy: request ok";
const withText = (text: string, errorText: string, toolCalls: ReturnType<typeof call>[], providerLog?: string) =>
  classifyGemmaOutcome({ outcome: { errorText, toolCalls, text }, toolName: TOOL, attempts: 1, maxAttempts: 3, providerLog });

test("outage: a LibreChat error that is a provider outage is inconclusive and never a pass", () => {
  const v = classify("UNAVAILABLE - This model is currently experiencing high demand", []);
  assert.equal(v.status, "inconclusive");
  assert.match(v.reason, /^INCONCLUSIVE: provider unavailable/);
});

test("outage: an HTTP 503 error text is inconclusive", () => {
  assert.equal(classify("upstream returned 503 Service Unavailable", []).status, "inconclusive");
});

test("outage: an empty reply whose provider log names the outage is inconclusive, with the log timestamp", () => {
  const v = withText("", "", [], LOG_WITH_OUTAGE);
  assert.equal(v.status, "inconclusive");
  assert.match(v.reason, /^INCONCLUSIVE: provider unavailable \(empty reply; LiteLLM log at 22:14:18/);
});

test("outage: an empty reply with a clean provider log is a normal fail, not an outage", () => {
  const v = withText("", "", [], LOG_CLEAN);
  assert.equal(v.status, "fail");
  assert.equal(v.reason, "no tool call in the saved assistant message");
});

test("rate limit: a 429 with the retries used up is still partial, even if the log also names an outage", () => {
  const v = classifyGemmaOutcome({ outcome: { errorText: "provider returned 429 Too Many Requests", toolCalls: [], text: "" }, toolName: TOOL, attempts: 3, maxAttempts: 3, providerLog: LOG_WITH_OUTAGE });
  assert.equal(v.status, "partial");
});

test("rate limit: a 429 seen before the retries were used up is still a fail", () => {
  assert.equal(classify("provider returned 429", [], 1).status, "fail");
});

test("real answer, no tool call: a normal fail, even when the provider log names an outage elsewhere", () => {
  const v = withText("The list is companies, opportunities and people.", "", [], LOG_WITH_OUTAGE);
  assert.equal(v.status, "fail");
  assert.equal(v.reason, "no tool call in the saved assistant message");
});

test("outageLogLine: finds the first outage line with its timestamp, and none when the log is clean", () => {
  assert.deepEqual(outageLogLine(LOG_WITH_OUTAGE)?.time, "22:14:18");
  assert.equal(outageLogLine(LOG_CLEAN), null);
  assert.equal(isProviderOutage("the thread is unavailable to me"), false);
  assert.equal(isProviderOutage("UNAVAILABLE"), true);
});

test("fail: any other error (not an outage, not a rate limit) still fails", () => {
  assert.equal(classify("something else broke", [call()]).status, "fail");
});
