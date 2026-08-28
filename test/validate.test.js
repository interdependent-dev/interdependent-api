// Shared Zod validation middleware (src/middleware/validate.js) — coercion,
// defaults, bounds, and the 400 envelope — plus the real route schemas over
// HTTP: invalid numerics/UUIDs must 400 through the AppError shape before any
// handler (or Supabase query) runs. Hermetic: dummy env, no network — the HTTP
// tests only exercise requests the validator rejects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validateQuery, validateBody } from '../src/middleware/validate.js';
import { AppError } from '../src/middleware/errorHandler.js';

// Satisfy src/config/env.js (validates process.env) for the app import below.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = process.env.SUBMISSION_PASSCODE || '0000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy-jwt-secret-sixteen-plus';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@interdependent.studio';

// ── middleware unit tests ────────────────────────────────────────────────────

const boundedSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

function run(mw, req) {
  let err;
  let called = false;
  mw(req, {}, (e) => {
    called = true;
    err = e;
  });
  assert.ok(called, 'next() was called');
  return err;
}

test('query strings are coerced to bounded numbers', () => {
  const req = { query: { limit: '25', offset: '10' } };
  const err = run(validateQuery(boundedSchema), req);
  assert.equal(err, undefined);
  assert.deepEqual(req.query, { limit: 25, offset: 10 });
});

test('missing params get schema defaults (defaults live in schemas, not handlers)', () => {
  const req = { query: {} };
  run(validateQuery(boundedSchema), req);
  assert.deepEqual(req.query, { limit: 50, offset: 0 });
});

test('out-of-bounds numerics → 400 AppError naming the param', () => {
  for (const query of [{ limit: '-5' }, { limit: '0' }, { limit: '101' }, { offset: '-1' }]) {
    const err = run(validateQuery(boundedSchema), { query });
    assert.ok(err instanceof AppError, 'AppError raised');
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'invalid_query');
    const param = Object.keys(query)[0];
    assert.match(err.message, new RegExp(`^Invalid query parameters: ${param}:`));
  }
});

test('NaN garbage never passes as a number', () => {
  for (const bad of ['abc', '12abc', '']) {
    const err = run(validateQuery(boundedSchema), { query: { limit: bad } });
    assert.ok(err instanceof AppError && err.statusCode === 400, `'${bad}' rejected`);
  }
});

test('non-integers are rejected, unknown keys are stripped', () => {
  const err = run(validateQuery(boundedSchema), { query: { limit: '2.5' } });
  assert.equal(err?.statusCode, 400);

  const req = { query: { limit: '10', rogue: 'x' } };
  run(validateQuery(boundedSchema), req);
  assert.deepEqual(req.query, { limit: 10, offset: 0 }, 'rogue key stripped');
});

test('validateBody parses/defaults the body and 400s with invalid_body', () => {
  const schema = z.object({ surfaced: z.boolean().default(true) });

  const req = { body: {} };
  assert.equal(run(validateBody(schema), req), undefined);
  assert.deepEqual(req.body, { surfaced: true });

  const missing = {}; // no body parsed at all (e.g. no content-type)
  assert.equal(run(validateBody(schema), missing), undefined);
  assert.deepEqual(missing.body, { surfaced: true });

  const err = run(validateBody(schema), { body: { surfaced: 'false' } });
  assert.equal(err?.statusCode, 400);
  assert.equal(err?.code, 'invalid_body');
  assert.match(err.message, /^Invalid request body: surfaced:/);
});

// ── the real routes over HTTP: invalid input is a 400 envelope, never a 500 ──

const { default: jwt } = await import('jsonwebtoken');
const { default: app } = await import('../src/app.js');

const portalToken = jwt.sign({ authenticated: true }, process.env.JWT_SECRET);

async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await fn((path) =>
      fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${portalToken}` },
      }),
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('GET /scripts and /analytics/summary reject bad numerics with a clear 400', async () => {
  await withServer(async (get) => {
    for (const path of [
      '/scripts?limit=-5',
      '/scripts?limit=abc',
      '/scripts?offset=-1',
      '/analytics/summary?days=99999',
      '/analytics/summary?days=0',
      '/analytics/summary?days=NaN',
    ]) {
      const res = await get(path);
      assert.equal(res.status, 400, `${path} → 400`);
      const body = await res.json();
      assert.equal(body.code, 'invalid_query', `${path} carries the code`);
      assert.match(body.error, /^Invalid query parameters: /, `${path} names the problem`);
    }
  });
});

test('GET /reads/status requires two UUIDs — malformed ids are a 400, not a silent miss', async () => {
  await withServer(async (get) => {
    for (const path of ['/reads/status', '/reads/status?script=not-a-uuid&reader=also-not']) {
      const res = await get(path);
      assert.equal(res.status, 400, `${path} → 400`);
      assert.equal((await res.json()).code, 'invalid_query');
    }
  });
});

// Wiring: the validator actually sits in front of each migrated handler (same
// stack-inspection style as event-ingest.test.js).
test('validate middleware is mounted on the migrated routes', async () => {
  const checks = [
    ['../src/routes/scripts.js', '/', 'get'],
    ['../src/routes/scripts.js', '/:id/surface', 'post'],
    ['../src/routes/analytics.js', '/summary', 'get'],
    ['../src/routes/reads.js', '/status', 'get'],
  ];
  for (const [mod, path, method] of checks) {
    const router = (await import(mod)).default;
    const layer = router.stack.find(
      (l) => l.route && l.route.path === path && l.route.methods[method],
    );
    assert.ok(layer, `${mod} ${method.toUpperCase()} ${path} is mounted`);
    const names = layer.route.stack.map((s) => s.name);
    assert.ok(
      names.includes('validate'),
      `${path} has validate attached (saw: ${names.join(', ')})`,
    );
  }
});
