/**
 * Strip margin SCENE NUMBERS that pdf-parse appends to scene headings.
 *
 * Shooting scripts print each scene number in the left AND right margins:
 *
 *     12   INT. KITCHEN - NIGHT                                12
 *
 * pdf-parse drops the column layout and emits both numbers after the heading —
 * "INT. KITCHEN - NIGHT 12 12" (v2, tab-separated) or "INT. KITCHEN - NIGHT1212"
 * (v1, glued), "CONTINUED: (2) 12 12" — which is not what the writer's page
 * looks like. The model then reads that as sloppy
 * formatting and docks the writer for OUR extraction artifact (seen on SON OF
 * SCARFACE, 2026-09-23: "scene numbers appear directly concatenated with slug
 * lines… making them unreadable"). The page itself was clean.
 *
 * Only marker lines are touched — scene headings, CONTINUED lines, and the
 * heading-like transitions shooting scripts also number (MONTAGE, OMITTED…) —
 * never dialogue or character cues ("COP #11", "AGENT 99" stay intact). And only
 * when the document as a whole shows the pattern: an un-numbered script with a
 * heading like "EXT. ROUTE 66" is left exactly as it is.
 */

const NUM = '\\d{1,4}[A-Z]{0,2}';

// Scene heading, optionally preceded by a left-margin number glued to it.
const HEADING = new RegExp(`^(?:${NUM})?\\s*(?:INT|EXT|I\\/E|EST)(?:\\.|\\/|\\s)`);
const CONTINUED = /^CONTINUED\b/;
const OTHER_MARKER = /^(?:MONTAGE|SERIES OF SHOTS|INTERCUT|FLASHBACK|OMITTED|BACK TO)\b/;

const isMarker = (l) => HEADING.test(l) || CONTINUED.test(l) || OTHER_MARKER.test(l);

// Left + right number, doubled at the end: glued ("...NIGHT1212", v1) or
// space-separated on both sides ("...NIGHT 12 12", v2's tabs flattened). A
// single spaced number ("EXT. ROUTE 66", "AGENT 55") matches neither. Lazy
// head so "DAY1111" splits as DAY + 11|11, not DAY11 + 1|1.
const DOUBLED = new RegExp(`^(.*?\\S)(?:(${NUM})\\2|\\s+(${NUM})\\s+\\3)$`);
// Right margin only: one number glued straight onto a letter, colon or paren.
const TRAILING = new RegExp(`^(.*?[A-Za-z:)])(${NUM})$`);
// Same number at both ends of the line: "1EXT. CAR - NIGHT1", "26 INT. SCHOOL/DAY 26".
const MIRRORED = new RegExp(`^(${NUM})\\s*(.*?\\S)\\s*\\1$`);
// Left margin only: number glued onto the front of the heading.
const LEADING = new RegExp(`^(${NUM})\\s*(?=(?:INT|EXT|I\\/E|EST)(?:\\.|\\/|\\s))`);

// Numbered SECONDARY headings ("QUINN ON STAGE1818", "IPAD SCREEN 26 26",
// "LATER6565"): an all-caps line with the doubled number appended.
// Only stripped when the number continues the scene sequence, so a character
// cue ("AGENT 99", "COP #11") is never mistaken for one.
const SECONDARY = new RegExp(`^([A-Z][^a-z]*?[A-Z)])(?:(${NUM})\\2|\\s+(${NUM})\\s+\\3)$`);

// A pattern must cover at least this share of marker lines (and MIN_HITS lines)
// before the document is treated as scene-numbered.
const MIN_SHARE = 0.5;
const MIN_HITS = 3;

const toNumber = (s) => parseInt(String(s).replace(/[A-Z]/g, ''), 10);
const markerNumber = (t) => {
  let m;
  if ((m = t.match(MIRRORED))) return toNumber(m[1]);
  if ((m = t.match(DOUBLED))) return toNumber(m[2] ?? m[3]);
  if ((m = t.match(TRAILING))) return toNumber(m[2]);
  if ((m = t.match(LEADING))) return toNumber(m[1]);
  return NaN;
};

/**
 * @param {string} text  raw pdf-parse text
 * @returns {{ text: string, stripped: number, mode: 'mirrored'|'doubled'|'trailing'|'leading'|null }}
 */
export function stripSceneNumbers(text) {
  const lines = (text || '').split('\n');
  const markers = lines.map((l) => l.trim()).filter(isMarker);
  const share = (re) => {
    const hits = markers.filter((l) => re.test(l)).length;
    return hits >= MIN_HITS && hits >= markers.length * MIN_SHARE;
  };

  let mode = null;
  if (share(MIRRORED)) mode = 'mirrored';
  else if (share(DOUBLED)) mode = 'doubled';
  else if (share(TRAILING)) mode = 'trailing';
  else if (share(LEADING)) mode = 'leading';
  if (!mode) return { text, stripped: 0, mode };

  // The document is scene-numbered, so any margin number on a marker line is an
  // artifact — whichever side(s) the parser happened to put it on.
  const clean = (t) => {
    const m = t.match(MIRRORED);
    if (m) return m[2];
    let c = t.replace(DOUBLED, '$1');
    if (c === t) c = t.replace(TRAILING, '$1');
    return c.replace(LEADING, '').trimEnd();
  };

  let stripped = 0;
  let last = 0; // scene number of the latest heading seen
  const out = lines.map((line) => {
    const t = line.trim();
    if (isMarker(t)) {
      const n = markerNumber(t);
      if (n > last) last = n;
      const c = clean(t);
      if (c === t) return line;
      stripped++;
      return c;
    }
    if (mode !== 'doubled' && mode !== 'mirrored') return line;
    const m = t.match(SECONDARY);
    if (!m) return line;
    const digits = (m[2] ?? m[3]).replace(/[A-Z]/g, '');
    const n = parseInt(digits, 10);
    // Two-digit-plus doubles ("1818") are unambiguous; a single-digit double
    // ("66") must be exactly the next scene number.
    const inSequence = digits.length >= 2 ? n > last && n <= last + 50 : n === last + 1;
    if (!inSequence) return line;
    last = n;
    stripped++;
    return m[1].trimEnd();
  });
  return { text: out.join('\n'), stripped, mode };
}
