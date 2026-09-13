import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RuntimeCounselRequestSchema,
  resolveRuntimeCounselRequest,
  validateRuntimeCounselAnswer,
  makeRuntimeCounselReceipt,
  MAX_RESOLVED_SOURCE_BYTES,
} from '../src/lib/counselRuntimeContract.js';
import {
  COUNSEL_CORPUS_DIGEST,
  COUNSEL_SOURCE_ID,
  OA_COUNSEL_SOURCE,
  makeCounselReceipt,
} from '../src/lib/counselContract.js';
import { sectionFor } from '../src/lib/oaSections.js';
import { RUNTIME_SOURCE_MANIFESTS } from '../src/lib/counselRuntimeSources.js';
import { fixture, clone } from './helpers/counselRuntimeFixture.js';
const resolve = (request, manifest) =>
  resolveRuntimeCounselRequest(RuntimeCounselRequestSchema.parse(request), [manifest]);
const oaTarget = (sectionId = 'oa-s0') => ({
  sourceId: COUNSEL_SOURCE_ID,
  digest: OA_COUNSEL_SOURCE.digest,
  packageDigest: COUNSEL_CORPUS_DIGEST,
  sectionId,
  clause: null,
});

test('runtime source identity and exact section bytes resolve; metadata contains no private text', () => {
  const f = fixture();
  const result = resolve(f.request, f.manifest);
  assert.equal(result.records[0].text, f.request.runtimePackages[0].sections[0].text);
  assert.equal(result.sources[0].sectionDigest, f.manifest.sections[0].digest);
  assert.deepEqual(result.availability, { EAP: 'supplied-sections', founderIntent: 'unavailable' });
  for (const manifest of RUNTIME_SOURCE_MANIFESTS) {
    assert.equal(manifest.source.status, 'review-candidate');
    for (const section of manifest.sections)
      assert.deepEqual(Object.keys(section).sort(), ['clauses', 'digest', 'sectionId']);
    assert.equal('text' in manifest, false);
  }
});

test('every registered identity coordinate is exact, including full raw and package hashes', () => {
  const f = fixture();
  for (const field of Object.keys(f.manifest.source)) {
    const request = clone(f.request);
    request.runtimePackages[0].source[field] =
      field.endsWith('Digest') || field === 'digest' ? '0'.repeat(64) : 'changed';
    assert.throws(() => resolve(request, f.manifest), { code: 'runtime_source_mismatch' });
  }
  const truncated = clone(f.request);
  truncated.runtimePackages[0].source.digest = f.manifest.source.digest.slice(0, 16);
  assert.equal(RuntimeCounselRequestSchema.safeParse(truncated).success, false);
});

test('matching document/package identity cannot authorize substituted, normalized or partial section text', () => {
  const f = fixture();
  for (const text of [
    'A. Replaced fixture.',
    f.request.runtimePackages[0].sections[0].text + '\n',
    f.request.runtimePackages[0].sections[0].text.slice(0, 12),
  ]) {
    const request = clone(f.request);
    request.runtimePackages[0].sections[0].text = text;
    assert.throws(() => resolve(request, f.manifest), { code: 'runtime_section_mismatch' });
  }
  const unicode = fixture(['A. Café synthetic fixture.']);
  unicode.request.runtimePackages[0].sections[0].text =
    unicode.request.runtimePackages[0].sections[0].text.normalize('NFD');
  assert.throws(() => resolve(unicode.request, unicode.manifest), {
    code: 'runtime_section_mismatch',
  });
});

test('unknown sections, duplicate packages and duplicate sections are refused', () => {
  const f = fixture();
  const unknown = clone(f.request);
  unknown.runtimePackages[0].sections[0].sectionId = 'not-registered';
  assert.throws(() => resolve(unknown, f.manifest), { code: 'unknown_runtime_section' });
  const dupPackage = clone(f.request);
  dupPackage.runtimePackages.push(clone(dupPackage.runtimePackages[0]));
  assert.throws(() => resolve(dupPackage, f.manifest), { code: 'duplicate_source_package' });
  const dupSection = clone(f.request);
  dupSection.runtimePackages[0].sections.push(clone(dupSection.runtimePackages[0].sections[0]));
  assert.throws(() => resolve(dupSection, f.manifest), { code: 'duplicate_source_section' });
});

