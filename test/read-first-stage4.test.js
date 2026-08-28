// Stage 4 (chat-XP reputation): a "good reader" earns from PEERS —
//   chatEndorsed = endorsements RECEIVED from OTHER champions (self excluded)
//   chatSparked  = your messages that drew a reply from someone ELSE (own replies excluded)
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

test('chat XP: endorsements-received + conversations-sparked, self-signals excluded', async () => {
  const { aggregateReaderStats } = await import('../src/lib/xpAggregate.js');
  const { scoreReader, ACTIONS } = await import('../src/lib/xpConfig.js');

  const readers = [
    { id: 'A', handle: 'a' },
    { id: 'B', handle: 'b' },
  ];
  const chat = {
    messages: [
      { id: 'm1', reader_id: 'A', parent_id: null }, // A posts
      { id: 'm2', reader_id: 'B', parent_id: 'm1' }, // B replies to A → A sparked a conversation
      { id: 'm3', reader_id: 'A', parent_id: 'm1' }, // A replies to own post → does NOT spark
    ],
    endorsements: [
      { message_id: 'm1', endorser_id: 'B' }, // B endorses A → A +1
      { message_id: 'm1', endorser_id: 'A' }, // A endorses own message → NOT counted
      { message_id: 'm2', endorser_id: 'A' }, // A endorses B → B +1
    ],
  };
  const stats = aggregateReaderStats({
    readers,
    events: [],
    champions: [],
    feedback: [],
    scripts: [],
    chat,
  });

  assert.equal(stats.A.chatEndorsed, 1, 'A: 1 endorsement from B (own excluded)');
  assert.equal(stats.A.chatSparked, 1, 'A: m1 drew a reply from B (own reply excluded)');
  assert.equal(stats.B.chatEndorsed, 1, 'B: 1 endorsement from A');
  assert.equal(stats.B.chatSparked, 0, 'B sparked nothing');

  const sa = scoreReader(stats.A);
  assert.equal(sa.breakdown.find((x) => x.action === 'chatEndorsed').xp, ACTIONS.chatEndorsed);
  assert.equal(sa.breakdown.find((x) => x.action === 'chatSparked').xp, ACTIONS.chatSparked);
  assert.ok(ACTIONS.chatEndorsed > 0 && ACTIONS.chatSparked > 0);
});

test('chat XP is zero when there is no chat data (fail-open default)', async () => {
  const { aggregateReaderStats } = await import('../src/lib/xpAggregate.js');
  const stats = aggregateReaderStats({
    readers: [{ id: 'A', handle: 'a' }],
    events: [],
    champions: [],
    feedback: [],
    scripts: [],
  });
  assert.equal(stats.A.chatEndorsed, 0);
  assert.equal(stats.A.chatSparked, 0);
});
