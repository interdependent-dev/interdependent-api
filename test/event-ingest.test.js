// POST /events trust model — reader attribution comes ONLY from the verified
// session, never from the body. Locks the pure sanitizer (lib/eventIngest.js)
// and the route wiring (optionalReader attached). Hermetic: dummy env, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeReadEvent, EVENT_TYPES } from '../src/lib/eventIngest.js';

// Satisfy src/config/env.js for the route-wiring test (validates process.env).
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = process.env.SUBMISSION_PASSCODE || '0000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy-jwt-secret-sixteen-plus';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@interdependent.studio';

const SCRIPT = '11111111-2222-3333-4444-555555555555';
const FORGED = '99999999-8888-7777-6666-555555555555';
const VERIFIED = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ── the security property: body reader_id is never trusted ───────────────────
test('a forged body reader_id is IGNORED — anonymous without a session', () => {
  const out = sanitizeReadEvent({ event_type: 'read_progress', script_id: SCRIPT, reader_id: FORGED });
  assert.ok(out, 'event is still accepted (anonymous analytics)');
  assert.equal(out.readerId, null, 'no session → no reader attribution, whatever the body says');
});

test('attribution comes from the verified session id, body reader_id still ignored', () => {
  const out = sanitizeReadEvent(
    { event_type: 'read_progress', script_id: SCRIPT, reader_id: FORGED },
    VERIFIED,
  );
  assert.equal(out.readerId, VERIFIED, 'verified session identity wins');
});

test('recommender stays body-supplied display-name attribution', () => {
  const out = sanitizeReadEvent({ event_type: 'recommend_open', recommender: 'Jane Doe' });
  assert.equal(out.recommender, 'Jane Doe');
});

// ── existing drop/clamp semantics preserved ───────────────────────────────────
test('unknown event type or malformed script_id → null (dropped)', () => {
  assert.equal(sanitizeReadEvent({ event_type: 'nope' }, VERIFIED), null);
  assert.equal(sanitizeReadEvent({ event_type: 'script_view', script_id: 'not-a-uuid' }), null);
  assert.equal(sanitizeReadEvent(undefined, VERIFIED), null, 'missing body is safe');
});

test('free text is control-char-stripped and length-capped', () => {
  const out = sanitizeReadEvent({
    event_type: 'script_view',
    session_id: 's'.repeat(100),
    recommender: 'Bad\x00\x1fGuy\x7f',
    source: 'recommend-page-extra-long-source',
  });
  assert.equal(out.sessionId.length, 64);
  assert.equal(out.recommender, 'BadGuy');
  assert.equal(out.source.length, 20);
});

test('numbers are clamped and floored; absent fields stay null', () => {
  const out = sanitizeReadEvent({
    event_type: 'read_progress', depth_pct: 250, seconds: -5, page: 3.7,
  });
  assert.equal(out.depthPct, 100);
  assert.equal(out.seconds, 0);
  assert.equal(out.page, 3);
  assert.equal(out.totalPages, null);
});

test('EVENT_TYPES still covers the portal beacon vocabulary', () => {
  for (const t of ['read_progress', 'read_complete', 'script_view', 'recommend_open', 'champion']) {
    assert.ok(EVENT_TYPES.has(t), `${t} accepted`);
  }
});

// ── route wiring: optionalReader sits in front of the handler ────────────────
test('POST /events mounts with optionalReader in the chain', async () => {
  const mod = await import('../src/routes/events.js');
  const layer = mod.default.stack.find((l) => l.route && l.route.path === '/');
  assert.ok(layer, 'POST / is mounted');
  assert.ok(layer.route.methods.post, 'method is POST');
  const names = layer.route.stack.map((s) => s.name);
  assert.ok(names.includes('optionalReader'), `optionalReader attached (saw: ${names.join(', ')})`);
});