test('target identity, exact clause and selected scope must match', () => {
  const f = fixture();
  for (const field of ['digest', 'packageDigest']) {
    const request = clone(f.request);
    request.target[field] = '0'.repeat(64);
    assert.throws(() => resolve(request, f.manifest), { code: 'target_source_mismatch' });
  }
  const unknown = clone(f.request);
  unknown.target.clause = 'A.999';
  assert.throws(() => resolve(unknown, f.manifest), { code: 'unknown_clause' });
  const prototype = clone(f.request);
  prototype.target.clause = '__proto__';
  assert.throws(() => resolve(prototype, f.manifest), { code: 'unknown_clause' });
  const selected = clone(f.request);
  selected.selection = 'Fixture beta berries.';
  assert.throws(() => resolve(selected, f.manifest), { code: 'selection_mismatch' });
});

test('cited quotes remain bound to the named source, section and clause', () => {
  const f = fixture();
  const resolved = resolve(f.request, f.manifest);
  assert.deepEqual(validateRuntimeCounselAnswer(f.answer, resolved), f.answer);
  for (const delta of [
    { sourceId: 'other' },
    { sectionId: 'other' },
    { clause: 'B' },
    { quote: 'Fabricated fixture quote.' },
  ]) {
    const answer = clone(f.answer);
    Object.assign(answer.citations[0], delta);
    assert.throws(() => validateRuntimeCounselAnswer(answer, resolved), {
      code: 'invalid_counsel_citations',
    });
  }
  assert.throws(() => validateRuntimeCounselAnswer({ ...f.answer, citations: [] }, resolved), {
    code: 'invalid_counsel_citations',
  });
  assert.throws(
    () => validateRuntimeCounselAnswer({ ...f.answer, support: 'insufficient-source' }, resolved),
    { code: 'invalid_counsel_citations' },
  );
  assert.equal(
    validateRuntimeCounselAnswer(
      {
        answer: 'The supplied sources do not answer that.',
        support: 'insufficient-source',
        citations: [],
      },
      resolved,
    ).support,
    'insufficient-source',
  );
});

test('only supplied sections may be cited, even when the registry knows another section', () => {
  const f = fixture(['A. Fixture alpha apples.', 'A. Other fixture text.']);
  f.request.runtimePackages[0].sections.pop();
  const resolved = resolve(f.request, f.manifest);
  const answer = clone(f.answer);
  Object.assign(answer.citations[0], { sectionId: 'fixture-2', quote: 'Other fixture text.' });
  assert.throws(() => validateRuntimeCounselAnswer(answer, resolved), {
    code: 'invalid_counsel_citations',
  });
});

test('OA targets use the existing server corpus and can include a bounded verified policy section', () => {
  const f = fixture();
  f.request.target = oaTarget();
  const result = resolve(f.request, f.manifest);
  assert.equal(result.records.length, 2);
  assert.equal(
    result.records.find((r) => r.source.sourceId === COUNSEL_SOURCE_ID).text,
    sectionFor('oa-s0').text,
  );
  f.request.runtimePackages = [];
  assert.deepEqual(resolve(f.request, f.manifest).availability, {
    EAP: 'not-supplied',
    founderIntent: 'unavailable',
  });
  f.request.target = oaTarget('oa-s2');
  f.request.target.clause = '2.5.3.1';
  assert.throws(() => resolve(f.request, f.manifest), { code: 'unknown_clause' });
});

test('OA and runtime targets can include exact API-owned related OA sections without supplied OA text', () => {
  const f = fixture();
  f.request.relatedOASections = ['oa-s1', 'oa-s0'];
  const eap = resolve(f.request, f.manifest);
  assert.equal(eap.records.length, 3);
  for (const sectionId of f.request.relatedOASections) {
    const record = eap.records.find((r) => r.sectionId === sectionId);
    assert.equal(record.text, sectionFor(sectionId).text);
    assert.equal(record.source.sourceId, COUNSEL_SOURCE_ID);
  }
  f.request.target = oaTarget('oa-s2');
  f.request.runtimePackages = [];
  const oa = resolve(f.request, f.manifest);
  assert.deepEqual(
    oa.sources.map((r) => r.sectionId),
    ['oa-s0', 'oa-s1', 'oa-s2'],
  );
  assert.equal(oa.records.find((r) => r.sectionId === 'oa-s2').scope('2.5.3.1'), null);
  assert.deepEqual(
    RuntimeCounselRequestSchema.parse({ ...f.request, relatedOASections: undefined })
      .relatedOASections,
    [],
  );
});

