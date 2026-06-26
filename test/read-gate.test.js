// Locks the reading-progress logic for the API copy of the gate. The portal ships
// an identical suite over its own copy — change one, change both; both must stay
// green. Run: `npm test` (from interdependent-api/).
import test from 'node:test';
import assert from 'node:assert';
import { readingPct, isFinishedRead } from '../src/lib/readGate.js';

// [name, depth%, activeSeconds, pages, expectedReadingPct, expectedFinished]
// Identical vectors to site/test/read-gate.test.js.
const CASES = [
  ['genuine full read',           96, 4000, 110, 96, true],
  ['sub-minute skim (the bug)',  100,   50, 110,  2, false],
  ['fast-scroll skim',           100,   20, 110,  1, false],
  ['partial real read',           92, 1900, 110, 86, true],
  ['read half, carefully',        50, 2000, 110, 50, false],
  ['short script, real read',     95,  700,  30, 95, true],
  ['short script, skim',          95,   60,  30, 10, false],
  ['unknown pages, real read',    90, 2200, null, 90, true],
  ['unknown pages, skim',        100,   30, null,  2, false],
  ['exactly at the finish bar',   85, 1700, 100, 85, true],
  ['one notch under the bar',     85, 1680, 100, 84, false],
];

for (const [name, d, s, p, expectPct, expectFin] of CASES) {
  test(name, () => {
    assert.strictEqual(readingPct(d, s, p), expectPct, 'readingPct');
    assert.strictEqual(isFinishedRead(d, s, p), expectFin, 'isFinishedRead');
  });
}

test('garbage inputs are safe', () => {
  assert.strictEqual(readingPct(undefined, undefined, undefined), 0);
  assert.strictEqual(isFinishedRead(null, null, null), false);
});
