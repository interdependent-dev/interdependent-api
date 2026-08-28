// Drift check: .env.example must document every variable the env schema knows,
// and the JWT_SECRET placeholder guard must fire. Run: `npm test`.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Satisfy src/config/env.js (validates process.env and exits on failure).
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = process.env.SUBMISSION_PASSCODE || '0000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy-jwt-secret-sixteen-plus';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@interdependent.studio';

const { envSchema } = await import('../src/config/env.js');

const exampleUrl = new URL('../.env.example', import.meta.url);
const envJsPath = fileURLToPath(new URL('../src/config/env.js', import.meta.url));

function exampleKeys() {
  return new Set(
    readFileSync(exampleUrl, 'utf8')
      .split('\n')
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter(Boolean),
  );
}

test('.env.example covers every env-schema key', () => {
  const documented = exampleKeys();
  const missing = Object.keys(envSchema.shape).filter((k) => !documented.has(k));
  assert.deepStrictEqual(missing, [], `add these to .env.example: ${missing.join(', ')}`);
});

test('.env.example has no keys the schema does not know', () => {
  const known = new Set(Object.keys(envSchema.shape));
  const stray = [...exampleKeys()].filter((k) => !known.has(k));
  assert.deepStrictEqual(stray, [], `not in src/config/env.js schema: ${stray.join(', ')}`);
});

// Boot env.js in a child process with a controlled environment and report how it exits.
function bootEnvJs(overrides) {
  return spawnSync(process.execPath, ['-e', 'import(process.env.ENV_JS_PATH)'], {
    encoding: 'utf8',
    env: {
      ANTHROPIC_API_KEY: 'sk-ant-dummy',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role',
      SUBMISSION_PASSCODE: '0000',
      JWT_SECRET: 'dummy-jwt-secret-sixteen-plus',
      RESEND_API_KEY: 're_dummy',
      EMAIL_FROM: 'noreply@interdependent.studio',
      ENV_JS_PATH: envJsPath,
      ...overrides,
    },
  });
}

// The guard logs through pino, which writes JSON to STDOUT (Render captures
// stdout) — check both streams so the assertion is about the message, not the fd.
test('placeholder JWT_SECRET logs a loud warning outside production', () => {
  const res = bootEnvJs({ JWT_SECRET: 'change-me-generate-a-real-secret' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout + res.stderr, /JWT_SECRET looks like a placeholder/);
});

test('placeholder JWT_SECRET refuses to start when NODE_ENV=production', () => {
  const res = bootEnvJs({ JWT_SECRET: 'change-me-generate-a-real-secret', NODE_ENV: 'production' });
  assert.strictEqual(res.status, 1);
  assert.match(res.stdout + res.stderr, /Refusing to start in production/);
});

test('a real JWT_SECRET boots without the placeholder warning', () => {
  const res = bootEnvJs({ JWT_SECRET: 'a-genuinely-random-looking-secret-0f3b' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.doesNotMatch(res.stdout + res.stderr, /JWT_SECRET/);
});
