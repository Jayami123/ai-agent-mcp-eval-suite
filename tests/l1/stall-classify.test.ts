import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStall, isStreamTimeout, logWindow } from "./provider-outage.js";

const CALL = 'INFO:     172.18.0.4:52526 - "POST /v1/chat/completions HTTP/1.1" 200 OK';
const CALL_NO_ANSWER = 'INFO:     172.18.0.4:52526 - "POST /v1/chat/completions HTTP/1.1" 503 Service Unavailable';
const OUTAGE = "23:19:06 - LiteLLM Proxy:ERROR: proxy_server.py:11039 - Exception occured - litellm.ServiceUnavailableError: Vertex_ai_betaException - UNAVAILABLE - This model is currently experiencing high demand.";

test("provider stall: an upstream call with an outage error in the window is inconclusive, with the quoted line and its timestamp", () => {
  const v = classifyStall([CALL_NO_ANSWER, OUTAGE].join("\n"));
  assert.equal(v.verdict, "inconclusive");
  assert.match(v.reason, /^INCONCLUSIVE: provider stalled or errored \(LiteLLM log at 23:19:06: 23:19:06 - LiteLLM Proxy:ERROR/);
});

test("provider stall: a call still pending with no completion and no error is inconclusive", () => {
  const v = classifyStall('22:14:02 - LiteLLM Proxy: request started\nINFO:     172.18.0.4:52526 - "POST /v1/chat/completions HTTP/1.1"');
  assert.equal(v.verdict, "inconclusive");
  assert.match(v.reason, /still pending, no completion/);
});

test("provider answered but the stream still timed out: infra fail, not inconclusive", () => {
  const v = classifyStall([CALL, OUTAGE].join("\n"));
  assert.equal(v.verdict, "infra");
  assert.match(v.reason, /provider answered \(200 OK on POST \/v1\/chat\/completions\)/);
});

test("no upstream call in the window: infra fail", () => {
  const v = classifyStall("22:14:02 - LiteLLM Proxy: health check ok");
  assert.equal(v.verdict, "infra");
  assert.match(v.reason, /no upstream call to the provider/);
});

test("log window: only the lines written after the trial started", () => {
  const before = "line one\nline two";
  const after = "line one\nline two\n23:00:00 new line";
  assert.equal(logWindow(before, after), "\n23:00:00 new line");
  assert.equal(logWindow("", after), after);
});

test("stream timeout: a TimeoutError or AbortError is a stream timeout; an ordinary error is not", () => {
  assert.equal(isStreamTimeout({ name: "TimeoutError", message: "The operation was aborted due to timeout" }), true);
  assert.equal(isStreamTimeout({ name: "AbortError", message: "" }), true);
  assert.equal(isStreamTimeout({ name: "Error", message: "something else broke" }), false);
});
