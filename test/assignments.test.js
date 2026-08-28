// Locks the pure half of assigned reads (src/lib/assignments.js): row shaping,
// the pending/decided split, the feedback self-heal, and duplicate detection.
// (DB access lives in assignmentService.js and is deliberately not mocked —
// matching the codebase's pure-function test style.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shapeAssignment,
  partitionAssignments,
  earliestFeedbackByScript,
  isDuplicateError,
} from '../src/lib/assignments.js';

const ROW = (over = {}) => ({
  id: 'a1',
  script_id: 's1',
  assigned_by: 'christopher-amell',
  note: 'Start here',
  created_at: '2026-07-01T10:00:00Z',
  decided_at: null,
  scripts: { title: 'The Carrier' },
  ...over,
});

test('shapeAssignment maps a joined row to the API shape', () => {
  assert.deepEqual(shapeAssignment(ROW()), {
    id: 'a1',
    scriptId: 's1',
    title: 'The Carrier',
    note: 'Start here',
    assignedBy: 'christopher-amell',
    createdAt: '2026-07-01T10:00:00Z',
  });
  // missing join / note → nulls, never undefined
  const bare = shapeAssignment(ROW({ scripts: null, note: null }));
  assert.equal(bare.title, null);
  assert.equal(bare.note, null);
});

test('partitionAssignments: undecided rows are pending, stamped rows are decided', () => {
  const rows = [
    ROW(),
    ROW({
      id: 'a2',
      script_id: 's2',
      decided_at: '2026-07-02T09:00:00Z',
      scripts: { title: 'Sequin & Stone' },
    }),
  ];
  const { pending, decided, heal } = partitionAssignments(rows, {});
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'a1');
  assert.equal(decided.length, 1);
  assert.equal(decided[0].id, 'a2');
  assert.equal(decided[0].decidedAt, '2026-07-02T09:00:00Z');
  assert.equal(heal.length, 0); // nothing to backfill
});

test('self-heal: existing feedback decides a pending assignment (at the feedback time) and queues the backfill', () => {
  const rows = [ROW()]; // decided_at null
  const feedbackAt = { s1: '2026-07-01T12:34:56Z' };
  const { pending, decided, heal } = partitionAssignments(rows, feedbackAt);
  assert.equal(pending.length, 0);
  assert.equal(decided.length, 1);
  assert.equal(decided[0].decidedAt, '2026-07-01T12:34:56Z');
  assert.deepEqual(heal, [{ id: 'a1', decidedAt: '2026-07-01T12:34:56Z' }]);
});

test('self-heal never overwrites an existing decided_at stamp', () => {
  const rows = [ROW({ decided_at: '2026-07-03T00:00:00Z' })];
  const { decided, heal } = partitionAssignments(rows, { s1: '2026-07-01T00:00:00Z' });
  assert.equal(decided[0].decidedAt, '2026-07-03T00:00:00Z'); // the stamp wins
  assert.equal(heal.length, 0);
});

test('feedback on a DIFFERENT script does not decide the assignment', () => {
  const { pending, decided } = partitionAssignments([ROW()], { s9: '2026-07-01T00:00:00Z' });
  assert.equal(pending.length, 1);
  assert.equal(decided.length, 0);
});

test('empty / missing inputs are safe', () => {
  assert.deepEqual(partitionAssignments([], {}), { pending: [], decided: [], heal: [] });
  assert.deepEqual(partitionAssignments(null), { pending: [], decided: [], heal: [] });
});

test('earliestFeedbackByScript keeps the EARLIEST timestamp per script and skips junk', () => {
  const at = earliestFeedbackByScript([
    { script_id: 's1', created_at: '2026-07-02T00:00:00Z' },
    { script_id: 's1', created_at: '2026-07-01T00:00:00Z' }, // earlier — wins
    { script_id: 's2', created_at: '2026-07-05T00:00:00Z' },
    { script_id: null, created_at: '2026-07-01T00:00:00Z' }, // junk
    { script_id: 's3', created_at: null }, // junk
  ]);
  assert.deepEqual(at, { s1: '2026-07-01T00:00:00Z', s2: '2026-07-05T00:00:00Z' });
  assert.deepEqual(earliestFeedbackByScript(null), {});
});

test('isDuplicateError matches Postgres unique violations and nothing else', () => {
  assert.equal(
    isDuplicateError(
      'duplicate key value violates unique constraint "reader_assignments_reader_id_script_id_key"',
    ),
    true,
  );
  assert.equal(isDuplicateError('error 23505'), true);
  assert.equal(isDuplicateError('connection refused'), false);
  assert.equal(isDuplicateError(null), false);
});
