// Stage 1 of the read-first / Curator model — the AI-eval "wall".
//   - reader SESSION token (long-lived identity) minted at sign-in
//   - optionalReader middleware attaches req.reader from that token (never fails)
//   - isCuratorHandle: admin-allowlist OR Curator XP threshold
//   - curator resolution config (ADMIN_HANDLES, CURATOR_MIN_XP)
// Hermetic: dummy env, no network (only the admin/empty paths of isCuratorHandle,
// which short-circuit before any DB call).
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

// Satisfy src/config/env.js (validates process.env and exits on failure). Set the
// Curator config BEFORE any import pulls the env singleton.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = process.env.SUBMISSION_PASSCODE || '0000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy-jwt-secret-sixteen-plus';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@interdependent.studio';
process.env.ADMIN_HANDLES = 'chris-amell, Test-Admin';
process.env.CURATOR_MIN_XP = '700';

const SECRET = process.env.JWT_SECRET;

// ── env: Curator config parsing ───────────────────────────────────────────────
test('env: ADMIN_HANDLES → lowercased Set; CURATOR_MIN_XP parsed', async () => {
  const { env } = await import('../src/config/env.js');
  assert.ok(env.adminHandles instanceof Set);
  assert.equal(env.adminHandles.has('chris-amell'), true);
  assert.equal(env.adminHandles.has('test-admin'), true, 'trimmed + lowercased');
  assert.equal(env.adminHandles.has('unknown'), false);
  assert.equal(env.curatorMinXp, 700);
  assert.equal(typeof env.readerSessionExpiry, 'string');
});

// ── optionalReader middleware ─────────────────────────────────────────────────
test('optionalReader: valid reader_session token → req.reader', async () => {
  const { optionalReader } = await import('../src/middleware/optionalReader.js');
  const token = jwt.sign({ purpose: 'reader_session', readerId: 'r1', handle: 'jane' }, SECRET);
  const req = { headers: { 'x-reader-session': token } };
  let called = false;
  optionalReader(req, {}, () => { called = true; });
  assert.equal(called, true, 'always calls next()');
  assert.deepEqual(req.reader, { id: 'r1', handle: 'jane' });
});

test('optionalReader: also accepts a "Bearer " prefix', async () => {
  const { optionalReader } = await import('../src/middleware/optionalReader.js');
  const token = jwt.sign({ purpose: 'reader_session', readerId: 'r2', handle: 'joe' }, SECRET);
  const req = { headers: { 'x-reader-session': 'Bearer ' + token } };
  optionalReader(req, {}, () => {});
  assert.deepEqual(req.reader, { id: 'r2', handle: 'joe' });
});

test('optionalReader: wrong-purpose / missing / garbage token → anonymous (no req.reader)', async () => {
  const { optionalReader } = await import('../src/middleware/optionalReader.js');
  // wrong purpose (an action token must NOT unlock read identity here)
  const action = jwt.sign({ purpose: 'leaderboard_action', readerId: 'r3', handle: 'x' }, SECRET);
  let req = { headers: { 'x-reader-session': action } };
  optionalReader(req, {}, () => {});
  assert.equal(req.reader, undefined, 'action token rejected');
  // missing
  req = { headers: {} };
  let called = false;
  optionalReader(req, {}, () => { called = true; });
  assert.equal(req.reader, undefined);
  assert.equal(called, true);
  // garbage / wrong secret
  req = { headers: { 'x-reader-session': jwt.sign({ purpose: 'reader_session', readerId: 'z' }, 'other-secret-xxxxx') } };
  optionalReader(req, {}, () => {});
  assert.equal(req.reader, undefined, 'bad signature rejected');
});

// ── isCuratorHandle (admin + empty paths; no DB) ──────────────────────────────
test('isCuratorHandle: admin-allowlisted → true (case-insensitive); empty/null → false', async () => {
  const { isCuratorHandle } = await import('../src/services/xpService.js');
  assert.equal(await isCuratorHandle('chris-amell'), true);
  assert.equal(await isCuratorHandle('CHRIS-AMELL'), true, 'case-insensitive');
  assert.equal(await isCuratorHandle('Test-Admin'), true);
  assert.equal(await isCuratorHandle(''), false);
  assert.equal(await isCuratorHandle(null), false);
  assert.equal(await isCuratorHandle(undefined), false);
});

// ── requireAuth rejects identity/action tokens replayed as the portal credential ─
test('requireAuth: accepts the portal token only; rejects reader_session / action tokens', async () => {
  const { requireAuth } = await import('../src/middleware/requireAuth.js');
  function run(token) {
    let status = null, nexted = false;
    const req = { headers: token ? { authorization: 'Bearer ' + token } : {}, cookies: {} };
    const res = { status: (c) => { status = c; return { json: () => {} }; } };
    requireAuth(req, res, () => { nexted = true; });
    return { status, nexted, req };
  }
  let r = run(jwt.sign({ authenticated: true }, SECRET));
  assert.equal(r.nexted, true, 'portal token accepted');
  assert.equal(r.req.auth.authenticated, true);
  r = run(jwt.sign({ purpose: 'reader_session', readerId: 'x', handle: 'y' }, SECRET));
  assert.equal(r.nexted, false); assert.equal(r.status, 401);
  r = run(jwt.sign({ purpose: 'leaderboard_action', readerId: 'x', handle: 'y' }, SECRET));
  assert.equal(r.nexted, false, 'action token rejected as portal credential'); assert.equal(r.status, 401);
  assert.equal(run(null).status, 401);
});

// ── controller mints a session token at sign-in ──────────────────────────────
test('readerController exports the sign-in handlers (sessionToken wired in responses)', async () => {
  const mod = await import('../src/controllers/readerController.js');
  // The handlers that now return { actionToken, sessionToken, ... }.
  for (const fn of ['registerComplete', 'authComplete', 'addDeviceComplete', 'recoverComplete']) {
    assert.equal(typeof mod[fn], 'function', `${fn} exported`);
  }
});
