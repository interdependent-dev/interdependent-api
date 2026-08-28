// HTTP-level integration harness: mounts the REAL src/app.js (all routers,
// CORS, body parsing, error handler) on an ephemeral listener and issues real
// requests with fetch. Hermetic — dummy env vars, no network, no credentials:
// the Supabase URL points at a local stub that 500s every request, so any
// handler that reaches the database fails fast, which doubles as the signal
// for "got PAST the auth/authz gates". Curator status for the staff path comes
// from ADMIN_HANDLES (a pure Set lookup, no network). /health?deep=1 is never
// exercised — it makes real Anthropic calls by design.
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
process.env.SUBMISSION_PASSCODE = '4242';
process.env.JWT_SECRET = 'dummy-jwt-secret-0123456789abcdef';
process.env.RESEND_API_KEY = 're_dummy';
process.env.EMAIL_FROM = 'noreply@interdependent.studio';
process.env.ADMIN_HANDLES = 'staff-admin';

const jwt = (await import('jsonwebtoken')).default;
const app = (await import('../src/app.js')).default;

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const SECRET = process.env.JWT_SECRET;
const portalToken = jwt.sign({ authenticated: true }, SECRET);
const readerSession = (readerId, handle) =>
  jwt.sign({ purpose: 'reader_session', readerId, handle }, SECRET);
const actionToken = (readerId, handle) =>
  jwt.sign({ purpose: 'leaderboard_action', readerId, handle }, SECRET);

