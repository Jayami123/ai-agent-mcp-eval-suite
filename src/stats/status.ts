export type Mode = "stub" | "nightly";
/**
 * "blocked-no-answer": the turn finished with no final text, at least one approval pause was rejected, and the channel oracle
 * shows no write landed. It counts as a gate pass (see passk.ts). An empty turn without a rejected pause is never this status.
 */
export type TrialStatus = "pass" | "fail" | "partial" | "blocked by provider" | "blocked-no-answer" | "expectedDefect" | "skipped";
export const TRIAL_STATUSES: readonly TrialStatus[] = [
  "pass",
  "fail",
  "partial",
  "blocked by provider",
  "blocked-no-answer",
  "expectedDefect",
  "skipped",
];

/** P4_LLM_MODE. Unset or empty means stub. Anything else that is not stub or nightly throws (fail closed). */
export function parseMode(raw: string | undefined): Mode {
  if (raw === undefined || raw === "") return "stub";
  if (raw === "stub" || raw === "nightly") return raw;
  throw new Error(`P4_LLM_MODE must be stub or nightly, got: ${raw}`);
}

export function isRateLimited(text: string): boolean {
  return /\b429\b|RESOURCE_EXHAUSTED/.test(text);
}

export function isSafetyRefusal(text: string): boolean {
  return /content_filter|\bSAFETY\b/i.test(text);
}

export interface ProviderVerdict {
  status: "ok" | "partial" | "blocked by provider" | "fail";
  reason: string;
}

/** Same rules as tests/l1/gemma-classify.ts. A 429 is partial only when every retry was used. */
export function classifyProviderError(errorText: string, attempts: number, maxAttempts: number): ProviderVerdict {
  if (errorText === "") return { status: "ok", reason: "no provider error" };
  if (isRateLimited(errorText)) {
    return attempts >= maxAttempts
      ? { status: "partial", reason: `rate limited after ${attempts} attempt(s)` }
      : { status: "fail", reason: `rate limited after only ${attempts} of ${maxAttempts} attempts: retries not used up` };
  }
  if (isSafetyRefusal(errorText)) return { status: "blocked by provider", reason: "provider safety refusal" };
  return { status: "fail", reason: "provider error that is not a rate limit or a safety refusal" };
}
