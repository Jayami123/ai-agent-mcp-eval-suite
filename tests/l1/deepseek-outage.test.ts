import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEmptyAnswer, classifyStall, isProviderOutage, windowLines } from "./provider-outage.js";
import { classifyGemmaOutcome, isRateLimited } from "./gemma-classify.js";

// The DeepSeek upstream error forms (LiteLLM v1.110.0, the OpenAI-compatible mapping): the class prefix LiteLLM writes.
// The body text after the prefix is not claimed here; only the prefix is matched.
const SU_503 = "litellm.ServiceUnavailableError: DeepseekException - upstream returned 503";
const BG_502 = "litellm.BadGatewayError: DeepseekException - upstream returned 502";
const IS_500 = "litellm.InternalServerError: DeepseekException - upstream returned 500";
const RL_429 = "litellm.RateLimitError: DeepseekException - rate limit reached";

const TOOL = "list_object_metadata_names_mcp_twenty";
const GOOD_OUTPUT = '{"objectNames":["companies","opportunities","people"]}';

test("outage: each DeepSeek upstream class prefix (503, 502, 500) is provider outage evidence", () => {
  assert.equal(isProviderOutage(SU_503), true);
  assert.equal(isProviderOutage(BG_502), true);
  assert.equal(isProviderOutage(IS_500), true);
});

test("not an outage: a 429 RateLimitError is a rate limit (partial), never an outage", () => {
  assert.equal(isProviderOutage(RL_429), false);
  assert.equal(isRateLimited(RL_429), true);
});

test("not an outage: our own stack's 'Internal Server Error' text is not matched (only LiteLLM's class prefix is)", () => {
  assert.equal(isProviderOutage("Internal Server Error"), false);
  assert.equal(isProviderOutage("the server returned Bad Gateway"), false);
});

test("smoke lane: a LibreChat error that carries each DeepSeek outage prefix is inconclusive, never a pass", () => {
  for (const errorText of [SU_503, BG_502, IS_500]) {
    const v = classifyGemmaOutcome({
      outcome: { errorText, toolCalls: [] },
      toolName: TOOL,
      attempts: 1,
      maxAttempts: 3,
    });
    assert.equal(v.status, "inconclusive", errorText);
    assert.match(v.reason, /^INCONCLUSIVE: provider unavailable/);
  }
});

test("smoke lane: a 429 RateLimitError is partial after the retries are used up, and a fail before", () => {
  const exhausted = classifyGemmaOutcome({
    outcome: { errorText: RL_429, toolCalls: [] },
    toolName: TOOL,
    attempts: 3,
    maxAttempts: 3,
  });
  assert.equal(exhausted.status, "partial");
  const early = classifyGemmaOutcome({
    outcome: { errorText: RL_429, toolCalls: [] },
    toolName: TOOL,
    attempts: 1,
    maxAttempts: 3,
  });
  assert.equal(early.status, "fail");
});

test("in-window: an empty DeepSeek answer whose trial window holds an upstream 503 is inconclusive, quoted with its time", () => {
  const log = [
    "2026-11-21T10:00:10.000000000Z INFO: POST /v1/chat/completions HTTP/1.1 200 OK",
    `2026-11-21T10:00:20.000000000Z LiteLLM Proxy:ERROR: proxy_server.py - Exception occured - ${SU_503}`,
  ].join("\n");
  const window = windowLines(log, "2026-11-21T10:00:00.000Z", "2026-11-21T10:01:00.000Z");
  const v = classifyEmptyAnswer(window);
  assert.equal(v.verdict, "inconclusive");
  assert.match(v.reason, /LiteLLM log at 2026-11-21T10:00:20\.000000000Z/);
});

test("in-window: an outage line outside this trial's window is not counted, so the empty answer is red (infra)", () => {
  // Trial 0 wrote the outage. Trial 1's own window holds a 200 OK completion and no error: the empty answer is ours.
  const log = [
    `2026-11-21T10:00:20.000000000Z LiteLLM Proxy:ERROR: proxy_server.py - Exception occured - ${BG_502}`,
    '2026-11-21T10:05:10.000000000Z INFO: POST /v1/chat/completions HTTP/1.1" 200 OK',
  ].join("\n");
  const trial1 = windowLines(log, "2026-11-21T10:05:00.000Z", "2026-11-21T10:06:00.000Z");
  assert.doesNotMatch(trial1, /BadGatewayError/);
  const v = classifyEmptyAnswer(trial1);
  assert.equal(v.verdict, "infra");
});

test("stall: a stream with a DeepSeek 500 in its window and an upstream call is inconclusive, quoted", () => {
  const window = [
    "2026-11-21T10:00:05.000000000Z INFO: POST /v1/chat/completions HTTP/1.1 (pending)",
    `2026-11-21T10:00:30.000000000Z LiteLLM Proxy:ERROR: proxy_server.py - Exception occured - ${IS_500}`,
  ].join("\n");
  const v = classifyStall(window);
  assert.equal(v.verdict, "inconclusive");
  assert.match(v.reason, /^INCONCLUSIVE: provider stalled or errored/);
});
