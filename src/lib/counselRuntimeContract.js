import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { sectionFor } from './oaSections.js';
import {
  COUNSEL_CORPUS_DIGEST,
  COUNSEL_SOURCE_ID,
  OA_COUNSEL_SOURCE,
  clauseText,
  sourceForSection,
} from './counselContract.js';
import { RUNTIME_SOURCE_MANIFESTS } from './counselRuntimeSources.js';

export const RUNTIME_CONTRACT = 'counsel.v2';
export const RUNTIME_PROMPT_VERSION = 'matlock-runtime-source.v2';
export const MAX_RUNTIME_REQUEST_BYTES = 96 * 1024;
export const MAX_RESOLVED_SOURCE_BYTES = 128 * 1024;
const MAX_SECTIONS = 4;
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Source = z
  .object({
    sourceId: z.string().min(1).max(64),
    document: z.string().min(1).max(32),
    version: z.string().min(1).max(32),
    sourceKind: z.string().min(1).max(32),
    status: z.string().min(1).max(32),
    digest: Digest,
    packageDigest: Digest,
  })
  .strict();
const Target = z
  .object({
    sourceId: z.string().min(1).max(64),
    digest: Digest,
    packageDigest: Digest,
    sectionId: z.string().min(1).max(96),
    clause: z.string().min(1).max(48).nullable(),
  })
  .strict();
const Citation = z
  .object({
    sourceId: z.string().min(1).max(64),
    sectionId: z.string().min(1).max(96),
    clause: z.string().min(1).max(48).nullable(),
    quote: z
      .string()
      .min(8)
      .max(1000)
      .refine((value) => value.trim().length >= 8),
  })
  .strict();
// No intent source is registered. This optional future seam requires an
// independently reviewed human-source attribution in the SERVER manifest.
const Attribution = z
  .object({
    author: z.string().min(1).max(160),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    locator: z.string().min(1).max(500),
    verification: z.literal('human-authored-source-verified'),
    superseded: z.boolean(),
  })
  .strict();
const ReceiptSource = Source.extend({
  sectionId: z.string().min(1).max(96),
  sectionDigest: Digest,
  attribution: Attribution.optional(),
}).strict();
const Receipt = z
  .object({
    contractVersion: z.literal(RUNTIME_CONTRACT),
    promptVersion: z.literal(RUNTIME_PROMPT_VERSION),
    verification: z.literal('source-and-quote-only'),
    scopeDigest: Digest,
    target: Target,
    sources: z.array(ReceiptSource).min(1).max(MAX_SECTIONS),
    citations: z.array(Citation).max(8),
  })
  .strict();
export const RuntimeCounselRequestSchema = z
  .object({
    contractVersion: z.literal(RUNTIME_CONTRACT),
    target: Target,
    question: z.string().trim().min(3).max(2000),
    selection: z.string().min(1).max(4000).nullable().optional(),
    // Exact API-owned IDs only; OA source text is never accepted from callers.
    relatedOASections: z.array(z.string().min(1).max(96)).max(MAX_SECTIONS).default([]),
    runtimePackages: z
      .array(
        z
          .object({
            source: Source,
            sections: z
              .array(
                z
                  .object({
                    sectionId: z.string().min(1).max(96),
                    // Do not trim/normalize: the UTF-8 bytes are compared with a server pin.
                    text: z.string().min(1).max(MAX_RUNTIME_REQUEST_BYTES),
                  })
                  .strict(),
              )
              .min(1)
              .max(MAX_SECTIONS),
          })
          .strict(),
      )
      .max(2)
      .default([]),
    context: z
      .array(
        z
          .object({
            question: z.string().trim().min(3).max(2000),
            answer: z.string().trim().min(1).max(8000),
            receipt: Receipt,
          })
          .strict(),
      )
      .max(3)
      .default([]),
  })
  .strict();
const ModelAnswer = z
  .object({
    answer: z.string().trim().min(1).max(8000),
    support: z.enum(['cited', 'insufficient-source']),
    citations: z.array(Citation).max(8),
  })
  .strict();

