// Stage 3 (read-first opinion loop): the earlyOpinionSpot reward — you left the
// FIRST human opinion on a script you FINISHED, and the crowd followed. Anti-farm:
// requires (first) AND (finished read) AND (≥1 other opinion).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = process.env.SUBMISSION_PASSCODE || '0000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy-jwt-secret-sixteen-plus';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@interdependent.studio';

test('earlyOpinionSpot: first FINISHED opinion on a crowd-validated script earns it; farming is blocked', async () => {
  const { aggregateReaderStats } = await import('../src/lib/xpAggregate.js');
  const { scoreReader, ACTIONS } = await import('../src/lib/xpConfig.js');

  const readers = [{ id: 'A', handle: 'a', display_name: 'A' }, { id: 'B', handle: 'b', display_name: 'B' }];
  const scripts = [{ id: 'S', page_count: 10 }, { id: 'T', page_count: 10 }];
  // A finished reading S (depth 95, seconds 220 ≥ 0.85*10*20). B did not read anything.
  const events = [{ event_type: 'read_progress', reader_id: 'A', script_id: 'S', depth_pct: 95, seconds: 220 }];
  const feedback = [
    // S: A first (earlier), B follows → crowd-validated + A finished → counts for A.
    { reader_id: 'A', script_id: 'S', created_at: '2026-07-01T00:00:00Z', champion_verdict: 'recommend', text: 'x' },
    { reader_id: 'B', script_id: 'S', created_at: '2026-07-01T01:00:00Z', champion_verdict: 'consider', text: 'y' },
    // T: A is the ONLY opinion (no crowd) AND A never finished T → must NOT count (anti-farm).
    { reader_id: 'A', script_id: 'T', created_at: '2026-07-01T00:00:00Z', champion_verdict: 'pass', text: 'z' },
  ];

  const stats = aggregateReaderStats({ readers, events, champions: [], feedback, scripts, featuredScriptId: null });
  assert.equal(stats.A.earlyOpinions, 1, 'A: first + finished + crowd on S (T excluded: no crowd / unfinished)');
  assert.equal(stats.B.earlyOpinions, 0, 'B opined second');

  const scored = scoreReader(stats.A);
  const eo = scored.breakdown.find((b) => b.action === 'earlyOpinionSpot');
  assert.equal(eo.count, 1);
  assert.equal(eo.xp, ACTIONS.earlyOpinionSpot);
  assert.ok(ACTIONS.earlyOpinionSpot > 0);
});
