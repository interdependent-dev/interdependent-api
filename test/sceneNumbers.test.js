import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripSceneNumbers } from '../src/services/sceneNumbers.js';
import {
  normalizeExtractedText,
  watermarkStrings,
  stripWatermarkLines,
} from '../src/services/pdfService.js';

const body = ['Mia pours coffee.', 'JOHN', 'You sleep at all?'];

test('two-sided margin numbers after headings are stripped (glued or spaced)', () => {
  const text = [
    'EXT. NEW JERSEY SCHOOLYARD - AFTERNOON11',
    ...body,
    'CONTINUED:11',
    ...body,
    'INT. CAR - MOMENTS LATER 2 2',
    ...body,
    'EXT. NEW JERSEY STREET - CONTINUOUS 3 3',
    ...body,
    'CONTINUED: (2) 13 13',
    ...body,
    'INT. KNIGHT HOUSE - DAY1111',
    ...body,
    'MONTAGE:5656',
    ...body,
    'EXT. NEW JERSEY SCHOOL 108 108',
  ].join('\n');
  const r = stripSceneNumbers(text);
  assert.equal(r.mode, 'doubled');
  const lines = r.text.split('\n');
  for (const want of [
    'EXT. NEW JERSEY SCHOOLYARD - AFTERNOON',
    'CONTINUED:',
    'INT. CAR - MOMENTS LATER',
    'EXT. NEW JERSEY STREET - CONTINUOUS',
    'CONTINUED: (2)',
    'INT. KNIGHT HOUSE - DAY', // 11|11, not DAY11 + 1|1
    'MONTAGE:',
    'EXT. NEW JERSEY SCHOOL',
  ])
    assert.ok(lines.includes(want), want);
});

test('dialogue and character cues are never touched', () => {
  const text = [
    'INT. STATION - DAY11',
    'COP #11',
    'Call 911.',
    'AGENT 99',
    'INT. STATION - LATER22',
    'COP #22',
    'He was 44.',
    'INT. CELL - NIGHT33',
    'BOY 33',
  ].join('\n');
  const lines = stripSceneNumbers(text).text.split('\n');
  for (const keep of ['COP #11', 'Call 911.', 'AGENT 99', 'COP #22', 'He was 44.', 'BOY 33']) {
    assert.ok(lines.includes(keep), keep);
  }
});

test('an un-numbered script is left exactly as it is', () => {
  const text = [
    'EXT. ROUTE 66 - DAY',
    ...body,
    'EXT. ROUTE 66',
    ...body,
    'INT. APARTMENT 4B - NIGHT',
    ...body,
    'INT. ROOM 101 - NIGHT',
    ...body,
  ].join('\n');
  const r = stripSceneNumbers(text);
  assert.equal(r.mode, null);
  assert.equal(r.text, text);
});

test('right-margin-only and left-margin-only numbering', () => {
  const right = ['INT. KITCHEN - NIGHT12', 'INT. HALL - DAY13', 'EXT. YARD - DAY14A'].join('\n');
  const r = stripSceneNumbers(right);
  assert.equal(r.mode, 'trailing');
  assert.deepEqual(r.text.split('\n'), [
    'INT. KITCHEN - NIGHT',
    'INT. HALL - DAY',
    'EXT. YARD - DAY',
  ]);

  const left = ['12INT. KITCHEN - NIGHT', '13 INT. HALL - DAY', '14AEXT. YARD - DAY'].join('\n');
  const l = stripSceneNumbers(left);
  assert.equal(l.mode, 'leading');
  assert.deepEqual(l.text.split('\n'), [
    'INT. KITCHEN - NIGHT',
    'INT. HALL - DAY',
    'EXT. YARD - DAY',
  ]);
});

test('numbers on both ends of the same heading line', () => {
  const text = [
    '1EXT/INT. INDUSTRIAL DISTRICT - CAR - NIGHT1',
    '19INT. SING SING - DAY19',
    "26 INT. CLASSROOM JESUIT SCHOOL/DAY (DOMINGO'S DIARY) 26",
    '100 EXT. GARDEN/DAY 100',
  ].join('\n');
  const r = stripSceneNumbers(text);
  assert.equal(r.mode, 'mirrored');
  assert.deepEqual(r.text.split('\n'), [
    'EXT/INT. INDUSTRIAL DISTRICT - CAR - NIGHT',
    'INT. SING SING - DAY',
    "INT. CLASSROOM JESUIT SCHOOL/DAY (DOMINGO'S DIARY)",
    'EXT. GARDEN/DAY',
  ]);
});

test('unchanged marker lines keep their original whitespace', () => {
  const text = ['INT. A - DAY11', 'INT. B - DAY22', 'INT. C - DAY33', '   BACK TO SCENE   '].join(
    '\n',
  );
  assert.ok(stripSceneNumbers(text).text.split('\n').includes('   BACK TO SCENE   '));
});

