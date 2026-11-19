/** One oracle result. "unverified" is never a pass (same rule as tests/l1/seed-check.ts). */
export type Outcome = "pass" | "fail" | "unverified";

export interface Verdict {
  outcome: Outcome;
  /** What was checked and what was found. Never a token, a header value or a password. */
  detail: string;
}

export const pass = (detail: string): Verdict => ({ outcome: "pass", detail });
export const fail = (detail: string): Verdict => ({ outcome: "fail", detail });
export const unverified = (detail: string): Verdict => ({ outcome: "unverified", detail });

/** An empty list is unverified: a case that asserted nothing about state or trace has not passed. */
export function combine(verdicts: Verdict[]): Verdict {
  if (verdicts.length === 0) return unverified("no oracle verdict was produced");
  const failed = verdicts.filter((v) => v.outcome === "fail");
  if (failed.length > 0) return fail(failed.map((v) => v.detail).join("; "));
  const open = verdicts.filter((v) => v.outcome === "unverified");
  if (open.length > 0) return unverified(open.map((v) => v.detail).join("; "));
  return pass(verdicts.map((v) => v.detail).join("; "));
}
