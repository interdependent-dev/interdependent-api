import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenplayFormatGate } from '../src/services/formatGate.js';

test('clean screenplay passes the format gate', () => {
  const block = [
    'INT. KITCHEN - DAY',
    'Mia pours coffee and stares out the window at the rain.',
    'JOHN',
    'You sleep at all?',
    'MIA',
    'Define sleep.',
    'She sets the mug down. The phone buzzes. She ignores it.',
  ].join('\n');
  const text = Array(20).fill(block).join('\n');
  const r = screenplayFormatGate(text, { pageCount: 10 });
  assert.equal(r.ok, true);
  assert.ok(r.metrics.orphansPerPage < 0.4);
});

test('broken reflow with orphaned words is rejected', () => {
  // single lowercase words stranded on their own lines — the ReportLab-dump signature
  const block = [
    'Mia steps onto main street. An imperfect line of',
    'parking',
    'meters stretch down the single block. She pulls brass out',
    'along',
    'with a white chord. They',
    'sync',
    'their collections as they walk the street, the banner says daily',
    'counseling',
    'for the homeless under an',
    'awning',
  ].join('\n');
  const text = Array(4).fill(block).join('\n');
  const r = screenplayFormatGate(text, { pageCount: 6 });
  assert.equal(r.ok, false);
  assert.equal(r.reasons[0].code, 'broken_line_wrapping');
  assert.ok(r.metrics.orphansPerPage >= 0.4);
});

test('a tiny excerpt does not trip the rate (absolute floor)', () => {
  const r = screenplayFormatGate('along\nfor\nthe', { pageCount: 1 });
  assert.equal(r.ok, true);
});

test('sentence-ending short lines are NOT orphans', () => {
  // "trees." etc. end a wrapped sentence — legitimate, must not be flagged
  const block = ['The town wakes under a cold sky and no', 'trees.', 'A dog barks once, then', 'quiet.'].join('\n');
  // only "quiet." style (with period) — none are bare lowercase words, so 0 orphans
  const text = Array(30).fill(block).join('\n');
  const r = screenplayFormatGate(text, { pageCount: 5 });
  assert.equal(r.ok, true);
});
