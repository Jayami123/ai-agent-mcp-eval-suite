// The nightly model key, by provider. One place, so the L1 smoke and every measured lane read it the same way.
// P4_NIGHTLY_PROVIDER: blank or "gemma" -> GEMINI_API_KEY; "deepseek" -> DEEPSEEK_API_KEY. Any other value throws, and the
// value is never printed (the same rule as the harness, P4_NIGHTLY_PROVIDER in qa-portfolio-harness v0.6.11).
// In nightly mode a missing key is a failure, never a skip: the nightly job also fails closed in the workflow.

export type NightlyProvider = "gemma" | "deepseek";
export type NightlyKeyName = "GEMINI_API_KEY" | "DEEPSEEK_API_KEY";

export function nightlyProvider(env: NodeJS.ProcessEnv): NightlyProvider {
  const raw = (env["P4_NIGHTLY_PROVIDER"] ?? "").trim();
  if (raw === "" || raw === "gemma") return "gemma";
  if (raw === "deepseek") return "deepseek";
  throw new Error('P4_NIGHTLY_PROVIDER must be "gemma" or "deepseek" (the value is not printed).');
}

export function nightlyKeyName(provider: NightlyProvider): NightlyKeyName {
  return provider === "deepseek" ? "DEEPSEEK_API_KEY" : "GEMINI_API_KEY";
}

/**
 * The key the selected provider needs. Throws, naming the variable and never its value, when it is missing.
 * Call this only in nightly mode.
 */
export function requireNightlyKey(env: NodeJS.ProcessEnv): string {
  const name = nightlyKeyName(nightlyProvider(env));
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set in the nightly environment. Refusing to run; no other model will be used.`);
  }
  return value;
}
