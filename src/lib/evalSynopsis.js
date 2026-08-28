// ─────────────────────────────────────────────────────────────────────────────
// Reader-safe synopsis extraction — PURE (no DB, no env), unit-tested in
// test/synopsis.test.js.
//
// The AI evaluation carries two prose fields:
//   • `summary` — spoiler-FULL by design (the rubric requires it to describe how
//     the story ENDS). Curator-only; NEVER a reader-facing synopsis.
//   • `logline` — a 1–2 sentence spoiler-free, verdict-free streaming-style hook.
//     This is the reader-safe field (the public /share endpoint already treats
//     it that way), so the synopsis IS the logline. No scores, no decision, no
//     championability, no spoilers — and we never fall back to `summary`.
//
// Two evaluation schemas exist in production:
//   • legacy "Casey": evaluation_json is a flat object ({ decision, scores,
//     summary, logline?, … }). Early rows may have no logline at all → null
//     (never synthesized).
//   • "BARAKA": { decision, evaluation: { craft_score, championability_rating },
//     summary, logline, … } — logline top-level, but occasionally the whole
//     thing only survives as a ```json fenced string (in evaluation_result, or
//     even a string-typed evaluation_json), so parsing must be defensive.
// ─────────────────────────────────────────────────────────────────────────────

// Best-effort: turn whatever the row holds (object | fenced-JSON string | plain
// JSON string | garbage) into an evaluation object, or null.
function parseEvalObject(value) {
  if (value == null) return null;
  if (typeof value === 'object') return Array.isArray(value) ? null : value;
  if (typeof value !== 'string') return null;
  const stripped = value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '');
  try {
    const parsed = JSON.parse(stripped);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    /* fall through to the braces slice */
  }
  const a = stripped.indexOf('{');
  const b = stripped.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try {
    const parsed = JSON.parse(stripped.slice(a, b + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Cap prose at ~`max` chars, ending on a sentence boundary where one exists.
export function capAtSentence(text, max = 600) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  let cut = -1;
  for (const mark of ['.', '!', '?']) cut = Math.max(cut, head.lastIndexOf(mark));
  // Only honor the boundary if it leaves a real sentence; otherwise hard-trim.
  if (cut > 40) return head.slice(0, cut + 1);
  return `${head.trimEnd()}…`;
}

// The reader-safe synopsis: the spoiler-free logline, from either schema, from
// either column. Defensive everywhere — any absence/garbage returns null.
export function extractSynopsis(evaluationJson, evaluationResult = null) {
  const ev = parseEvalObject(evaluationJson) || parseEvalObject(evaluationResult);
  if (!ev) return null;
  const nested = ev.evaluation && typeof ev.evaluation === 'object' ? ev.evaluation : null;
  const candidates = [ev.logline, nested ? nested.logline : null];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return capAtSentence(c, 600);
  }
  return null; // no logline (e.g. early Casey rows) — never fall back to the spoiler summary
}

// Genre is verdict-free tagging — safe for every viewer. Same defensive parse.
export function extractGenre(evaluationJson, evaluationResult = null) {
  const ev = parseEvalObject(evaluationJson) || parseEvalObject(evaluationResult);
  if (!ev) return null;
  return typeof ev.genre === 'string' && ev.genre.trim() ? ev.genre.trim() : null;
}
