// Span of the first balanced {...} object, honoring strings/escapes so braces
// inside quoted text don't miscount. Returns { text, end } or null.
function firstBalancedObject(s) {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { text: s.slice(start, i + 1), end: i + 1 };
  }
  return null;
}

export function extractJson(text) {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const noTrailingCommas = (x) => x.replace(/,(\s*[}\]])/g, '$1');
  const tryParse = (x) => {
    try {
      return JSON.parse(x);
    } catch {
      return undefined;
    }
  };

  let r = tryParse(stripped);
  if (r !== undefined) return r;

  const a = stripped.indexOf('{');
  const b = stripped.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  const slice = stripped.slice(a, b + 1);

  r = tryParse(slice) ?? tryParse(noTrailingCommas(slice)); // prose around it / trailing commas
  if (r !== undefined) return r;

  // The model sometimes closes the root object early and dangles the remaining
  // top-level keys after it (an artifact of an ambiguous template). Drop the
  // premature closing brace so the dangling tail (", key": ...) merges back in.
  const fo = firstBalancedObject(slice);
  if (fo && fo.end < slice.length && slice.slice(fo.end).trimStart().startsWith(',')) {
    const merged = slice.slice(0, fo.end - 1) + slice.slice(fo.end);
    r = tryParse(noTrailingCommas(merged));
    if (r !== undefined) return r;
  }
  // Last resort: the first complete object on its own.
  return fo ? (tryParse(fo.text) ?? null) : null;
}
