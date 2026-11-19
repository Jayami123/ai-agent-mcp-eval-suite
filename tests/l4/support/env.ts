// Gates for the L4 stack tests. P4_STACK_TESTS=1 is the flag L1 uses. The rest say what the started stack provides.
export type Need = "stack" | "channel" | "private-fetch" | "private-fixtures";

export const PRIVATE_FIXTURES_ENV = "P4_PRIVATE_FIXTURES_DIR";

/** The first unmet need as a named skip reason, or false when every need is met. */
export function skipReason(needs: Need[]): string | false {
  for (const need of needs) {
    if (need === "stack" && !(process.env["P4_STACK_TESTS"] === "1" && process.env["P4_L4_STACK"] === "1")) {
      return "needs the L4 stack (P4_STACK_TESTS=1 and P4_L4_STACK=1; npm run l4:up)";
    }
    if (need === "channel" && process.env["P4_L4_CHANNEL"] !== "1") return "needs the mock channel in the OpenClaw config (P4_L4_CHANNEL=1)";
    if (need === "private-fetch" && process.env["P4_L4_PRIVATE_FETCH"] !== "1") return "needs the web fetch host allowlist (P4_L4_PRIVATE_FETCH=1)";
    if (need === "private-fixtures" && (process.env[PRIVATE_FIXTURES_ENV] ?? "") === "") {
      return `private advisory fixtures not available (${PRIVATE_FIXTURES_ENV} unset)`;
    }
  }
  return false;
}
