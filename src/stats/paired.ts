import { round, wilsonInterval } from "./wilson.js";

export interface Pair {
  candidate: boolean;
  baseline: boolean;
}

export interface PairedDelta {
  n: number;
  both: number;
  onlyCandidate: number;
  onlyBaseline: number;
  neither: number;
  candidateRate: number;
  baselineRate: number;
  /** candidate minus baseline. */
  delta: number;
  lower: number;
  upper: number;
}

/** Paired difference of two proportions with a Newcombe hybrid-score 95% interval. null for no pairs. Values are rounded to the committed places. */
export function pairedDelta(pairs: readonly Pair[]): PairedDelta | null {
  const n = pairs.length;
  if (n === 0) return null;
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (const p of pairs) {
    if (p.candidate && p.baseline) a++;
    else if (p.candidate) b++;
    else if (p.baseline) c++;
    else d++;
  }
  const p1 = (a + b) / n;
  const p2 = (a + c) / n;
  const w1 = wilsonInterval(a + b, n);
  const w2 = wilsonInterval(a + c, n);
  if (w1 === null || w2 === null) return null;
  const A = (a + b) * (c + d) * (a + c) * (b + d);
  const C = a * d - b * c;
  let phi = 0;
  if (A !== 0) {
    if (C > n / 2) phi = (C - n / 2) / Math.sqrt(A);
    else if (C < 0) phi = C / Math.sqrt(A);
  }
  const D = p1 - p2;
  const lo = D - Math.sqrt((p1 - w1.lower) ** 2 + (w2.upper - p2) ** 2 - 2 * phi * (p1 - w1.lower) * (w2.upper - p2));
  const hi = D + Math.sqrt((w1.upper - p1) ** 2 + (p2 - w2.lower) ** 2 - 2 * phi * (w1.upper - p1) * (p2 - w2.lower));
  return {
    n, both: a, onlyCandidate: b, onlyBaseline: c, neither: d,
    candidateRate: round(p1), baselineRate: round(p2),
    delta: round(D), lower: round(Math.max(-1, lo)), upper: round(Math.min(1, hi)),
  };
}
