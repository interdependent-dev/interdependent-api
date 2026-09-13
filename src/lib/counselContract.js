import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import {
  OA_SECTIONS,
  OA_SOURCE_SHA256,
  OA_TRANSCRIPTION_SHA256,
  sectionFor,
} from './oaSections.js';

export const COUNSEL_CONTRACT = 'counsel.v1';
export const COUNSEL_PROMPT_VERSION = 'matlock-source-receipt.v1';
export const OA_COUNSEL_SOURCE = Object.freeze({
  document: 'OA',
  version: '1.9.0',
  sourceKind: 'agreement',
  status: 'review-candidate',
  digest: OA_SOURCE_SHA256,
});
export const COUNSEL_AVAILABILITY = Object.freeze({
  EAP: 'unavailable',
  founderIntent: 'unavailable',
});
export const COUNSEL_SOURCE_ID = 'oa-v1.9.0-review';
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Raw document, transcription and extracted package identities are distinct.
// Hash the exact, ordered server-owned extraction; no client text enters it.
export const COUNSEL_CORPUS_DIGEST = sha256(
  JSON.stringify({
    source: OA_COUNSEL_SOURCE,
    transcriptionDigest: OA_TRANSCRIPTION_SHA256,
    sections: OA_SECTIONS,
  }),
);

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Source = z
  .object({
    document: z.string().min(1).max(32),
    version: z.string().min(1).max(32),
    sourceKind: z.string().min(1).max(32),
    status: z.string().min(1).max(32),
    digest: Digest,
  })
  .strict();
const Citation = z
  .object({
    sourceId: z.string().min(1).max(64),
    sectionId: z.string().min(1).max(96),
    clause: z.string().min(1).max(24).nullable(),
    quote: z.string().min(8).max(1000),
  })
  .strict();
const Receipt = z
  .object({
    contractVersion: z.literal(COUNSEL_CONTRACT),
    corpusDigest: Digest,
    promptVersion: z.literal(COUNSEL_PROMPT_VERSION),
    verification: z.literal('source-and-quote-only'),
    sources: z
      .array(
        Source.extend({
          sourceId: z.string().min(1).max(64),
          sectionId: z.string().min(1).max(96),
          sectionDigest: Digest,
          transcriptionDigest: Digest,
        }).strict(),
      )
      .length(1),
    citations: z.array(Citation).max(8),
  })
  .strict();
export const CounselRequestSchema = z
  .object({
    contractVersion: z.literal(COUNSEL_CONTRACT),
    sectionId: z.string().trim().min(1).max(96),
    subsection: z.string().trim().min(1).max(24).nullable().optional(),
    selection: z.string().trim().min(1).max(4000).nullable().optional(),
    question: z.string().trim().min(3).max(2000),
    source: Source,
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

function sameSource(actual) {
  return Object.entries(OA_COUNSEL_SOURCE).every(([key, value]) => actual[key] === value);
}

export function sourceForSection(section) {
  return {
    ...OA_COUNSEL_SOURCE,
    sourceId: COUNSEL_SOURCE_ID,
    sectionId: section.id,
    sectionDigest: sha256(section.text),
    transcriptionDigest: OA_TRANSCRIPTION_SHA256,
  };
}

// Clause quotes must occur inside that clause (including its children), not
// merely somewhere in a 9,000-word section. Only real heading boundaries count.
// The inherited refs list has one orphan, 2.5.3.1: do not invent its text.
export function clauseText(section, clause) {
  if (clause === null || clause === section.mark) return section.text;
  if (!section.refs.includes(clause)) return null;
  const headings = section.refs.flatMap((ref) => {
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^${escaped}(?:\\.(?=\\s)|(?=\\s|$))`, 'm').exec(section.text);
    return match ? [{ ref, offset: match.index }] : [];
  });
  const start = headings.find((heading) => heading.ref === clause);
  if (!start) return null;
  const end = headings
    .filter((heading) => heading.offset > start.offset && !heading.ref.startsWith(`${clause}.`))
    .sort((a, b) => a.offset - b.offset)[0];
  return section.text.slice(start.offset, end?.offset ?? section.text.length);
}

function citationsMatch(citations, section) {
  return citations.every((citation) => {
    if (citation.sourceId !== COUNSEL_SOURCE_ID || citation.sectionId !== section.id) return false;
    const text = clauseText(section, citation.clause);
    return text !== null && text.includes(citation.quote);
  });
}

export function resolveCounselRequest(request) {
  if (!sameSource(request.source)) {
    throw new AppError(
      'The requested source is not the counsel desk’s available review source',
      409,
      'source_mismatch',
    );
  }
  const section = sectionFor(request.sectionId);
  if (!section || section.id !== request.sectionId) {
    throw new AppError('No such canonical section of the agreement', 400, 'unknown_section');
  }
  const subsection = request.subsection ?? null;
  const scope = clauseText(section, subsection);
  if (scope === null) {
    throw new AppError(
      'The requested clause has no exact source boundary in this section',
      400,
      'unknown_clause',
    );
  }
  if (request.selection && !scope.includes(request.selection)) {
    throw new AppError(
      'The selected passage does not match this source and clause',
      409,
      'selection_mismatch',
    );
  }
  const source = sourceForSection(section);
  for (const turn of request.context) {
    const receipt = turn.receipt;
    const priorSource = receipt.sources[0];
    if (
      receipt.corpusDigest !== COUNSEL_CORPUS_DIGEST ||
      !Object.entries(source).every(([key, value]) => priorSource[key] === value) ||
      !citationsMatch(receipt.citations, section)
    ) {
      throw new AppError(
        'A prior turn belongs to a different or unverifiable source',
        409,
        'history_source_mismatch',
      );
    }
  }
  return { ...request, section, subsection, source };
}

export function validateCounselAnswer(value, section) {
  const parsed = ModelAnswer.safeParse(value);
  if (
    !parsed.success ||
    (parsed.data.support === 'cited'
      ? parsed.data.citations.length === 0
      : parsed.data.citations.length !== 0) ||
    !citationsMatch(parsed.data.citations, section)
  ) {
    throw new AppError(
      'The counsel answer did not provide checkable source citations',
      502,
      'invalid_counsel_citations',
    );
  }
  return parsed.data;
}

export function makeCounselReceipt(section, citations) {
  return {
    contractVersion: COUNSEL_CONTRACT,
    corpusDigest: COUNSEL_CORPUS_DIGEST,
    promptVersion: COUNSEL_PROMPT_VERSION,
    verification: 'source-and-quote-only',
    sources: [sourceForSection(section)],
    citations,
  };
}
