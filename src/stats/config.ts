// Non-numeric configuration for the stats lane. Numbers live in thresholds.ts.

/**
 * Models the owner has approved. Gemma, and DeepSeek Flash as the nightly model (owner decision, 2026-11-21). Any other model
 * is a new owner decision. The DeepSeek id is the one LiteLLM reports for the p4-nightly alias (deepseek/deepseek-flash).
 */
export const APPROVED_MODELS: readonly string[] = ["gemma-4-31b-it", "deepseek/deepseek-flash"];

/** LiteLLM may return the model id with or without a provider prefix (unverified; plan U1), so both are accepted. */
export function isApprovedModel(servedId: string, approved: readonly string[] = APPROVED_MODELS): boolean {
  return approved.some((a) => servedId === a || servedId.endsWith(`/${a}`));
}

/** The nightly slice. L3 and L4 add their measured IDs here by PR. Only IDs from the ledger. */
export const GOLDEN_SET: readonly string[] = ["P4-MCP-REL-006", "P4-MCP-INJ-013"];

/** Measured cases: a failed trial there is a measured result, not a failed gate. */
export const MEASURED_IDS: ReadonlySet<string> = new Set(["P4-MCP-REL-006", "P4-MCP-INJ-013"]);
