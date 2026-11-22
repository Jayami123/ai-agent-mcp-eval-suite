import type { LogEntry } from "../../../src/mock-channel/types.js";

/** The fields of a stub trace entry that decide whether a model call answered a turn (see tests/l4/support/stub-trace.ts). */
export interface AnswerCandidate {
  content?: string | null;
  toolCalls?: unknown[];
  error?: unknown;
}

export interface TurnState {
  ready: boolean;
  reason: string;
}

/**
 * Whether the turn for the latest inbound message has completed, read from real state only:
 *   - the mock channel log: the latest inbound message, and an outbound reply in the same chat sent after it (its seq is higher);
 *   - the stub trace: one model call that answers without a tool call, for each inbound message so far.
 * A tool-call step is not an answer. A call with an error is not an answer. The trace is not timestamped, so the count of answering
 * calls is compared with the count of inbound messages; each turn produces exactly one answering call.
 * Pure: no I/O, so the decision is unit tested in tests/l4/support/turn-state.test.ts.
 */
export function turnState(log: readonly LogEntry[], trace: readonly AnswerCandidate[]): TurnState {
  const inbound = log.filter((e) => e.dir === "inbound" && e.chatId !== undefined);
  const last = inbound[inbound.length - 1];
  if (last === undefined) return { ready: false, reason: "no inbound message in the mock channel log yet" };
  const reply = log.find((e) => e.dir === "outbound" && e.chatId === last.chatId && e.seq > last.seq);
  if (reply === undefined) return { ready: false, reason: `no outbound reply in chat ${last.chatId} after inbound seq ${last.seq} yet` };
  const answers = trace.filter((t) => (t.toolCalls?.length ?? 0) === 0 && typeof t.content === "string" && t.content !== "" && t.error == null).length;
  if (answers < inbound.length) {
    return { ready: false, reason: `${answers} answering model call(s) for ${inbound.length} inbound message(s)` };
  }
  return { ready: true, reason: `reply seq ${reply.seq} after inbound seq ${last.seq}; ${answers} answering call(s)` };
}
