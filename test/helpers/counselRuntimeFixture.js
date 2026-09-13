// Deliberately synthetic. No private agreement, transcript or memory text.
import { createHash } from 'node:crypto';
export const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
export const clone = (value) => JSON.parse(JSON.stringify(value));
export function fixture(texts = ['A. Fixture alpha apples.\nB. Fixture beta berries.']) {
  const sections = texts.map((text, i) => ({ sectionId: `fixture-${i + 1}`, text }));
  const source = {
    sourceId: 'fixture-policy',
    document: 'EAP',
    version: 'fixture-1',
    sourceKind: 'economic-policy',
    status: 'review-candidate',
    digest: hash('synthetic full document identity'),
  };
  source.packageDigest = hash(JSON.stringify({ source, sections }));
  const manifest = {
    source,
    sections: sections.map((section) => ({
      sectionId: section.sectionId,
      digest: hash(section.text),
      clauses: section.text.includes('\nB.')
        ? {
            A: [0, section.text.indexOf('\nB.')],
            B: [section.text.indexOf('\nB.') + 1, section.text.length],
          }
        : { A: [0, section.text.length] },
    })),
  };
  const request = {
    contractVersion: 'counsel.v2',
    target: {
      sourceId: source.sourceId,
      digest: source.digest,
      packageDigest: source.packageDigest,
      sectionId: sections[0].sectionId,
      clause: 'A',
    },
    question: 'Explain this fixture.',
    selection: null,
    relatedOASections: [],
    runtimePackages: [{ source: clone(source), sections: clone(sections) }],
    context: [],
  };
  const answer = {
    answer: 'The synthetic fixture mentions apples.',
    support: 'cited',
    citations: [
      {
        sourceId: source.sourceId,
        sectionId: sections[0].sectionId,
        clause: 'A',
        quote: 'Fixture alpha apples.',
      },
    ],
  };
  return { manifest, request, answer };
}
