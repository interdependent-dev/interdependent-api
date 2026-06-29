// Wiring test for the email + add-device + recovery feature. Loads the modules
// with dummy env (no network) and asserts the new exports exist and the route
// module mounts. Catches missing exports / typos / bad imports before deploy.
import test from 'node:test';
import assert from 'node:assert/strict';

// Satisfy src/config/env.js (which validates process.env and exits on failure).
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = process.env.SUBMISSION_PASSCODE || '0000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy-jwt-secret-至少十六-chars';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@interdependent.studio';

test('readerService exports email + recovery-token helpers', async () => {
  const svc = await import('../src/services/readerService.js');
  for (const fn of ['createReader', 'updateReaderEmail', 'createRecoveryToken',
    'getRecoveryTokenByHash', 'consumeRecoveryToken', 'purgeExpiredRecoveryTokens']) {
    assert.equal(typeof svc[fn], 'function', `readerService.${fn} should be a function`);
  }
});

test('emailService exports sendRecoveryEmail', async () => {
  const svc = await import('../src/services/emailService.js');
  assert.equal(typeof svc.sendRecoveryEmail, 'function');
});

test('readerController exports the new handlers', async () => {
  const c = await import('../src/controllers/readerController.js');
  for (const fn of ['registerBegin', 'registerComplete', 'setRecoveryEmail',
    'addDeviceBegin', 'addDeviceComplete', 'recoverRequest', 'recoverBegin', 'recoverComplete', 'uploadPhoto']) {
    assert.equal(typeof c[fn], 'function', `readerController.${fn} should be a function`);
  }
});

test('readers route module mounts without throwing', async () => {
  const mod = await import('../src/routes/readers.js');
  assert.ok(mod.default, 'readers router should have a default export');
  // express routers are functions with a .stack of layers
  assert.equal(typeof mod.default, 'function');
  const paths = mod.default.stack
    .filter((l) => l.route)
    .map((l) => Object.keys(l.route.methods)[0].toUpperCase() + ' ' + l.route.path);
  for (const expected of [
    'POST /email',
    'POST /credentials/add/begin',
    'POST /credentials/add/complete',
    'POST /recover/request',
    'POST /recover/begin',
    'POST /recover/complete',
    'POST /photo',
  ]) {
    assert.ok(paths.includes(expected), `route ${expected} should be mounted (saw: ${paths.join(', ')})`);
  }
});
