import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEmptyAnswer, windowLines } from "./provider-outage.js";

// The trial window is read by time (docker logs --since/--until --timestamps). No text is matched against earlier output.
const TRACE = "litellm.exceptions.ServiceUnavailableError: Vertex_ai_betaException - UNAVAILABLE - This model is currently experiencing high demand.";
const line = (iso: string, text: string) => `${iso} ${text}`;

test("repeated traceback across trials: each trial's window sees only its own lines", () => {
  const log = [
    line("2026-11-21T10:03:14.000Z", "10:03:14 - LiteLLM Proxy:ERROR: UNAVAILABLE - high demand"),
    line("2026-11-21T10:03:15.000Z", TRACE),
    line("2026-11-21T10:04:29.000Z", "10:04:29 - LiteLLM Proxy:ERROR: UNAVAILABLE - high demand"),
    line("2026-11-21T10:04:30.000Z", TRACE),
  ].join("\n");
  const trial1 = classifyEmptyAnswer(windowLines(log, "2026-11-21T10:04:00.000Z", "2026-11-21T10:04:31.000Z"));
  assert.equal(trial1.verdict, "inconclusive");
  assert.match(trial1.reason, /2026-11-21T10:04:29\.000Z/);
  assert.doesNotMatch(trial1.reason, /10:03:14/);
  const trial0 = classifyEmptyAnswer(windowLines(log, "2026-11-21T10:03:00.000Z", "2026-11-21T10:03:59.000Z"));
  assert.equal(trial0.verdict, "inconclusive");
  assert.match(trial0.reason, /2026-11-21T10:03:14\.000Z/);
});

test("outage line inside the window: inconclusive, with the quoted UNAVAILABLE line and its timestamp", () => {
  const log = line("2026-11-21T10:04:29.000Z", "10:04:29 - LiteLLM Proxy:ERROR: UNAVAILABLE - high demand");
  const v = classifyEmptyAnswer(windowLines(log, "2026-11-21T10:04:00.000Z", "2026-11-21T10:05:00.000Z"));
  assert.equal(v.verdict, "inconclusive");
  assert.match(v.reason, /^INCONCLUSIVE: provider errored on the empty answer \(LiteLLM log at 2026-11-21T10:04:29\.000Z: /);
  assert.match(v.reason, /UNAVAILABLE - high demand/);
});

test("outage line just outside the window: not counted, so the empty answer is red", () => {
  const log = [
    line("2026-11-21T10:03:59.999Z", "10:03:59 - LiteLLM Proxy:ERROR: UNAVAILABLE - high demand"),
    line("2026-11-21T10:05:00.001Z", "10:05:00 - LiteLLM Proxy:ERROR: UNAVAILABLE - high demand"),
  ].join("\n");
  const v = classifyEmptyAnswer(windowLines(log, "2026-11-21T10:04:00.000Z", "2026-11-21T10:05:00.000Z"));
  assert.equal(v.verdict, "infra");
  assert.match(v.reason, /no upstream call to the provider/);
});

test("lines without a docker timestamp are not in the window", () => {
  assert.equal(windowLines("10:04:29 - LiteLLM Proxy:ERROR: UNAVAILABLE", "2026-11-21T10:04:00.000Z", "2026-11-21T10:05:00.000Z"), "");
});