test('numbered secondary headings are stripped only in scene sequence; cues are safe', () => {
  const text = [
    'INT. CLUB - NIGHT11',
    'AGENT 99',
    'Copy that.',
    'BACKYARD22',
    'Quinn waits.',
    'INT. DINER - DAY 3 3',
    'COP #11',
    'Freeze!',
    'QUINN ON STAGE 4 4',
    'AGENT 55',
    'Go.',
    'INT. HALL - DAY1717',
    'IPAD SCREEN1818',
    'LATER 19 19',
    'INT. CAR - NIGHT2020',
  ].join('\n');
  const r = stripSceneNumbers(text);
  assert.equal(r.mode, 'doubled');
  assert.deepEqual(r.text.split('\n'), [
    'INT. CLUB - NIGHT',
    'AGENT 99',
    'Copy that.',
    'BACKYARD',
    'Quinn waits.',
    'INT. DINER - DAY',
    'COP #11',
    'Freeze!',
    'QUINN ON STAGE',
    'AGENT 55',
    'Go.',
    'INT. HALL - DAY',
    'IPAD SCREEN',
    'LATER',
    'INT. CAR - NIGHT',
  ]);
});

test('extraction normalizer flattens tabs/space runs and strips scene numbers', () => {
  const raw = [
    'GRAHAM',
    '                                       Shh! Keep your voice down! Yes, in the ',
    '                 maintenance room.',
    "AUDREY       (CONT'D) ",
    'INT. A - DAY\t1 \t1',
    'INT. B - DAY\t2 \t2',
    'CONTINUED:\t2 \t2',
    'INT. C - DAY\t3 \t3',
    '-- 1 of 3 --',
  ].join('\n');
  assert.deepEqual(normalizeExtractedText(raw).split('\n'), [
    'GRAHAM',
    'Shh! Keep your voice down! Yes, in the',
    'maintenance room.',
    "AUDREY (CONT'D)",
    'INT. A - DAY',
    'INT. B - DAY',
    'CONTINUED:',
    'INT. C - DAY',
    '-- 1 of 3 --',
  ]);
});

const item = (str, y, opts = {}) => ({ str, transform: opts.transform ?? [12, 0, 0, 12, 100, y] });
const ROTATED = [47.7, 47.7, -47.7, 47.7, 80, 300]; // 67.5pt at 45°
const HUGE = [50, 0, 0, 50, 60, 400];

test('watermark strings = unusual type repeated on most pages; titles and italics are not', () => {
  const page = (k) => [
    item('INT. OBGYN OFFICE - NIGHT', 700),
    item('LARISSA', 680),
    item(`Is the baby ok? ${k}`, 660),
    item('COURTNEY PARCHM', 300, { transform: ROTATED }),
    item('CO', 280, { transform: ROTATED }),
    item('Kayrom Studios', 400, { transform: HUGE }),
    ...Array.from({ length: 20 }, (_, j) => item(`line ${j}`, 600 - j * 14)),
  ];
  const pages = Array.from({ length: 20 }, (_, k) => page(k));
  pages[0].unshift(item('3 MONTHS OF KILLING', 500, { transform: [36, 0, 0, 36, 150, 500] })); // cover title, one page
  pages[3].push(item('(SOFTLY)', 100, { transform: [12, 0, 3, 12, 200, 100] })); // skewed italic, one page
  const w = watermarkStrings(pages);
  assert.deepEqual([...w].sort(), ['CO', 'COURTNEY PARCHM', 'Kayrom Studios']);
});

test('short documents never yield watermark strings', () => {
  const pages = Array.from({ length: 5 }, () => [
    item('DRAFT', 0, { transform: ROTATED }),
    item('x', 0),
  ]);
  assert.equal(watermarkStrings(pages).size, 0);
});

test('watermark lines are dropped from the joined text; page joiners and body stay', () => {
  const pageText = (k) =>
    [
      'CO',
      'COURTNEY PARCHM',
      'URTNEY PARCHM',
      'Kayrom Studios',
      `INT. ROOM - DAY ${k}`,
      'MA',
      'Hi.',
    ].join('\n');
  const pages = Array.from({ length: 12 }, (_, k) => ({ num: k + 1, text: pageText(k) }));
  const result = {
    pages,
    text: pages.map((p) => `-- ${p.num} of 12 --\n${p.text}`).join('\n\n'),
    total: 12,
  };
  const out = stripWatermarkLines(
    result,
    new Set(['CO', 'COURTNEY PARCHM', 'OURTNEY PARCHMA', 'Kayrom Studios']),
  );
  const lines = out.split('\n');
  for (const gone of ['CO', 'COURTNEY PARCHM', 'URTNEY PARCHM', 'Kayrom Studios'])
    assert.ok(!lines.includes(gone), gone);
  for (const kept of ['-- 1 of 12 --', 'INT. ROOM - DAY 0', 'MA', 'Hi.'])
    assert.ok(lines.includes(kept), kept); // "MA" is a cue: short and not a watermark item
  assert.equal(stripWatermarkLines(result, new Set()), result.text);
});