test('related OA IDs reject aliases, whitespace, unknowns, duplicates and attempted text authority', () => {
  const f = fixture();
  for (const sectionId of ['0', ' oa-s0', 'OA-S0', 'oa-s999', '__proto__']) {
    assert.throws(() => resolve({ ...f.request, relatedOASections: [sectionId] }, f.manifest), {
      statusCode: 400,
      code: 'unknown_section',
    });
  }
  assert.throws(
    () => resolve({ ...f.request, relatedOASections: ['oa-s0', 'oa-s0'] }, f.manifest),
    {
      statusCode: 400,
      code: 'duplicate_source_section',
    },
  );
  assert.throws(
    () => resolve({ ...f.request, target: oaTarget(), relatedOASections: ['oa-s0'] }, f.manifest),
    {
      statusCode: 400,
      code: 'duplicate_source_section',
    },
  );
  assert.equal(
    RuntimeCounselRequestSchema.safeParse({
      ...f.request,
      relatedOASections: [{ sectionId: 'oa-s0', text: 'A. Caller supplied text.' }],
    }).success,
    false,
  );
});

test('the four-section limit includes related OA, an OA target and every runtime section', () => {
  const f = fixture(['A. First fixture.', 'A. Second fixture.']);
  f.request.relatedOASections = ['oa-s0', 'oa-s1'];
  assert.equal(resolve(f.request, f.manifest).records.length, 4);
  assert.throws(() => resolve({ ...f.request, target: oaTarget('oa-s2') }, f.manifest), {
    statusCode: 400,
    code: 'too_many_source_sections',
  });
  f.request.runtimePackages = [];
  f.request.target = oaTarget('oa-s0');
  f.request.relatedOASections = ['oa-s1', 'oa-s2', 'oa-s3'];
  assert.equal(resolve(f.request, f.manifest).records.length, 4);
  assert.throws(
    () =>
      resolve(
        { ...f.request, relatedOASections: [...f.request.relatedOASections, 'oa-s4'] },
        f.manifest,
      ),
    {
      statusCode: 400,
      code: 'too_many_source_sections',
    },
  );
});

test('related OA text shares the exact 128 KiB boundary with runtime text', () => {
  const relatedBytes = Buffer.byteLength(sectionFor('oa-s3').text, 'utf8');
  const runtimeBytes = MAX_RESOLVED_SOURCE_BYTES - relatedBytes;
  for (const extra of [0, 1]) {
    const f = fixture(['A. ' + 'x'.repeat(runtimeBytes - 3 + extra)]);
    f.request.relatedOASections = ['oa-s3'];
    if (extra)
      assert.throws(() => resolve(f.request, f.manifest), {
        statusCode: 413,
        code: 'resolved_sources_too_large',
      });
    else
      assert.equal(
        resolve(f.request, f.manifest).records.reduce(
          (total, record) => total + Buffer.byteLength(record.text, 'utf8'),
          0,
        ),
        MAX_RESOLVED_SOURCE_BYTES,
      );
  }
});

test('related OA order is canonical but adding, removing or changing a related source invalidates history', () => {
  const f = fixture();
  f.request.relatedOASections = ['oa-s1', 'oa-s0'];
  const first = resolve(f.request, f.manifest);
  const relatedCitation = {
    sourceId: COUNSEL_SOURCE_ID,
    sectionId: 'oa-s0',
    clause: null,
    quote: sectionFor('oa-s0').text.slice(0, 80),
  };
  const citations = [f.answer.citations[0], relatedCitation];
  validateRuntimeCounselAnswer({ ...f.answer, citations }, first);
  const receipt = makeRuntimeCounselReceipt(first, citations);
  f.request.context = [{ question: f.request.question, answer: f.answer.answer, receipt }];
  f.request.relatedOASections.reverse();
  assert.equal(resolve(f.request, f.manifest).scopeDigest, receipt.scopeDigest);
  for (const relatedOASections of [['oa-s0'], ['oa-s0', 'oa-s2'], ['oa-s0', 'oa-s1', 'oa-s2']]) {
    assert.throws(() => resolve({ ...f.request, relatedOASections }, f.manifest), {
      code: 'history_source_mismatch',
    });
  }
  const noRelated = resolve({ ...f.request, relatedOASections: [], context: [] }, f.manifest);
  assert.throws(() => validateRuntimeCounselAnswer({ ...f.answer, citations }, noRelated), {
    code: 'invalid_counsel_citations',
  });
});

