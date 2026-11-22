import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogEntry } from "../../../src/mock-channel/types.js";
import { turnState, type AnswerCandidate } from "./turn-state.js";

const inbound = (seq: number, chatId = 1001): LogEntry => ({ seq, dir: "inbound", chatId, text: "Remind me." });
const outbound = (seq: number, chatId = 1001): LogEntry => ({ seq, dir: "outbound", chatId, method: "sendMessage", text: "Done." });
const toolStep: AnswerCandidate = { content: null, toolCalls: [{ name: "memory_search" }], error: null };
const answer: AnswerCandidate = { content: "Done.", toolCalls: [], error: null };

test("turn state: no inbound message yet is not ready", () => {
  const s = turnState([], [answer]);
  assert.equal(s.ready, false);
  assert.match(s.reason, /no inbound message/);
});

test("turn state: the message is sent but no reply is logged yet is not ready, even with a model answer in the trace", () => {
  const s = turnState([inbound(1)], [answer]);
  assert.equal(s.ready, false);
  assert.match(s.reason, /no outbound reply in chat 1001 after inbound seq 1/);
});

test("turn state: the first model call is a tool step, not the answer: not ready (the MEM-002 race)", () => {
  const s = turnState([inbound(1), outbound(2)], [toolStep]);
  assert.equal(s.ready, false);
  assert.match(s.reason, /0 answering model call/);
});

test("turn state: a reply and an answering call are both present: ready", () => {
  const s = turnState([inbound(1), outbound(2)], [toolStep, answer]);
  assert.equal(s.ready, true);
  assert.match(s.reason, /reply seq 2 after inbound seq 1/);
});

test("turn state: an outbound message before the inbound one is not its reply", () => {
  const s = turnState([outbound(1), inbound(2)], [answer]);
  assert.equal(s.ready, false);
  assert.match(s.reason, /after inbound seq 2/);
});

test("turn state: a reply in another chat is not the reply to this message", () => {
  const s = turnState([inbound(1, 1001), outbound(2, 2002)], [answer]);
  assert.equal(s.ready, false);
});

test("turn state: an answering call with an error is not an answer", () => {
  const s = turnState([inbound(1), outbound(2)], [{ content: null, toolCalls: [], error: "upstream" }]);
  assert.equal(s.ready, false);
});

test("turn state: an empty string is not an answer", () => {
  const s = turnState([inbound(1), outbound(2)], [{ content: "", toolCalls: [], error: null }]);
  assert.equal(s.ready, false);
});

test("turn state: a second turn in the same session waits for its own answering call, not the first turn's", () => {
  // Two inbound messages, each with a reply, but only one answering call so far: the second turn is not done.
  const log = [inbound(1), outbound(2), inbound(3), outbound(4)];
  assert.equal(turnState(log, [answer]).ready, false);
  assert.equal(turnState(log, [answer, answer]).ready, true);
});
