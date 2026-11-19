// Pure helpers that put the served model id and token usage into the L1 Gemma record, so the record can pass the L5 trace
// schema (P4-STAT-006, P4-GATE-004). No I/O here: the e2e test fetches the JSON and passes it in.

export interface ServedModel {
  /** The upstream model LiteLLM routes the alias to, for example gemini/gemma-4-31b-it. The alias has no fallbacks (D14). */
  id: string;
  source: "litellm /model/info";
}

/**
 * Reads the upstream model for an alias from LiteLLM's GET /model/info body: { data: [{ model_name, litellm_params: { model } }] }.
 * Returns null when the alias is absent or has no model, so the caller records "unknown" instead of guessing.
 */
export function servedModelFromModelInfo(body: unknown, alias: string): ServedModel | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  for (const entry of data as Array<{ model_name?: unknown; litellm_params?: { model?: unknown } }>) {
    const model = entry?.litellm_params?.model;
    if (entry?.model_name === alias && typeof model === "string" && model !== "") return { id: model, source: "litellm /model/info" };
  }
  return null;
}

export interface UsageFields {
  /** null when the source does not carry it. Never guessed. */
  promptTokens: number | null;
  completionTokens: number | null;
  source: "message.usage" | "message.tokenCount" | "none";
}

const asCount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Token usage from a saved LibreChat assistant message. Prefers an OpenAI-style `usage` object; falls back to `tokenCount`,
 * which counts the reply only (so prompt tokens stay null). Which of these LibreChat v0.8.7 actually saves is unverified;
 * the first nightly record shows the `source` that worked.
 */
export function usageFromMessage(message: unknown): UsageFields {
  const m = (message ?? {}) as { usage?: Record<string, unknown>; tokenCount?: unknown };
  const u = m.usage;
  if (u !== undefined && u !== null && typeof u === "object") {
    const prompt = asCount(u["prompt_tokens"] ?? u["promptTokens"] ?? u["input_tokens"]);
    const completion = asCount(u["completion_tokens"] ?? u["completionTokens"] ?? u["output_tokens"]);
    if (prompt !== null || completion !== null) return { promptTokens: prompt, completionTokens: completion, source: "message.usage" };
  }
  const reply = asCount(m.tokenCount);
  if (reply !== null) return { promptTokens: null, completionTokens: reply, source: "message.tokenCount" };
  return { promptTokens: null, completionTokens: null, source: "none" };
}

/** Sums usage over attempts, keeping null when no attempt had a number. */
export function sumUsage(parts: readonly UsageFields[]): UsageFields {
  const add = (pick: (u: UsageFields) => number | null): number | null => {
    const nums = parts.map(pick).filter((n): n is number => n !== null);
    return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
  };
  const withSource = parts.find((p) => p.source !== "none");
  return { promptTokens: add((u) => u.promptTokens), completionTokens: add((u) => u.completionTokens), source: withSource?.source ?? "none" };
}
