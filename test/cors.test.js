// Locks the CORS origin policy: canonical domains + the named pages.dev
// fallback only — no wildcard subdomains. Run: `npm test`.
import test from 'node:test';
import assert from 'node:assert';

// Satisfy src/config/env.js (validates process.env and exits on failure).
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = process.env.SUBMISSION_PASSCODE || '0000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy-jwt-secret-sixteen-plus';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@interdependent.studio';

const { isAllowedOrigin } = await import('../src/middleware/cors.js');

test('canonical site origins are allowed', () => {
  assert.ok(isAllowedOrigin('https://www.interdependent.studio'));
  assert.ok(isAllowedOrigin('https://interdependent.studio'));
});

test('the named pages.dev fallback origin is allowed', () => {
  assert.ok(isAllowedOrigin('https://interdependent-studio.pages.dev'));
});

test('arbitrary pages.dev subdomains are rejected (wildcard is gone)', () => {
  assert.ok(!isAllowedOrigin('https://evil.interdependent-studio.pages.dev'));
  assert.ok(!isAllowedOrigin('https://abc123.interdependent-studio.pages.dev'));
});

test('unrelated origins are rejected', () => {
  assert.ok(!isAllowedOrigin('https://example.com'));
  assert.ok(!isAllowedOrigin('https://interdependent-studio.pages.dev.evil.com'));
});
