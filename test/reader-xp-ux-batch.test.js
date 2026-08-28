// Wiring + unit tests for the Reader-XP UX batch (additive backend changes):
//   1. GET /xp/config now carries `featuredScriptId` (xpService.getFeaturedScriptId).
//   2. GET /readers/email — read the signed-in reader's saved recovery email.
//   3. roleRegistry — the OA §16.3 role roster + roleName() the XP service uses.
// Loads modules with dummy env (no network) and asserts exports + mounted routes.
import test from 'node:test';
import assert from 'node:assert/strict';

// Satisfy src/config/env.js (validates process.env and exits on failure).
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = process.env.SUBMISSION_PASSCODE || '0000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy-jwt-secret-至少十六-chars';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@interdependent.studio';

// ── roleRegistry (pure) ───────────────────────────────────────────────────────

test('roleRegistry: ROLES is the §16.3 roster and roleName resolves display names', async () => {
  const { ROLES, roleName } = await import('../src/lib/roleRegistry.js');

  // The full seeded roster.
  assert.equal(Object.keys(ROLES).length, 23);

  // Today's reader role still resolves to 'Reader' (what shapeReader now uses).
  assert.equal(roleName('reader'), 'Reader');
  assert.equal(ROLES.reader.oa, '16.3.1-7');
  assert.equal(ROLES.reader.family, 'production');

  // A few representative display names + multi-word slugs.
  assert.equal(roleName('producer'), 'Producer');
  assert.equal(roleName('executive-producer'), 'Executive Producer');
  assert.equal(roleName('production-assistant'), 'Production Assistant');
  assert.equal(roleName('associate-producer'), 'Associate Producer');

  // Unknown / missing slugs default to 'Reader'.
  assert.equal(roleName('does-not-exist'), 'Reader');
  assert.equal(roleName(undefined), 'Reader');

  // Product-internal pseudo-roles carry no OA citation.
  assert.equal(ROLES.scout.oa, null);
  assert.equal(ROLES.undecided.oa, null);

  // Every family is one of the allowed values.
  const families = new Set(['production', 'studio', 'modifier', 'partner', 'product']);
  for (const [slug, meta] of Object.entries(ROLES)) {
    assert.ok(meta.name && typeof meta.name === 'string', `${slug} has a name`);
    assert.ok(families.has(meta.family), `${slug} family '${meta.family}' is valid`);
    assert.ok(meta.oa === null || typeof meta.oa === 'string', `${slug} oa is string|null`);
  }
});

// ── xpService.getFeaturedScriptId (export) ────────────────────────────────────

test('xpService exports getFeaturedScriptId alongside the existing API', async () => {
  const svc = await import('../src/services/xpService.js');
  for (const fn of [
    'getReaderXp',
    'getAllReaderXp',
    'filmCreditContenders',
    'getFeaturedScriptId',
  ]) {
    assert.equal(typeof svc[fn], 'function', `xpService.${fn} should be a function`);
  }
});

// ── readerController.getRecoveryEmail (export) ────────────────────────────────

test('readerController exports getRecoveryEmail (the new read handler)', async () => {
  const c = await import('../src/controllers/readerController.js');
  assert.equal(typeof c.getRecoveryEmail, 'function');
});

// ── mounted routes ────────────────────────────────────────────────────────────

function mountedPaths(router) {
  return router.stack
    .filter((l) => l.route)
    .map((l) => Object.keys(l.route.methods)[0].toUpperCase() + ' ' + l.route.path);
}

test('xp route module mounts GET /config (+ existing gated routes)', async () => {
  const mod = await import('../src/routes/xp.js');
  const paths = mountedPaths(mod.default);
  for (const expected of ['GET /config', 'GET /leaderboard', 'GET /credits/:scriptId']) {
    assert.ok(
      paths.includes(expected),
      `route ${expected} should be mounted (saw: ${paths.join(', ')})`,
    );
  }
});

test('readers route module mounts GET /email next to POST /email', async () => {
  const mod = await import('../src/routes/readers.js');
  const paths = mountedPaths(mod.default);
  for (const expected of ['GET /email', 'POST /email']) {
    assert.ok(
      paths.includes(expected),
      `route ${expected} should be mounted (saw: ${paths.join(', ')})`,
    );
  }
  // GET /email must be declared BEFORE the catch-all GET /:handle so 'email'
  // isn't swallowed as a reader handle.
  const idxEmail = paths.indexOf('GET /email');
  const idxHandle = paths.indexOf('GET /:handle');
  assert.ok(idxEmail !== -1 && idxHandle !== -1, 'both routes present');
  assert.ok(idxEmail < idxHandle, 'GET /email must precede GET /:handle');
});
