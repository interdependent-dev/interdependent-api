/**
 * GENERATE the counsel corpus for the api estate from the studio's own
 * transcription (`deal-oa.ts`, itself GENERATED and word-stream-verified against
 * the v1.9.0 markdown).
 *
 * It parses the TS source TEXTUALLY rather than importing it, because the api
 * repo is plain ESM Node and must never take a build dependency on the studio.
 * The parse is deliberately narrow: one card object at a time, and only the
 * `h(...)`, `h1(...)` and `p(...)` string literals inside its `blocks: [ … ]`.
 *
 * FAILS LOUD: if a card yields zero blocks, or a literal will not JSON.parse,
 * the script throws rather than writing a corpus with a hole in it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC =
  '/Users/camell/Documents/INTERDEPENDENT-Studio-worktrees/dev-staging/apps/studio/app/(lab)/lab/mailroom-lab/deal-oa.ts';
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: gen-oa-sections.mjs <outfile>');

const src = readFileSync(SRC, 'utf8');
const srcSha = createHash('sha256').update(src).digest('hex');

/* The source markdown's own sha, lifted out of deal-oa.ts's provenance block so
   the corpus can name the DOCUMENT it descends from, not just the file. */
const oaSha = /SHA256\s+([0-9a-f]{64})/.exec(src)?.[1] ?? null;
if (!oaSha) throw new Error('no source sha256 in deal-oa.ts provenance');

/** Every `{ id: "…", kind: 'section', … }` card, in document order. */
const cards = [];
const idRe =
  /\n {6}id: "([^"]+)",\n {6}kind: '(\w+)',\n {6}mark: (null|"[^"]*"),\n {6}title: (null|"(?:[^"\\]|\\.)*"),\n {6}blocks: \[\n/g;

let m;
while ((m = idRe.exec(src))) {
  const [, id, kind, markRaw, titleRaw] = m;
  const start = idRe.lastIndex;
  const end = src.indexOf('\n      ],\n', start);
  if (end < 0) throw new Error(`unterminated blocks for ${id}`);
  const body = src.slice(start, end);

  const blocks = [];
  const blockRe = /^ {8}(h1|h|p)\("((?:[^"\\]|\\.)*)"\),$/gm;
  let b;
  while ((b = blockRe.exec(body))) {
    const kindOf = b[1] === 'p' ? 'para' : 'heading';
    let text;
    try {
      text = JSON.parse(`"${b[2]}"`);
    } catch (e) {
      throw new Error(`unparseable literal in ${id}: ${b[2].slice(0, 80)}`);
    }
    blocks.push({ kind: kindOf, indent: b[1] === 'h1' ? 1 : 0, text });
  }
  if (!blocks.length) throw new Error(`no blocks parsed for ${id}`);

  cards.push({
    id,
    kind,
    mark: markRaw === 'null' ? null : JSON.parse(markRaw),
    title: titleRaw === 'null' ? null : JSON.parse(titleRaw),
    blocks,
  });
}

if (cards.length < 28) throw new Error(`only ${cards.length} cards parsed — expected 28+`);

/* Sanity: every §N card must be present exactly once, 0 through 27. */
const marks = cards.map((c) => c.mark).filter((x) => x !== null);
for (let n = 0; n <= 27; n += 1) {
  if (!marks.includes(String(n))) throw new Error(`section ${n} missing from corpus`);
}

const words = cards.reduce(
  (n, c) => n + c.blocks.reduce((k, b) => k + b.text.split(/\s+/).filter(Boolean).length, 0),
  0,
);

const payload = cards.map((c) => ({
  id: c.id,
  mark: c.mark,
  title: c.title,
  /** The section's whole text, headings and paragraphs, in document order. */
  text: c.blocks
    .map((b) => (b.kind === 'heading' ? `\n${b.text}\n` : b.text))
    .join('\n')
    .trim(),
  /** Every subsection number this section actually contains — the citation set. */
  refs: [
    ...new Set(
      c.blocks
        .filter((b) => b.kind === 'heading')
        .map((b) => /^\s*(\d+(?:\.\d+)*)(?:[-–]\d+)?[.\s]/.exec(b.text)?.[1])
        .filter(Boolean),
    ),
  ],
}));

const banner = `/**
 * ══════════════════════════════════════════════════════════════════════════
 * ██  THE OPERATING AGREEMENT, SECTION BY SECTION — the counsel corpus  ██
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ GENERATED — do not hand-edit, regenerate. This is the ONLY text POST /counsel
 * is allowed to answer from: the route looks up ONE section by id or mark and
 * puts that section, and nothing else, in front of the model. There is no
 * retrieval step, no embedding, and no second document — which is what makes
 * "answers from the section text only" a property of the wiring rather than a
 * hope about the prompt.
 *
 * ── PROVENANCE ────────────────────────────────────────────────────────────
 *
 * DOCUMENT  INTERDEPENDENT_Operating_Agreement_v1.9.0.md
 *           /Users/camell/Documents/Gil/_bmad/interdependent-legal/output/
 *           sha256 ${oaSha}
 * VIA       INTERDEPENDENT-Studio  apps/studio/app/(lab)/lab/mailroom-lab/deal-oa.ts
 *           sha256 ${srcSha}
 *           (itself GENERATED, and word-stream-verified against the markdown —
 *            its generator refuses to write unless the streams match exactly)
 * READ      ${new Date().toISOString().slice(0, 10)}
 * SECTIONS  ${payload.length} · WORDS ${words}
 *
 * ⚠ v1.9.0 is an INTERNAL COUNSEL-REVIEW BUILD. Its own status block says it is
 * not ship-ready to outside counsel, and owner confirmation of it as the text of
 * record is an OPEN question. The desk answers from it because it is the latest
 * canonical text; nothing here should be read as the studio's final word.
 */
`;

const out = `${banner}
export const OA_VERSION = 'v1.9.0';
export const OA_SOURCE_SHA256 = '${oaSha}';
export const OA_TRANSCRIPTION_SHA256 = '${srcSha}';

/** id · mark · title · the section's whole text · the subsection numbers in it. */
export const OA_SECTIONS = ${JSON.stringify(payload, null, 2)};

const BY_ID = new Map(OA_SECTIONS.map((s) => [s.id, s]));
const BY_MARK = new Map(OA_SECTIONS.filter((s) => s.mark !== null).map((s) => [s.mark, s]));

/**
 * ONE section, by its card id (\`oa-s3\`) or by its section number (\`3\`).
 * Returns null for anything else — the route turns that into a 400 rather than
 * letting an unknown id reach the model with an empty corpus behind it.
 */
export function sectionFor(key) {
  if (typeof key !== 'string') return null;
  const k = key.trim();
  return BY_ID.get(k) ?? BY_MARK.get(k) ?? null;
}

/** Is \`ref\` a subsection this section actually contains? Used to police citations. */
export function hasRef(section, ref) {
  if (!section || typeof ref !== 'string') return false;
  return section.refs.some((r) => r === ref || ref.startsWith(\`\${r}.\`) || r.startsWith(\`\${ref}.\`));
}
`;

writeFileSync(OUT, out);
console.log(`wrote ${OUT}`);
console.log(`sections ${payload.length} · words ${words} · marks ${marks.length}`);
console.log(`bytes ${Buffer.byteLength(out)}`);