test('section count, normalized request bytes and resolved model context are independently bounded', () => {
  const many = fixture(Array(4).fill('A. Synthetic section text.'));
  many.request.target = oaTarget();
  assert.throws(() => resolve(many.request, many.manifest), { code: 'too_many_source_sections' });
  const large = fixture(['A. ' + 'x'.repeat(98000)]);
  assert.throws(() => resolve(large.request, large.manifest), {
    code: 'runtime_request_too_large',
  });
  const utf8 = fixture(['A. ' + '😀'.repeat(25000)]);
  assert.throws(() => resolve(utf8.request, utf8.manifest), { code: 'runtime_request_too_large' });
  const total = fixture(['A. ' + 'x'.repeat(65000)]);
  total.request.target = oaTarget('oa-s3');
  assert.throws(() => resolve(total.request, total.manifest), {
    code: 'resolved_sources_too_large',
  });
});

test('receipt round trip is scope-exact and independent of package section order', () => {
  const f = fixture(['A. Fixture alpha apples.', 'A. Second synthetic section.']);
  const result = resolve(f.request, f.manifest);
  const receipt = makeRuntimeCounselReceipt(result, f.answer.citations);
  f.request.context = [{ question: f.request.question, answer: f.answer.answer, receipt }];
  f.request.runtimePackages[0].sections.reverse();
  assert.equal(resolve(f.request, f.manifest).scopeDigest, receipt.scopeDigest);
  const changed = clone(f.request);
  changed.target.clause = null;
  assert.throws(() => resolve(changed, f.manifest), { code: 'history_source_mismatch' });
  const stale = clone(f.request);
  stale.context[0].receipt.sources[0].sectionDigest = '0'.repeat(64);
  assert.throws(() => resolve(stale, f.manifest), { code: 'history_source_mismatch' });
  const badQuote = clone(f.request);
  badQuote.context[0].receipt.citations[0].quote = 'Not in any supplied section.';
  assert.throws(() => resolve(badQuote, f.manifest), { code: 'history_source_mismatch' });
});

test('V1/legacy history is not promoted to V2, and new client authority fields are rejected', () => {
  const f = fixture();
  const legacy = clone(f.request);
  legacy.context = [
    {
      question: 'An earlier question?',
      answer: 'An old answer.',
      receipt: makeCounselReceipt(sectionFor('oa-s0'), []),
    },
  ];
  assert.equal(RuntimeCounselRequestSchema.safeParse(legacy).success, false);
  assert.equal(
    RuntimeCounselRequestSchema.safeParse({ ...f.request, registry: [f.manifest] }).success,
    false,
  );
  const injected = clone(f.request);
  injected.runtimePackages[0].sections[0].clauses = { A: [0, 1] };
  assert.equal(RuntimeCounselRequestSchema.safeParse(injected).success, false);
  const four = clone(f.request);
  const receipt = makeRuntimeCounselReceipt(resolve(f.request, f.manifest), []);
  four.context = Array(4).fill({ question: 'Prior question?', answer: 'Prior answer.', receipt });
  assert.equal(RuntimeCounselRequestSchema.safeParse(four).success, false);
});

test('future intent requires pinned verified attribution; no production intent source is enabled', () => {
  const f = fixture();
  assert.equal(
    RUNTIME_SOURCE_MANIFESTS.some((m) => m.source.sourceKind === 'recorded-intent'),
    false,
  );
  f.manifest.source.sourceKind = 'recorded-intent';
  f.manifest.source.status = 'verified-historical';
  f.request.runtimePackages[0].source = clone(f.manifest.source);
  assert.throws(() => resolve(f.request, f.manifest), { code: 'unverified_intent_source' });
  f.manifest.attribution = {
    author: 'Synthetic Fixture Author',
    date: '2026-01-01',
    locator: 'fixture:record-1',
    verification: 'human-authored-source-verified',
    superseded: false,
  };
  const result = resolve(f.request, f.manifest);
  assert.equal(result.availability.founderIntent, 'supplied-excerpts');
  assert.deepEqual(result.sources[0].attribution, f.manifest.attribution);
  const browserAttribution = clone(f.request);
  browserAttribution.runtimePackages[0].attribution = { author: 'Someone else' };
  assert.equal(RuntimeCounselRequestSchema.safeParse(browserAttribution).success, false);
});
