import { checkSeededText } from "./seed-check.js";
import { isProviderOutage, outageLogLine } from "./provider-outage.js";
import type { LcChatOutcome } from "./librechat-client.js";

// The Gemma nightly outcome rules, as a pure function so every branch has a unit test.
//   pass                 the tool was called with object arguments and the seeded-state check passed
//   partial              ONLY a 429 or RESOURCE_EXHAUSTED that is still there after every retry
//   blocked by provider  ONLY a safety refusal
//   inconclusive        a provider outage (UNAVAILABLE, high demand, 503): the model never answered, so there is no result.
//                        It never passes. The job fails with "INCONCLUSIVE: provider unavailable".
//   fail                 everything else: no tool call, wrong tool, bad arguments, a failed or unverified state check,
//                        any other error, and a rate limit seen before the retries were used up
//
// Order: rate limit first (existing rule), then outage, then safety, then the rest. An outage with an empty reply and no error
// text is read from the provider log (LiteLLM): the log names the outage and its timestamp.

export type GemmaStatus = "pass" | "fail" | "partial" | "blocked by provider" | "inconclusive";

export interface GemmaVerdict {
  status: GemmaStatus;
  reason: string;
  /** Present on pass and on state-check failures: the state check detail. */
  stateCheck?: string;
}

// LiteLLM's RateLimitError is its class for an upstream 429 (exception_mapping_utils.py), so it counts as a rate limit even
// when the upstream body does not repeat the number.
export function isRateLimited(text: string): boolean {
  return /\b429\b|RESOURCE_EXHAUSTED|\blitellm\.RateLimitError\b/.test(text);
}

export function isSafetyRefusal(text: string): boolean {
  return /content_filter|\bSAFETY\b/i.test(text);
}

export function classifyGemmaOutcome(input: {
  outcome: Pick<LcChatOutcome, "errorText" | "toolCalls"> & { text?: string };
  /** The provider (LiteLLM) container log, read after the run. Used only for an empty reply: it names an outage or not. */
  providerLog?: string;
  /** The MCP tool name as LibreChat sends it, for example list_object_metadata_names_mcp_twenty. */
  toolName: string;
  /** Chat attempts made, and the most the test allows. */
  attempts: number;
  maxAttempts: number;
}): GemmaVerdict {
  const { outcome, toolName, attempts, maxAttempts, providerLog } = input;

  if (outcome.errorText !== "") {
    if (isRateLimited(outcome.errorText)) {
      return attempts >= maxAttempts
        ? { status: "partial", reason: `rate limited (429 or RESOURCE_EXHAUSTED) after ${attempts} attempt(s)` }
        : { status: "fail", reason: `rate limited after only ${attempts} of ${maxAttempts} attempts: the retries were not used up` };
    }
    if (isProviderOutage(outcome.errorText)) {
      return { status: "inconclusive", reason: `INCONCLUSIVE: provider unavailable (LibreChat error: ${outcome.errorText.slice(0, 160)})` };
    }
    if (isSafetyRefusal(outcome.errorText)) {
      return { status: "blocked by provider", reason: "provider safety refusal" };
    }
    return { status: "fail", reason: "LibreChat reported an error that is not a rate limit or a safety refusal" };
  }

  // An empty reply with no error text: the provider log decides. An outage it names is inconclusive, never a pass.
  if (outcome.toolCalls.length === 0 && (outcome.text ?? "").trim() === "" && providerLog !== undefined) {
    const hit = outageLogLine(providerLog);
    if (hit !== null) {
      return { status: "inconclusive", reason: `INCONCLUSIVE: provider unavailable (empty reply; LiteLLM log at ${hit.time}: ${hit.line})` };
    }
  }
  if (outcome.toolCalls.length === 0) {
    return { status: "fail", reason: "no tool call in the saved assistant message" };
  }
  const listed = outcome.toolCalls.filter((c) => c.name === toolName);
  if (listed.length === 0) {
    return { status: "fail", reason: `no call to ${toolName} in the trajectory` };
  }
  if (!listed.every((c) => typeof c.arguments === "object" && c.arguments !== null)) {
    return { status: "fail", reason: `a ${toolName} call had non-object arguments` };
  }

  const state = checkSeededText(listed.map((c) => c.output ?? "").join("\n"));
  if (state.outcome !== "pass") {
    // "unverified" is not a pass and not a partial: it fails.
    return { status: "fail", reason: `state check ${state.outcome}: ${state.detail}`, stateCheck: state.detail };
  }
  return { status: "pass", reason: `${toolName} called ${listed.length} time(s); state check passed`, stateCheck: state.detail };
}
