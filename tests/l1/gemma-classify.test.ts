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

test("fail: any other error is a failure, even a 503 UNAVAILABLE", () => {
  assert.equal(classify("503 UNAVAILABLE model overloaded", []).status, "fail");
  assert.equal(classify("something else broke", [call()]).status, "fail");
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
