import { ROUND_DP, Z_95 } from "./thresholds.js";

export interface Interval {
  lower: number;
  upper: number;
}

/** Wilson score interval. Returns null when n is 0 (no data is not a rate). Throws RangeError on bad counts. */
export function wilsonInterval(successes: number, n: number, z: number = Z_95): Interval | null {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || successes < 0 || n < 0 || successes > n) {
    throw new RangeError(`wilsonInterval needs integers with 0 <= successes <= n, got ${successes}/${n}`);
  }
  if (n === 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/** The committed rounding: half up at ROUND_DP places. Adding 0 turns -0 into 0 so JSON never shows "-0". */
export function round(x: number, dp: number = ROUND_DP): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f + 0;
}

export function roundInterval(i: Interval): Interval {
  return { lower: round(i.lower), upper: round(i.upper) };
}

/** What artefacts publish: rate and interval, both rounded. Null when n is 0. */
export function publishedRate(successes: number, n: number): { rate: number; interval: Interval } | null {
  const w = wilsonInterval(successes, n);
  if (w === null) return null;
  return { rate: round(successes / n), interval: roundInterval(w) };
}
