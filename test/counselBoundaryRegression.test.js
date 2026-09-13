import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pino from 'pino';
import Anthropic from '@anthropic-ai/sdk';

process.env.ANTHROPIC_API_KEY = 'sk-ant-dummy';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = '4242';
process.env.JWT_SECRET = 'dummy-jwt-secret-0123456789abcdef';
process.env.RESEND_API_KEY = 're_dummy';
process.env.EMAIL_FROM = 'noreply@interdependent.studio';
const app = (await import('../src/app.js')).default;
const { logger } = await import('../src/lib/logger.js');
const { anthropic } = await import('../src/services/anthropic/models.js');
const { COUNSEL_SOURCE_ID, COUNSEL_CORPUS_DIGEST, OA_COUNSEL_SOURCE } =
  await import('../src/lib/counselContract.js');
const { sectionFor } = await import('../src/lib/oaSections.js');
const jwt = (await import('jsonwebtoken')).default;
const token = jwt.sign({ authenticated: true }, process.env.JWT_SECRET);

async function harness(
  t,
  provider = async () => {
    throw new Error('Unexpected generation');
  },
) {
  const lines = [];
  const sink = pino({ base: undefined }, { write: (line) => lines.push(line) });
  const originalChild = logger.child;
  const originalCreate = anthropic.messages.create;
  logger.child = (bindings) => sink.child(bindings);
  let calls = 0;
  anthropic.messages.create = (...args) => {
    calls++;
    return provider(...args);
  };
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    logger.child = originalChild;
    anthropic.messages.create = originalCreate;
  });
  return {
    lines,
    get calls() {
      return calls;
    },
    async post(body, auth = token, path = '/counsel') {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
  };
}
const v2 = () => ({
  contractVersion: 'counsel.v2',
  target: {
    sourceId: COUNSEL_SOURCE_ID,
    digest: OA_COUNSEL_SOURCE.digest,
    packageDigest: COUNSEL_CORPUS_DIGEST,
    sectionId: 'oa-s0',
    clause: null,
  },
  question: 'Explain the supplied sections.',
});
const requests = {
  legacy: () => ({ sectionId: 'oa-s0', question: 'What does this say?' }),
  v1: () => ({
    contractVersion: 'counsel.v1',
    sectionId: 'oa-s0',
    question: 'What does this say?',
    source: OA_COUNSEL_SOURCE,
  }),
  v2,
};

test('actual app malformed JSON is private 400 before auth/model and never enters serialized request/error logs', async (t) => {
  const h = await harness(t);
  const marker = 'SYNTHETIC_PRIVATE_SOURCE_MARKER_3179';
  const malformed = `{"contractVersion":"counsel.v2","runtimePackages":[{"sections":[{"text":"${marker}"}]}],BROKEN`;
  for (const [auth, path] of [
    [null, '/counsel'],
    [token, '/counsel'],
    [token, '/COUNSEL/?fixture=1'],
  ]) {
    const result = await h.post(malformed, auth, path);
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, {
      error: 'Request body is not valid JSON',
      code: 'invalid_json',
    });
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  }
  const records = h.lines.map((line) => JSON.parse(line));
  assert.equal(records.length, 3);
  assert.ok(records.every((record) => record.msg === 'request' && record.status === 400));
  assert.ok(records.every((record) => !('err' in record) && !('body' in record)));
  assert.ok(!h.lines.join('').includes(marker));
  assert.ok(!h.lines.join('').includes('BROKEN'));
  assert.equal(h.calls, 0);
});

test('actual app preserves sanitized private 413 and valid unauthenticated refusal', async (t) => {
  const h = await harness(t);
  const result = await h.post({ text: 'SYNTHETIC_ONLY_'.repeat(9000) });
  assert.equal(result.status, 413);
  assert.equal(result.body.code, 'request_too_large');
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.ok(!h.lines.join('').includes('SYNTHETIC_ONLY_'));
  assert.equal((await h.post(v2(), null)).status, 401);
  assert.equal(h.calls, 0);
});

test('actual V2 route passes related OA to the provider and checks its citation and complete replay scope', async (t) => {
  const citation = {
    sourceId: COUNSEL_SOURCE_ID,
    sectionId: 'oa-s1',
    clause: null,
    quote: sectionFor('oa-s1').text.slice(0, 80),
  };
  const h = await harness(t, async (payload) => {
    const input = JSON.parse(payload.messages[0].content);
    assert.deepEqual(
      input.sources.map((source) => source.sectionId),
      ['oa-s0', 'oa-s1'],
    );
    assert.equal(input.sources[1].text, sectionFor('oa-s1').text);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            answer: 'The supplied related section is cited.',
            support: 'cited',
            citations: [citation],
          }),
        },
      ],
    };
  });
  const request = { ...v2(), relatedOASections: ['oa-s1'] };
  const first = await h.post(request);
  assert.equal(first.status, 200);
  assert.deepEqual(
    first.body.receipt.sources.map((source) => source.sectionId),
    ['oa-s0', 'oa-s1'],
  );
  assert.deepEqual(first.body.receipt.citations, [citation]);
  assert.ok(first.body.receipt.sources.every((source) => !('text' in source)));
  const next = {
    ...request,
    context: [
      { question: request.question, answer: first.body.answer, receipt: first.body.receipt },
    ],
  };
  assert.equal((await h.post(next)).status, 200);
  assert.equal(
    (await h.post({ ...next, relatedOASections: [] })).body.code,
    'history_source_mismatch',
  );
  assert.equal((await h.post({ ...request, relatedOASections: ['1'] })).status, 400);
  assert.equal((await h.post({ ...request, relatedOASections: ['oa-s1', 'oa-s1'] })).status, 400);
  assert.equal(h.calls, 2);
});

for (const [kind, ErrorType, providerStatus, detail, status, code] of [
  [
    'auth',
    Anthropic.AuthenticationError,
    401,
    'SYNTHETIC_PRIVATE_AUTH',
    502,
    'counsel_provider_auth_failed',
  ],
  [
    'rate',
    Anthropic.RateLimitError,
    429,
    'SYNTHETIC_PRIVATE_RATE',
    503,
    'counsel_provider_rate_limited',
  ],
  [
    'credit',
    Anthropic.BadRequestError,
    400,
    'credit balance SYNTHETIC_PRIVATE_CREDIT',
    503,
    'counsel_provider_credits_exhausted',
  ],
]) {
  for (const [version, request] of Object.entries(requests)) {
    test(`${version} ${kind} failure is truthful, sanitized and fatal after one provider attempt`, async (t) => {
      const h = await harness(t, async () => {
        throw new ErrorType(providerStatus, { error: { message: detail } }, detail, new Headers());
      });
      const result = await h.post(request());
      assert.equal(result.status, status);
      assert.equal(result.body.code, code);
      assert.equal(result.body.receipt, undefined);
      assert.equal(h.calls, 1);
      const serialized = JSON.stringify(result.body) + h.lines.join('');
      assert.ok(!/SYNTHETIC_PRIVATE|submission|saved|alerted|evaluation/i.test(serialized));
      assert.match(result.body.error, /counsel desk/);
    });
  }
}
