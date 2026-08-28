// HTTP-level tests for the force re-evaluation gate on /scripts/:id/retry and
// /scripts/:id/logline: forced runs are curator/staff-only, and both endpoints
// share a per-user rate limit (10 per 10 min) even for curators.
//
// The Supabase URL points at a local stub that 500s every request, so any
// handler that reaches the database fails fast — which is exactly the signal we
// want for "got PAST the auth/rate gates" without a live database. Curator
// status for the staff path comes from ADMIN_HANDLES (a pure Set lookup, no
// network); non-admin handles fall through isCuratorHandle's XP lookup, whose
// DB errors resolve to "not a curator". Full happy-path coverage belongs to the
// integration-harness ticket (INTE-Y91U5H).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const dbStub = http.createServer((_req, res) => {
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'db stub: no database in this suite' }));
});
await new Promise((resolve) => dbStub.listen(0, '127.0.0.1', resolve));
test.after(() => dbStub.close());

// Satisfy src/config/env.js (which validates process.env and exits on failure)
// BEFORE any src import.
process.env.ANTHROPIC_API_KEY = 'sk-ant-dummy';
process.env.SUPABASE_URL = `http://127.0.0.1:${dbStub.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = '0000';
process.env.JWT_SECRET = 'dummy-jwt-secret-0123456789abcdef';
process.env.RESEND_API_KEY = 're_dummy';
process.env.EMAIL_FROM = 'noreply@interdependent.studio';
process.env.ADMIN_HANDLES = 'staff-admin';

const express = (await import('express')).default;
const jwt = (await import('jsonwebtoken')).default;
const scriptsRouter = (await import('../src/routes/scripts.js')).default;
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/scripts', scriptsRouter);
app.use(errorHandler);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const SECRET = process.env.JWT_SECRET;
const portalToken = jwt.sign({ authenticated: true }, SECRET);
const readerSession = (readerId, handle) =>
  jwt.sign({ purpose: 'reader_session', readerId, handle }, SECRET);

// POST helper. `reader` = { readerId, handle } or null for an anonymous
// (passcode-only) portal caller.
async function post(path, reader) {
  const headers = { Authorization: `Bearer ${portalToken}` };
  if (reader) headers['X-Reader-Session'] = readerSession(reader.readerId, reader.handle);
  const res = await fetch(`${base}${path}`, { method: 'POST', headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('unauthenticated request is still refused outright', async () => {
  const res = await fetch(`${base}/scripts/s1/retry?force=1`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('force retry: 403 for an anonymous portal caller (no reader session)', async () => {
  const { status, body } = await post('/scripts/s1/retry?force=1', null);
  assert.equal(status, 403);
  assert.equal(body.code, 'curator_required');
});

test('force retry: 403 for a non-curator reader', async () => {
  const { status, body } = await post('/scripts/s1/retry?force=1', { readerId: 'r-plain', handle: 'plain-reader' });
  assert.equal(status, 403);
  assert.equal(body.code, 'curator_required');
});

test('force logline: 403 for a non-curator reader, any truthy force value', async () => {
  for (const qs of ['force=1', 'force=true']) {
    const { status, body } = await post(`/scripts/s1/logline?${qs}`, { readerId: 'r-plain2', handle: 'plain-reader-2' });
    assert.equal(status, 403, qs);
    assert.equal(body.code, 'curator_required');
  }
});

test('force retry: staff/curator passes the gate', async () => {
  const { status } = await post('/scripts/s1/retry?force=1', { readerId: 'r-staff', handle: 'staff-admin' });
  // Past auth + curator gate, the handler hits the (unreachable) database — any
  // 5xx proves the request was allowed through; 401/403/429 would mean gated.
  assert.ok(![401, 403, 429].includes(status), `expected gate pass, got ${status}`);
});

test('force logline: staff/curator passes the gate', async () => {
  const { status } = await post('/scripts/s1/logline?force=1', { readerId: 'r-staff', handle: 'staff-admin' });
  assert.ok(![401, 403, 429].includes(status), `expected gate pass, got ${status}`);
});

test('non-forced retry and logline skip the curator gate for regular readers', async () => {
  for (const path of ['/scripts/s1/retry', '/scripts/s1/logline']) {
    const { status } = await post(path, { readerId: 'r-plain3', handle: 'plain-reader-3' });
    assert.notEqual(status, 403, path);
    assert.notEqual(status, 429, path);
  }
});

test('11th rapid request from one user returns 429 — even for a curator', async () => {
  const reader = { readerId: 'r-limit-staff', handle: 'staff-admin' };
  // Retry and logline share one per-user budget of 10 per 10 minutes.
  for (let i = 1; i <= 10; i++) {
    const path = i % 2 ? '/scripts/s1/retry?force=1' : '/scripts/s1/logline?force=1';
    const { status } = await post(path, reader);
    assert.notEqual(status, 429, `request ${i} should be under the limit`);
  }
  const { status, body } = await post('/scripts/s1/retry?force=1', reader);
  assert.equal(status, 429);
  assert.match(body.error, /re-evaluation/);
});

test('the limit is per-user: another reader is not starved by the exhausted one', async () => {
  const { status } = await post('/scripts/s1/retry?force=1', { readerId: 'r-fresh', handle: 'fresh-reader' });
  assert.equal(status, 403); // non-curator → gated, but NOT 429
});
