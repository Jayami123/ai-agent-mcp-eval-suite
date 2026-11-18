import { checkSeededText } from "./seed-check.js";
import type { LcChatOutcome } from "./librechat-client.js";

// The Gemma nightly outcome rules, as a pure function so every branch has a unit test.
//   pass                 the tool was called with object arguments and the seeded-state check passed
//   partial              ONLY a 429 or RESOURCE_EXHAUSTED that is still there after every retry
//   blocked by provider  ONLY a safety refusal
//   fail                 everything else: no tool call, wrong tool, bad arguments, a failed or unverified state check,
//                        any other error, and a rate limit seen before the retries were used up

export type GemmaStatus = "pass" | "fail" | "partial" | "blocked by provider";

export interface GemmaVerdict {
  status: GemmaStatus;
  reason: string;
  /** Present on pass and on state-check failures: the state check detail. */
  stateCheck?: string;
}

export function isRateLimited(text: string): boolean {
  return /\b429\b|RESOURCE_EXHAUSTED/.test(text);
}

export function isSafetyRefusal(text: string): boolean {
  return /content_filter|\bSAFETY\b/i.test(text);
}

export function classifyGemmaOutcome(input: {
  outcome: Pick<LcChatOutcome, "errorText" | "toolCalls">;
  /** The MCP tool name as LibreChat sends it, for example list_object_metadata_names_mcp_twenty. */
  toolName: string;
  /** Chat attempts made, and the most the test allows. */
  attempts: number;
  maxAttempts: number;
}): GemmaVerdict {
  const { outcome, toolName, attempts, maxAttempts } = input;

  if (outcome.errorText !== "") {
    if (isRateLimited(outcome.errorText)) {
      return attempts >= maxAttempts
        ? { status: "partial", reason: `rate limited (429 or RESOURCE_EXHAUSTED) after ${attempts} attempt(s)` }
        : { status: "fail", reason: `rate limited after only ${attempts} of ${maxAttempts} attempts: the retries were not used up` };
    }
    if (isSafetyRefusal(outcome.errorText)) {
      return { status: "blocked by provider", reason: "provider safety refusal" };
    }
    return { status: "fail", reason: "LibreChat reported an error that is not a rate limit or a safety refusal" };
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