function fault(code, status = 409) {
  return new AppError(
    'The counsel source package or requested scope could not be verified',
    status,
    code,
  );
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const key = (sourceId, sectionId) => JSON.stringify([sourceId, sectionId]);

function oaRecord(section) {
  return {
    source: {
      sourceId: COUNSEL_SOURCE_ID,
      ...OA_COUNSEL_SOURCE,
      packageDigest: COUNSEL_CORPUS_DIGEST,
    },
    sectionId: section.id,
    sectionDigest: sourceForSection(section).sectionDigest,
    text: section.text,
    // Reuse V1's exact heading-boundary behavior, including its orphan refusal.
    scope: (clause) => clauseText(section, clause),
    allowedClauses: section.refs.filter((clause) => clauseText(section, clause) !== null),
  };
}

function runtimeRecord(manifest, descriptor, text) {
  if (sha256(text) !== descriptor.digest) throw fault('runtime_section_mismatch');
  // The public manifest owns these ranges; the caller cannot supply or amend
  // them. Validate structure before slicing the hash-verified text.
  for (const [clause, range] of Object.entries(descriptor.clauses)) {
    if (
      !clause ||
      !Array.isArray(range) ||
      range.length !== 2 ||
      !range.every(Number.isInteger) ||
      range[0] < 0 ||
      range[1] <= range[0] ||
      range[1] > text.length
    ) {
      throw fault('invalid_source_manifest', 503);
    }
  }
  if (
    manifest.source.sourceKind === 'recorded-intent' &&
    (manifest.source.status !== 'verified-historical' ||
      !Attribution.safeParse(manifest.attribution).success)
  ) {
    throw fault('unverified_intent_source', 503);
  }
  if (manifest.attribution && manifest.source.sourceKind !== 'recorded-intent') {
    throw fault('invalid_source_manifest', 503);
  }
  return {
    source: Source.parse(manifest.source),
    sectionId: descriptor.sectionId,
    sectionDigest: descriptor.digest,
    text,
    attribution: manifest.attribution ? Attribution.parse(manifest.attribution) : undefined,
    allowedClauses: Object.keys(descriptor.clauses),
    scope: (clause) => {
      if (clause === null) return text;
      const range = Object.hasOwn(descriptor.clauses, clause) ? descriptor.clauses[clause] : null;
      return range ? text.slice(range[0], range[1]) : null;
    },
  };
}

function receiptSources(records) {
  return records.map((record) => ({
    ...record.source,
    sectionId: record.sectionId,
    sectionDigest: record.sectionDigest,
    ...(record.attribution ? { attribution: record.attribution } : {}),
  }));
}

function citationsMatch(citations, records) {
  return citations.every((citation) => {
    const record = records.find(
      (candidate) =>
        candidate.source.sourceId === citation.sourceId &&
        candidate.sectionId === citation.sectionId,
    );
    const scope = record?.scope(citation.clause);
    return typeof scope === 'string' && scope.includes(citation.quote);
  });
}

/** The registry is a code-owned dependency, never an HTTP request field. */
export function resolveRuntimeCounselRequest(request, manifests = RUNTIME_SOURCE_MANIFESTS) {
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_RUNTIME_REQUEST_BYTES)
    throw fault('runtime_request_too_large', 413);
  const records = [];
  const seen = new Set();
  const packages = new Set();
  for (const supplied of request.runtimePackages) {
    if (supplied.source.sourceId === COUNSEL_SOURCE_ID) throw fault('reserved_source_package');
    if (packages.has(supplied.source.sourceId)) throw fault('duplicate_source_package', 400);
    packages.add(supplied.source.sourceId);
    const manifest = manifests.find(
      (candidate) => candidate.source.sourceId === supplied.source.sourceId,
    );
    if (
      !manifest ||
      !Object.entries(manifest.source).every(([name, value]) => supplied.source[name] === value)
    )
      throw fault('runtime_source_mismatch');
    for (const section of supplied.sections) {
      const id = key(manifest.source.sourceId, section.sectionId);
      if (seen.has(id)) throw fault('duplicate_source_section', 400);
      seen.add(id);
      const descriptor = manifest.sections.find(
        (candidate) => candidate.sectionId === section.sectionId,
      );
      if (!descriptor) throw fault('unknown_runtime_section', 400);
      records.push(runtimeRecord(manifest, descriptor, section.text));
    }
  }
  const oaSections = [
    ...(request.target.sourceId === COUNSEL_SOURCE_ID ? [request.target.sectionId] : []),
    ...(request.relatedOASections ?? []),
  ];
  for (const sectionId of oaSections) {
    const id = key(COUNSEL_SOURCE_ID, sectionId);
    if (seen.has(id)) throw fault('duplicate_source_section', 400);
    seen.add(id);
    const section = sectionFor(sectionId);
    if (!section || section.id !== sectionId) throw fault('unknown_section', 400);
    records.push(oaRecord(section));
  }
  if (records.length > MAX_SECTIONS) throw fault('too_many_source_sections', 400);
  if (
    records.reduce((total, record) => total + Buffer.byteLength(record.text, 'utf8'), 0) >
    MAX_RESOLVED_SOURCE_BYTES
  )
    throw fault('resolved_sources_too_large', 413);
  records.sort((a, b) => {
    const left = key(a.source.sourceId, a.sectionId);
    const right = key(b.source.sourceId, b.sectionId);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const targetRecord = records.find(
    (record) =>
      record.source.sourceId === request.target.sourceId &&
      record.sectionId === request.target.sectionId,
  );
  if (
    !targetRecord ||
    request.target.digest !== targetRecord.source.digest ||
    request.target.packageDigest !== targetRecord.source.packageDigest
  )
    throw fault('target_source_mismatch');
  const targetText = targetRecord.scope(request.target.clause);
  if (targetText === null) throw fault('unknown_clause', 400);
  if (request.selection && !targetText.includes(request.selection))
    throw fault('selection_mismatch');
  const sources = receiptSources(records);
  const target = Target.parse(request.target);
  const scopeDigest = sha256(JSON.stringify({ target, sources }));
  for (const turn of request.context) {
    const receipt = turn.receipt;
    if (
      receipt.scopeDigest !== scopeDigest ||
      !same(receipt.target, target) ||
      !same(receipt.sources, sources) ||
      !citationsMatch(receipt.citations, records)
    )
      throw fault('history_source_mismatch');
  }
  return {
    contractVersion: RUNTIME_CONTRACT,
    target,
    question: request.question,
    selection: request.selection ?? null,
    context: request.context,
    records,
    sources,
    scopeDigest,
    availability: {
      EAP: records.some((record) => record.source.document === 'EAP')
        ? 'supplied-sections'
        : 'not-supplied',
      founderIntent: records.some((record) => record.source.sourceKind === 'recorded-intent')
        ? 'supplied-excerpts'
        : 'unavailable',
    },
  };
}

export function validateRuntimeCounselAnswer(value, resolved) {
  const parsed = ModelAnswer.safeParse(value);
  if (
    !parsed.success ||
    (parsed.data.support === 'cited'
      ? parsed.data.citations.length === 0
      : parsed.data.citations.length !== 0) ||
    !citationsMatch(parsed.data.citations, resolved.records)
  ) {
    throw new AppError(
      'The counsel answer did not provide checkable source citations',
      502,
      'invalid_counsel_citations',
    );
  }
  return parsed.data;
}

export function makeRuntimeCounselReceipt(resolved, citations) {
  return {
    contractVersion: RUNTIME_CONTRACT,
    promptVersion: RUNTIME_PROMPT_VERSION,
    verification: 'source-and-quote-only',
    scopeDigest: resolved.scopeDigest,
    target: resolved.target,
    sources: resolved.sources,
    citations,
  };
}
