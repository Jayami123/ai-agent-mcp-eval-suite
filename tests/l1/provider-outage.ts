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
