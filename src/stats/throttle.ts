import { HEAVY_TURN_TOKENS, THROTTLE_WINDOW_MS, TPM_LIMIT, TPM_SAFETY } from "./thresholds.js";

export interface ThrottleConfig {
  tpmLimit: number;
  safety: number;
  /** Tokens assumed for the next turn before its real usage is known. */
  estimateTokens: number;
  windowMs: number;
}

export const DEFAULT_THROTTLE: ThrottleConfig = {
  tpmLimit: TPM_LIMIT,
  safety: TPM_SAFETY,
  estimateTokens: HEAVY_TURN_TOKENS,
  windowMs: THROTTLE_WINDOW_MS,
};

export interface Throttle {
  /** Milliseconds to wait before the next heavy turn fits in the rolling window. 0 means go now. */
  waitMs(nowMs: number): number;
  /** Record real token usage after a turn. */
  record(tokens: number, nowMs: number): void;
}

/** Rolling-window token budget. The caller owns the clock and the sleeping, so this is a pure function of what it was told. */
export function createThrottle(cfg: ThrottleConfig = DEFAULT_THROTTLE): Throttle {
  const budget = Math.floor(cfg.tpmLimit * cfg.safety);
  if (cfg.estimateTokens > budget) throw new RangeError(`one estimated turn (${cfg.estimateTokens}) is larger than the budget (${budget})`);
  const used: Array<{ at: number; tokens: number }> = [];
  const prune = (now: number): void => {
    for (;;) {
      const first = used[0];
      if (first === undefined || first.at > now - cfg.windowMs) return;
      used.shift();
    }
  };
  return {
    waitMs(now) {
      prune(now);
      let total = used.reduce((sum, u) => sum + u.tokens, 0);
      if (total + cfg.estimateTokens <= budget) return 0;
      for (const u of used) {
        total -= u.tokens;
        if (total + cfg.estimateTokens <= budget) return Math.max(0, u.at + cfg.windowMs - now);
      }
      return cfg.windowMs;
    },
    record(tokens, now) {
      prune(now);
      used.push({ at: now, tokens });
    },
  };
}
