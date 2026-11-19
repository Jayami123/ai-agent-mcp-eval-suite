// Every committed number for the stats lane lives in this file, one named constant each, with the reason next to it.
// A change to any value shows up as a one-line diff here and needs the reviewer's sign-off (plan section 3, approved 2026-11-18).
// Nothing in src/stats hard-codes these numbers elsewhere.

/** 95% two-sided normal quantile for Wilson intervals. Standard choice; the master plan asks for Wilson intervals at small n. */
export const Z_95 = 1.959963984540054;

/** Decimal places for every published rate and interval, so artefacts and fixtures compare byte for byte. */
export const ROUND_DP = 4;

/** Isolated trials per measured case. Master plan: default k = 10. */
export const DEFAULT_K = 10;

/** Minimum Cohen's kappa for the judge to be used as a gate. 0.6 is the usual lower edge of "substantial" agreement. */
export const KAPPA_MIN = 0.6;

/** Fewest labelled hold-out items on which a kappa counts. Below this a kappa is too noisy to trust. */
export const HOLDOUT_MIN_ITEMS = 20;

/** Most items (as a share) whose judge verdict may change when candidate order is swapped. Above it the judge is order-biased. */
export const ORDER_SWAP_MAX_FLIP_RATE = 0.1;

/** A pass-rate move larger than this after a prompt change is flagged for review (not failed). */
export const PROMPT_REGRESSION_BAND = 0.15;

/** Longest a flake may stay quarantined without a named reviewer. Keeps quarantine from becoming permanent by accident. */
export const MAX_QUARANTINE_DAYS = 30;

/** Tokens per trial before a budget annotation. Two heavy turns of about 6,000 tokens each (master plan planning figure). */
export const TOKENS_PER_TRIAL_BUDGET = 12_000;

/** Wall-clock per trial before a budget annotation. Half the 240 s chat timeout the L1 Gemma test uses. */
export const LATENCY_MS_PER_TRIAL_BUDGET = 120_000;

export const BUDGET = { tokensPerTrial: TOKENS_PER_TRIAL_BUDGET, latencyMsPerTrial: LATENCY_MS_PER_TRIAL_BUDGET } as const;

/** Free-tier tokens per minute for Gemma. The real bottleneck. Third-party figure, to be confirmed in AI Studio (master plan). */
export const TPM_LIMIT = 16_000;

/** Share of TPM_LIMIT the suite plans to use: 12,000 of 16,000. Leaves room for retries and other lanes' small calls. */
export const TPM_SAFETY = 0.75;

/** Tokens assumed for one heavy tool-using turn before its real usage is known. Master plan planning estimate. */
export const HEAVY_TURN_TOKENS = 6_000;

/** The rolling window the TPM limit applies to. */
export const THROTTLE_WINDOW_MS = 60_000;
