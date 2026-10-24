import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { fixture } from './helpers/counselRuntimeFixture.js';

process.env.ANTHROPIC_API_KEY = 'sk-ant-dummy';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = '4242';
process.env.JWT_SECRET = 'dummy-jwt-secret-0123456789abcdef';
process.env.RESEND_API_KEY = 're_dummy';
process.env.EMAIL_FROM = 'noreply@interdependent.studio';
const jwt = (await import('jsonwebtoken')).default;
const { createCounselRouter } = await import('../src/routes/counsel.js');
const { resolveRuntimeCounselRequest } = await import('../src/lib/counselRuntimeContract.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const realApp = (await import('../src/app.js')).default;
const token = jwt.sign({ authenticated: true }, process.env.JWT_SECRET);
async function serve(t, app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (body, auth = token) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/counsel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
}
async function harness(t, answerTransform = (answer) => answer) {
  const f = fixture();
  const calls = [];
  let resolutions = 0;
  const app = express();
  app.use(express.json());
  app.use(
    '/counsel',
    createCounselRouter({
      resolveRuntimeRequest: (request) => {
        resolutions++;
        return resolveRuntimeCounselRequest(request, [f.manifest]);
      },
      answerRuntimeQuestion: async (request) => {
        calls.push(request);
        return { ...answerTransform(f.answer), model: 'mock-runtime-model' };
      },
    }),
  );
  app.use(errorHandler);
  return {
    ...f,
    calls,
    get resolutions() {
      return resolutions;
    },
    post: await serve(t, app),
  };
}

test('V2 still requires the existing portal token before source resolution or generation', async (t) => {
  const h = await harness(t);
  for (const auth of [
    null,
    'invalid',
    jwt.sign({ purpose: 'reader_session' }, process.env.JWT_SECRET),
    jwt.sign({ purpose: 'leaderboard_action' }, process.env.JWT_SECRET),
  ])
    assert.equal((await h.post(h.request, auth)).status, 401);
  assert.equal(h.resolutions, 0);
  assert.equal(h.calls.length, 0);
});

test('V2 returns only answer/citation metadata, private cache headers and replayable scoped receipt', async (t) => {
  const h = await harness(t);
  const first = await h.post(h.request);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control'), /private, no-store/);
  assert.equal(first.body.receipt.verification, 'source-and-quote-only');
  assert.equal(first.body.receipt.sources[0].digest, h.manifest.source.digest);
  assert.equal('text' in first.body.receipt.sources[0], false);
  assert.equal('runtimePackages' in first.body, false);
  assert.equal('records' in first.body, false);
  const next = {
    ...h.request,
    context: [
      { question: h.request.question, answer: first.body.answer, receipt: first.body.receipt },
    ],
  };
  assert.equal((await h.post(next)).status, 200);
  assert.equal(h.calls[1].context.length, 1);
});

test('client-supplied registry/clauses, modified text and target mismatch never reach the model', async (t) => {
  const h = await harness(t);
  assert.equal((await h.post({ ...h.request, registry: [h.manifest] })).status, 400);
  const modified = structuredClone(h.request);
  modified.runtimePackages[0].sections[0].text += 'changed';
  assert.equal((await h.post(modified)).body.code, 'runtime_section_mismatch');
  const target = structuredClone(h.request);
  target.target.digest = '0'.repeat(64);
  assert.equal((await h.post(target)).body.code, 'target_source_mismatch');
  assert.equal(h.calls.length, 0);
});

test('route independently refuses an unrelated citation instead of issuing a runtime receipt', async (t) => {
  const h = await harness(t, (answer) => ({
    ...answer,
    citations: [{ ...answer.citations[0], clause: 'B' }],
  }));
  const result = await h.post(h.request);
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'invalid_counsel_citations');
  assert.equal(result.body.receipt, undefined);
});

test('V2 uses the same twenty-ask limit, including model successes', async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 20; i++) assert.equal((await h.post(h.request)).status, 200);
  assert.equal((await h.post(h.request)).status, 429);
  assert.equal(h.calls.length, 20);
});

test('actual app parser returns a sanitized 413 before an oversized body reaches any source/model path', async (t) => {
  const post = await serve(t, realApp);
  const response = await post({
    contractVersion: 'counsel.v2',
    text: 'synthetic-only-'.repeat(9000),
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.code, 'request_too_large');
  assert.ok(!JSON.stringify(response.body).includes('synthetic-only'));
});
