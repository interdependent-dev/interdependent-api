// Stage 5 (taste-match discovery): "readers who read like you" — rank OTHER readers
// by verdict agreement on shared scripts, with a minimum-overlap guard.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = process.env.SUBMISSION_PASSCODE || '0000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy-jwt-secret-sixteen-plus';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@interdependent.studio';

test('rankTasteMatches: agreement-ranked, min-overlap enforced', async () => {
  const { rankTasteMatches } = await import('../src/services/discoveryService.js');
  const info = {
    R: { handle: 'r' },
    A: { handle: 'a', name: 'A' },
    B: { handle: 'b', name: 'B' },
    C: { handle: 'c', name: 'C' },
  };
  const feedback = [
    { reader_id: 'R', script_id: 's1', champion_verdict: 'recommend' },
    { reader_id: 'R', script_id: 's2', champion_verdict: 'pass' },
    { reader_id: 'R', script_id: 's3', champion_verdict: 'consider' },
    // A: agrees on s1+s2 (2/2 = 1.0)
    { reader_id: 'A', script_id: 's1', champion_verdict: 'recommend' },
    { reader_id: 'A', script_id: 's2', champion_verdict: 'pass' },
    // B: shares s1+s2+s3 but disagrees on s2 (2/3 ≈ 0.67)
    { reader_id: 'B', script_id: 's1', champion_verdict: 'recommend' },
    { reader_id: 'B', script_id: 's2', champion_verdict: 'recommend' },
    { reader_id: 'B', script_id: 's3', champion_verdict: 'consider' },
    // C: only 1 shared (< MIN_SHARED) → excluded
    { reader_id: 'C', script_id: 's1', champion_verdict: 'recommend' },
  ];
  const m = rankTasteMatches({ readerId: 'R', feedback, info });
  assert.equal(m.length, 2, 'A + B qualify; C excluded (below min overlap)');
  assert.equal(m[0].handle, 'a');
  assert.equal(m[0].score, 1);
  assert.equal(m[0].shared, 2);
  assert.equal(m[1].handle, 'b');
  assert.equal(m[1].shared, 3);
  assert.equal(m[1].agreed, 2);
  assert.ok(m[0].score > m[1].score);
});

test('rankTasteMatches: no opinions → no matches', async () => {
  const { rankTasteMatches } = await import('../src/services/discoveryService.js');
  assert.deepEqual(rankTasteMatches({ readerId: 'R', feedback: [], info: {} }), []);
});
