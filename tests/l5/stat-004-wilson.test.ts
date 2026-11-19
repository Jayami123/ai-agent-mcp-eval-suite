import { test } from "node:test";
import assert from "node:assert/strict";
import { publishedRate, round, wilsonInterval } from "../../src/stats/index.js";

// P4-STAT-004. Oracle (ledger): a known rate fixture produces the expected interval to the committed rounding,
// and artefacts show the interval, not a bare percentage.
const KNOWN: Array<[number, number, number, number]> = [
  // successes, n, lower, upper (4 decimal places; values from plan finding F7)
  [9, 10, 0.5958, 0.9821],
  [0, 10, 0, 0.2775],
  [10, 10, 0.7225, 1],
  [5, 10, 0.2366, 0.7634],
  [1, 1, 0.2065, 1],
  [50, 100, 0.4038, 0.5962],
];

test("P4-STAT-004: known rates give the committed intervals", () => {
  for (const [s, n, lower, upper] of KNOWN) {
    const p = publishedRate(s, n);
    assert.ok(p !== null, `${s}/${n} has an interval`);
    assert.deepEqual(p.interval, { lower, upper }, `${s}/${n}`);
  }
});

test("P4-STAT-004: the published rate is rounded and sits inside its interval", () => {
  const p = publishedRate(9, 10);
  assert.equal(p?.rate, 0.9);
  assert.ok((p?.interval.lower ?? 1) <= 0.9 && 0.9 <= (p?.interval.upper ?? 0));
});

test("P4-STAT-004: n = 0 has no interval (null, not 0 and not NaN)", () => {
  assert.equal(wilsonInterval(0, 0), null);
  assert.equal(publishedRate(0, 0), null);
});

test("P4-STAT-004: impossible counts throw", () => {
  assert.throws(() => wilsonInterval(11, 10), RangeError);
  assert.throws(() => wilsonInterval(-1, 10), RangeError);
  assert.throws(() => wilsonInterval(1.5, 10), RangeError);
});

test("P4-STAT-004: rounding is half up at 4 places and never returns -0", () => {
  assert.equal(round(0.12345), 0.1235);
  assert.ok(Object.is(round(-1e-17), 0));
});

test("P4-STAT-004: a wider sample gives a narrower interval at the same rate", () => {
  const small = wilsonInterval(5, 10);
  const large = wilsonInterval(50, 100);
  assert.ok(small !== null && large !== null);
  assert.ok(large.upper - large.lower < small.upper - small.lower);
});
