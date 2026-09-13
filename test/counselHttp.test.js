import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

// Explicit dummy values before source imports. No provider request in this file.
process.env.ANTHROPIC_API_KEY = 'sk-ant-dummy';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
process.env.SUBMISSION_PASSCODE = '4242';
process.env.JWT_SECRET = 'dummy-jwt-secret-0123456789abcdef';
process.env.RESEND_API_KEY = 're_dummy';
process.env.EMAIL_FROM = 'noreply@interdependent.studio';

const jwt = (await import('jsonwebtoken')).default;
const { createCounselRouter } = await import('../src/routes/counsel.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { OA_COUNSEL_SOURCE, COUNSEL_SOURCE_ID, makeCounselReceipt } =
  await import('../src/lib/counselContract.js');
const { sectionFor } = await import('../src/lib/oaSections.js');
const token = jwt.sign({ authenticated: true }, process.env.JWT_SECRET);
const quote =
  'Each Member acknowledges having reviewed the Certificate of Formation and approves and accepts it.';
const citation = { sourceId: COUNSEL_SOURCE_ID, sectionId: 'oa-s0', clause: '0.3', quote };
const answer = {
  answer: 'Section 0.3 records that acknowledgement.',
  support: 'cited',
  citations: [citation],
  model: 'mock-model',
};
const body = {
  contractVersion: 'counsel.v1',
  sectionId: 'oa-s0',
  subsection: '0.3',
  question: 'What does this say?',
  source: OA_COUNSEL_SOURCE,
};

async function harness(t, implementation = async () => answer) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use(
    '/counsel',
    createCounselRouter({
      answerQuestion: async (request) => {
        calls.push(request);
        return implementation(request);
      },
    }),
  );
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    calls,
    async post(json = body, auth = token) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/counsel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: JSON.stringify(json),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test('existing portal JWT remains required; reader/action tokens do not broaden access', async (t) => {
  const h = await harness(t);
  for (const auth of [
    null,
    'bad',
    jwt.sign({ purpose: 'reader_session', readerId: 'reader' }, process.env.JWT_SECRET),
    jwt.sign({ purpose: 'leaderboard_action', readerId: 'reader' }, process.env.JWT_SECRET),
  ]) {
    assert.equal((await h.post(body, auth)).status, 401);
  }
  assert.equal(h.calls.length, 0);
});

test('V1 response has full server receipt and explicit unavailable sources; same-source follow-up reaches service', async (t) => {
  const h = await harness(t);
  const first = await h.post();
  assert.equal(first.status, 200);
  assert.equal(first.body.receipt.sources[0].digest, OA_COUNSEL_SOURCE.digest);
  assert.equal(first.body.receipt.verification, 'source-and-quote-only');
  assert.equal(first.body.receipt.sources[0].status, 'review-candidate');
  assert.deepEqual(first.body.availability, { EAP: 'unavailable', founderIntent: 'unavailable' });
  const context = [
    { question: body.question, answer: first.body.answer, receipt: first.body.receipt },
  ];
  assert.equal(
    (await h.post({ ...body, context, question: 'Can you explain that again?' })).status,
    200,
  );
  assert.deepEqual(h.calls[1].context, context);
  assert.equal(h.calls[0].source.sectionId, 'oa-s0');
});

test('invalid source, clause, selection and history fail before the model', async (t) => {
  const h = await harness(t);
  const variants = [
    [{ ...body, contractVersion: 'counsel.v2' }, 400],
    [{ ...body, source: { ...body.source, digest: body.source.digest.slice(0, 16) } }, 400],
    [{ ...body, source: { ...body.source, document: 'EAP' } }, 409],
    [{ ...body, subsection: '0.3.999' }, 400],
    [{ ...body, selection: 'This is not the agreement text.' }, 409],
    [
      {
        ...body,
        context: [
          {
            question: 'What else?',
            answer: 'Other section.',
            receipt: makeCounselReceipt(sectionFor('oa-s1'), []),
          },
        ],
      },
      409,
    ],
  ];
  for (const [request, status] of variants) assert.equal((await h.post(request)).status, status);
  assert.equal(h.calls.length, 0);
});

test('legacy caller keeps original fields but cannot receive a verified receipt', async (t) => {
  const h = await harness(t, async () => ({ answer: 'Legacy prose.', model: 'mock-model' }));
  const result = await h.post({
    sectionId: '0',
    question: 'What does this say?',
    source: { document: 'EAP' },
    context: [{ answer: 'ignored legacy context' }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.answer, 'Legacy prose.');
  assert.equal(result.body.section.id, 'oa-s0');
  assert.equal(result.body.support, 'legacy-unverified');
  assert.equal(result.body.contractVersion, 'legacy');
  assert.equal(result.body.receipt, null);
  assert.equal(result.body.provenance.sha256, OA_COUNSEL_SOURCE.digest);
  assert.equal(h.calls[0].context, undefined);
  assert.equal(h.calls[0].source, undefined);
});

test('route independently refuses an invalid model citation instead of stamping a receipt', async (t) => {
  const h = await harness(t, async () => ({
    ...answer,
    citations: [{ ...citation, clause: '0.2' }],
  }));
  const result = await h.post();
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'invalid_counsel_citations');
  assert.equal(result.body.receipt, undefined);
});

test('existing twenty-ask IP limit remains effective with V1 and legacy calls', async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 20; i++) {
    assert.equal(
      (await h.post(i % 2 ? { sectionId: '0', question: body.question } : body)).status,
      200,
    );
  }
  assert.equal((await h.post()).status, 429);
  assert.equal(h.calls.length, 20);
});