async function request(method, path, { headers = {}, body, json } = {}) {
  if (json !== undefined) {
    headers = { 'Content-Type': 'application/json', ...headers };
    body = JSON.stringify(json);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}
const auth = (token) => ({ Authorization: `Bearer ${token}` });

// ── Public surface ──────────────────────────────────────────────────────────

test('GET /health → 200 { status: "ok" } with no auth', async () => {
  const { status, body } = await request('GET', '/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'ok' });
});

test('GET /xp/config → 200, public economy shape, no reader data', async () => {
  const { status, headers, body } = await request('GET', '/xp/config');
  assert.equal(status, 200);
  assert.equal(headers.get('cache-control'), 'public, max-age=300');
  assert.ok(Array.isArray(body.levels) && body.levels.length > 0);
  for (const level of body.levels) {
    assert.ok(typeof level.key === 'string' && typeof level.min === 'number');
  }
  assert.ok(body.actions && typeof body.actions === 'object');
  assert.equal(typeof body.barMax, 'number');
  assert.equal(typeof body.featuredTitle, 'string');
  // The DB stub fails every query — best-effort featured-script resolution
  // must degrade to null, never 500 the endpoint.
  assert.equal(body.featuredScriptId, null);
});

test('unknown route → 404 { error: "Not found" }', async () => {
  const { status, body } = await request('GET', '/definitely-not-a-route');
  assert.equal(status, 404);
  assert.deepEqual(body, { error: 'Not found' });
});

test('CORS: disallowed origin is refused with 403', async () => {
  const { status, body } = await request('GET', '/health', {
    headers: { Origin: 'https://evil.example.com' },
  });
  assert.equal(status, 403);
  assert.match(body.error, /^CORS:/);
});

test('CORS: allowed origin is echoed back', async () => {
  const origin = 'https://www.interdependent.studio';
  const { status, headers } = await request('GET', '/health', { headers: { Origin: origin } });
  assert.equal(status, 200);
  assert.equal(headers.get('access-control-allow-origin'), origin);
});

// ── Auth verify ─────────────────────────────────────────────────────────────

test('POST /auth/verify: missing passcode → 400', async () => {
  const { status, body } = await request('POST', '/auth/verify', { json: {} });
  assert.equal(status, 400);
  assert.match(body.error, /passcode is required/);
});

test('POST /auth/verify: wrong passcode → 401', async () => {
  const { status, body } = await request('POST', '/auth/verify', { json: { passcode: '9999' } });
  assert.equal(status, 401);
  assert.match(body.error, /Invalid passcode/);
});

test('POST /auth/verify: correct passcode → 200 with a token the API accepts', async () => {
  const { status, body } = await request('POST', '/auth/verify', { json: { passcode: '4242' } });
  assert.equal(status, 200);
  assert.ok(typeof body.token === 'string' && body.token.length > 0);
  assert.equal(typeof body.expiresIn, 'number');
  const payload = jwt.verify(body.token, SECRET);
  assert.equal(payload.authenticated, true);

  // The minted token opens a protected route (401 would mean rejected; the
  // handler then dies on the stubbed DB, which is fine — the gate is the test).
  const probe = await request('GET', '/scripts', { headers: auth(body.token) });
  assert.notEqual(probe.status, 401);
});

test('protected routes without a token → 401', async () => {
  for (const [method, path] of [
    ['GET', '/scripts'],
    ['GET', '/xp/leaderboard'],
    ['POST', '/evaluate'],
  ]) {
    const { status, body } = await request(method, path);
    assert.equal(status, 401, `${method} ${path}`);
    assert.match(body.error, /Authentication required/);
  }
});

test('a reader-session token replayed as Authorization does not pass the passcode gate', async () => {
  const { status } = await request('GET', '/scripts', {
    headers: auth(readerSession('r1', 'some-reader')),
  });
  assert.equal(status, 401);
});

// ── POST /evaluate — upload path validation ────────────────────────────────

test('POST /evaluate: multipart with no fields → 400 (one "Required" per missing field)', async () => {
  const form = new FormData();
  const { status, body } = await request('POST', '/evaluate', {
    headers: auth(portalToken),
    body: form,
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'Required; Required; Required'); // name, email, title
});

test('POST /evaluate: invalid email → 400 naming the field', async () => {
  const form = new FormData();
  form.set('name', 'Test Writer');
  form.set('email', 'not-an-email');
  form.set('title', 'Untitled');
  const { status, body } = await request('POST', '/evaluate', {
    headers: auth(portalToken),
    body: form,
  });
  assert.equal(status, 400);
  assert.match(body.error, /email must be a valid email address/);
});

test('POST /evaluate: valid fields but no file → 400', async () => {
  const form = new FormData();
  form.set('name', 'Test Writer');
  form.set('email', 'writer@example.com');
  form.set('title', 'Untitled');
  const { status, body } = await request('POST', '/evaluate', {
    headers: auth(portalToken),
    body: form,
  });
  assert.equal(status, 400);
  assert.match(body.error, /script PDF file is required/);
});

test('POST /evaluate: non-PDF upload → 400 from the file filter', async () => {
  const form = new FormData();
  form.set('name', 'Test Writer');
  form.set('email', 'writer@example.com');
  form.set('title', 'Untitled');
  form.set('script', new Blob(['not a pdf'], { type: 'text/plain' }), 'script.txt');
  const { status, body } = await request('POST', '/evaluate', {
    headers: auth(portalToken),
    body: form,
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'Only PDF files are accepted');
});

test('POST /evaluate: valid submission clears validation and reaches the (stubbed) DB', async () => {
  const form = new FormData();
  form.set('name', 'Test Writer');
  form.set('email', 'writer@example.com');
  form.set('title', 'Untitled');
  form.set('script', new Blob(['%PDF-1.4 dummy'], { type: 'application/pdf' }), 'script.pdf');
  const { status } = await request('POST', '/evaluate', {
    headers: auth(portalToken),
    body: form,
  });
  // upsertUser is the first DB write — the stub 500s it, proving the request
  // got past auth + multer + field validation (401/400 would mean gated).
  assert.equal(status, 500);
});

// ── Scripts authz (incl. curator gate) ─────────────────────────────────────

test('GET /scripts with a portal token reaches the handler (past auth)', async () => {
  const { status } = await request('GET', '/scripts', { headers: auth(portalToken) });
  assert.equal(status, 500); // stubbed DB — but not 401/403
});

test('POST /scripts/:id/retry?force=1: 403 curator_required for a non-curator reader', async () => {
  const { status, body } = await request('POST', '/scripts/s1/retry?force=1', {
    headers: { ...auth(portalToken), 'X-Reader-Session': readerSession('r-plain', 'plain-reader') },
  });
  assert.equal(status, 403);
  assert.equal(body.code, 'curator_required');
});

test('POST /scripts/:id/retry?force=1: 403 for an anonymous portal caller', async () => {
  const { status, body } = await request('POST', '/scripts/s1/retry?force=1', {
    headers: auth(portalToken),
  });
  assert.equal(status, 403);
  assert.equal(body.code, 'curator_required');
});

test('POST /scripts/:id/retry?force=1: staff/admin passes the curator gate', async () => {
  const { status } = await request('POST', '/scripts/s1/retry?force=1', {
    headers: { ...auth(portalToken), 'X-Reader-Session': readerSession('r-staff', 'staff-admin') },
  });
  // Past auth + curator gate the handler hits the unreachable DB — any 5xx
  // proves the request was allowed through; 401/403/429 would mean gated.
  assert.ok(![401, 403, 429].includes(status), `expected gate pass, got ${status}`);
});

test('POST /scripts/:id/surface: 403 curator_required for a non-curator reader', async () => {
  const { status, body } = await request('POST', '/scripts/s1/surface', {
    headers: { ...auth(portalToken), 'X-Reader-Session': readerSession('r-plain', 'plain-reader') },
    json: { surfaced: true },
  });
  assert.equal(status, 403);
  assert.equal(body.code, 'curator_required');
});

// ── Feedback submit ────────────────────────────────────────────────────────

const SCRIPT_UUID = '123e4567-e89b-12d3-a456-426614174000';

test('POST /feedback/:scriptId: 401 without an action token', async () => {
  const { status, body } = await request('POST', `/feedback/${SCRIPT_UUID}`, {
    json: { text: 'great read' },
  });
  assert.equal(status, 401);
  assert.equal(body.code, 'action_token_missing');
});

test('POST /feedback/:scriptId: 401 for a wrong-purpose (portal) token', async () => {
  const { status, body } = await request('POST', `/feedback/${SCRIPT_UUID}`, {
    headers: auth(portalToken),
    json: { text: 'great read' },
  });
  assert.equal(status, 401);
  assert.equal(body.code, 'action_token_invalid');
});

test('POST /feedback/:scriptId: 400 for a non-UUID script id', async () => {
  const { status, body } = await request('POST', '/feedback/not-a-uuid', {
    headers: auth(actionToken('r1', 'some-reader')),
    json: { text: 'great read' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /Invalid script id/);
});

test('POST /feedback/:scriptId: 400 for empty feedback', async () => {
  const { status, body } = await request('POST', `/feedback/${SCRIPT_UUID}`, {
    headers: auth(actionToken('r1', 'some-reader')),
    json: {},
  });
  assert.equal(status, 400);
  assert.match(body.error, /Feedback is empty/);
});

test('POST /feedback/:scriptId: 404 when the script cannot be found', async () => {
  // getScriptById's failure (stubbed DB) resolves to null → "not found", so a
  // DB outage cannot 500 a reader's submit with a misleading server error.
  const { status, body } = await request('POST', `/feedback/${SCRIPT_UUID}`, {
    headers: auth(actionToken('r1', 'some-reader')),
    json: { text: 'great read' },
  });
  assert.equal(status, 404);
  assert.match(body.error, /Script not found/);
});
