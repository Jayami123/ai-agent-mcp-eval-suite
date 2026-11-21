// Provider outage: the upstream model did not serve the request (Vertex UNAVAILABLE, "high demand", overloaded, HTTP 503).
// One definition, shared by the L1 smoke classifier (gemma-classify.ts) and the measured L3 lanes (tests/l3/support/case.ts),
// so every lane reads an outage the same way. Never a pass: a lane that meets an outage with no answer is inconclusive.

// UNAVAILABLE is matched in capitals only (the Vertex status); lowercase "unavailable" in ordinary text is not an outage.
const UNAVAILABLE_STATUS = /\bUNAVAILABLE\b/;
const OUTAGE_WORDS = /high demand|overloaded|service unavailable|\b503\b|did not answer/i;

export function isProviderOutage(text: string): boolean {
  return UNAVAILABLE_STATUS.test(text) || OUTAGE_WORDS.test(text);
}

/**
 * The first provider log line that names an outage, with its HH:MM:SS timestamp (LiteLLM prints one at the start of each
 * line), or null when the log names none. A line with no timestamp is reported as "unknown time".
 */
export function outageLogLine(log: string): { time: string; line: string } | null {
  const lines = log.split("\n");
  const hit = lines.find((l) => isProviderOutage(l) && /^\d{2}:\d{2}:\d{2}/.test(l)) ?? lines.find((l) => isProviderOutage(l));
  if (hit === undefined) return null;
  const time = /^(\d{2}:\d{2}:\d{2})/.exec(hit)?.[1] ?? "unknown time";
  return { time, line: hit.trim().slice(0, 200) };
}

// ---- Stream timeout with no answer (measured lanes). ----
// A chat stream that times out gives no answer. The LiteLLM log for that trial's window decides what it was:
//   answered        a 200 OK completion for POST /v1/chat/completions: the provider answered, so the timeout is ours (infra)
//   errored/stalled a timestamped LiteLLM error or outage line: the provider stalled or failed (inconclusive, quoted)
//   no upstream     no POST /v1/chat/completions in the window: nothing reached the provider (infra)
//   pending         an upstream call with no completion and no error line (inconclusive)
// The timeout value itself is the existing named constant (APPROVAL_TIMEOUT_MS in tests/l3/support/approval.ts).

export interface StallVerdict {
  verdict: "inconclusive" | "infra";
  reason: string;
}

const CHAT_CALL = /POST \/v1\/chat\/completions/;
const CHAT_COMPLETED = /POST \/v1\/chat\/completions HTTP\/1\.1" 200/;

function stampOf(line: string): string | undefined {
  return /^(\d{2}:\d{2}:\d{2})/.exec(line)?.[1];
}

/** The log lines written during one trial. `before` is the log read at the trial's start; the window is what came after it. */
export function logWindow(before: string, after: string): string {
  const last = before.split("\n").filter((l) => l.trim() !== "").pop();
  if (last === undefined) return after;
  const at = after.lastIndexOf(last);
  return at >= 0 ? after.slice(at + last.length) : after;
}

export function classifyStall(window: string): StallVerdict {
  const lines = window.split("\n");
  if (lines.some((l) => CHAT_COMPLETED.test(l))) {
    return { verdict: "infra", reason: "provider answered (200 OK on POST /v1/chat/completions) and the stream still timed out" };
  }
  const errored = lines.find((l) => stampOf(l) !== undefined && (isProviderOutage(l) || /ERROR|Timeout|timed out/i.test(l)));
  if (errored !== undefined) {
    return { verdict: "inconclusive", reason: `INCONCLUSIVE: provider stalled or errored (LiteLLM log at ${stampOf(errored)}: ${errored.trim().slice(0, 200)})` };
  }
  const call = lines.filter((l) => CHAT_CALL.test(l)).pop();
  if (call === undefined) {
    return { verdict: "infra", reason: "no upstream call to the provider in this trial's LiteLLM log window" };
  }
  return { verdict: "inconclusive", reason: `INCONCLUSIVE: provider call still pending, no completion in the LiteLLM log (last: ${call.trim().slice(0, 200)})` };
}

/** A stream that ran out of time (the fetch or stream abort), as opposed to any other error. */
export function isStreamTimeout(err: { name?: string; message?: string }): boolean {
  return err.name === "TimeoutError" || err.name === "AbortError" || /timeout|timed out|aborted/i.test(err.message ?? "");
}

// ---- Empty answer (the turn finished with 0 characters). The same evidence guard as the stall path, in the other order. ----
// LiteLLM logs "200 OK" for a streaming completion even when the upstream stream errors partway, so an error line in the
// window wins over a 200 line:
//   errored         a timestamped upstream outage or error line in the window: inconclusive (quoted)
//   returned        a 200 OK completion with no error line: the provider returned content, so the empty answer is ours (red)
//   no upstream     no POST /v1/chat/completions in the window: nothing reached the provider (red)

export class EmptyAnswerError extends Error {
  override name = "EmptyAnswerError";
}

export function classifyEmptyAnswer(window: string): StallVerdict {
  const lines = window.split("\n");
  const errored = lines.find((l) => stampOf(l) !== undefined && (isProviderOutage(l) || /ERROR|Timeout|timed out/i.test(l)));
  if (errored !== undefined) {
    return { verdict: "inconclusive", reason: `INCONCLUSIVE: provider errored on the empty answer (LiteLLM log at ${stampOf(errored)}: ${errored.trim().slice(0, 200)})` };
  }
  if (lines.some((l) => CHAT_COMPLETED.test(l))) {
    return { verdict: "infra", reason: "empty answer although the provider returned a 200 OK completion with no error in the LiteLLM log" };
  }
  if (!lines.some((l) => CHAT_CALL.test(l))) {
    return { verdict: "infra", reason: "empty answer and no upstream call to the provider in this trial's LiteLLM log window" };
  }
  return { verdict: "infra", reason: "empty answer: an upstream call with no completion and no error in the LiteLLM log" };
}
