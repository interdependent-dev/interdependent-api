// Locks the reader-safe synopsis extraction (src/lib/evalSynopsis.js): the
// synopsis is the spoiler-free LOGLINE — never the spoiler-full summary, never
// scores/decision/championability — from either eval schema (legacy "Casey"
// flat object, "BARAKA" nested object or fenced-JSON string), defensively.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSynopsis, extractGenre, capAtSentence } from '../src/lib/evalSynopsis.js';

const LOGLINE =
  'After an assault the system refuses to punish, a horror-obsessed young woman fights to reclaim her life.';

// A representative BARAKA evaluation (nested evaluation.craft_score etc.).
const BARAKA = {
  decision: 'RECOMMEND',
  genre: 'thriller/mystery',
  country: 'US',
  evaluation: {
    craft_score: {
      story_architecture: { score: 8, rationale: 'Tight three-act spine.' },
      final_craft_score: 84,
      craft_justification: 'Strong architecture; dialogue occasionally on the nose.',
    },
    championability_rating: {
      final_championability_rating: 'HIGH',
      championability_justification: 'An exec would fight for this.',
    },
  },
  budget: '$15,000,000',
  summary:
    'SPOILERS: the heroine wins, the villain was her mentor all along, and the ending reveals everything.',
  logline: LOGLINE,
};

// A representative legacy Casey evaluation (flat; summary + scores at top level).
const CASEY = {
  decision: 'CONSIDER',
  genre: 'drama',
  scores: { story_structure: { score: 7, justification: 'Solid.' } },
  weighted_score: 71.5,
  max_budget: 2500000,
  summary: 'SPOILERS: everyone dies at the end.',
};

test('BARAKA object: synopsis = the top-level logline, never the summary', () => {
  assert.equal(extractSynopsis(BARAKA), LOGLINE);
});

test('BARAKA as a fenced ```json string (evaluation_result fallback) still yields the logline', () => {
  const fenced = '```json\n' + JSON.stringify(BARAKA) + '\n```';
  assert.equal(extractSynopsis(null, fenced), LOGLINE);
  // …and a string-typed evaluation_json parses the same way
  assert.equal(extractSynopsis(fenced, null), LOGLINE);
});

test('legacy Casey without a logline returns null — the spoiler summary is never used', () => {
  assert.equal(extractSynopsis(CASEY), null);
});

test('legacy Casey with a backfilled logline returns it', () => {
  assert.equal(extractSynopsis({ ...CASEY, logline: LOGLINE }), LOGLINE);
});

test('a logline nested under evaluation is found too', () => {
  const ev = { decision: 'PASS', evaluation: { logline: LOGLINE } };
  assert.equal(extractSynopsis(ev), LOGLINE);
});

test('the synopsis carries no verdict material', () => {
  const s = extractSynopsis(BARAKA);
  for (const banned of ['RECOMMEND', 'HIGH', '84', 'SPOILERS']) {
    assert.ok(!s.includes(banned), `synopsis leaked "${banned}"`);
  }
});

test('garbage in → null out (defensive)', () => {
  assert.equal(extractSynopsis(null), null);
  assert.equal(extractSynopsis(undefined, undefined), null);
  assert.equal(extractSynopsis(''), null);
  assert.equal(extractSynopsis('not json at all'), null);
  assert.equal(extractSynopsis(42), null);
  assert.equal(extractSynopsis([]), null);
  assert.equal(extractSynopsis({}), null);
  assert.equal(extractSynopsis({ logline: 42 }), null); // wrong type
  assert.equal(extractSynopsis({ logline: '   ' }), null); // blank
  assert.equal(extractSynopsis(null, 'prose around { broken json'), null);
});

test('long text is capped ~600 chars on a sentence boundary', () => {
  const sentence = 'This clause pads the logline out well beyond the cap. ';
  const long = sentence.repeat(30); // ~1650 chars
  const capped = extractSynopsis({ logline: long });
  assert.ok(capped.length <= 600, `capped length ${capped.length} > 600`);
  assert.ok(capped.endsWith('.'), 'must end on a sentence boundary');
});

test('capAtSentence: short text passes through; boundary-less text gets an ellipsis', () => {
  assert.equal(capAtSentence('Short and sweet.'), 'Short and sweet.');
  const noBoundary = 'x'.repeat(700);
  const capped = capAtSentence(noBoundary);
  assert.ok(capped.length <= 601); // 600 + ellipsis
  assert.ok(capped.endsWith('…'));
});

test('extractGenre works on both schemas and fenced strings, defensively', () => {
  assert.equal(extractGenre(BARAKA), 'thriller/mystery');
  assert.equal(extractGenre(CASEY), 'drama');
  assert.equal(
    extractGenre(null, '```json\n' + JSON.stringify(BARAKA) + '\n```'),
    'thriller/mystery',
  );
  assert.equal(extractGenre({}), null);
  assert.equal(extractGenre('garbage'), null);
});
