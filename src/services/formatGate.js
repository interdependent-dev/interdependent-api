/**
 * Pre-evaluation screenplay FORMATTING gate.
 *
 * Rejects PDFs that are not laid out as screenplays BEFORE they ever reach the
 * model — so a malformed submission can never be scored, recommended, or shown
 * with an evaluation. The writer is told to fix it and resubmit.
 *
 * The signature it detects is "broken line wrapping": text reflowed at an
 * erratic / narrow width that strands single mid-sentence words on their own
 * lines (e.g. "...an imperfect line of" / "parking" / "meters stretch..."). This
 * is the fingerprint of a script that was pasted from a chat or document and run
 * through a generic PDF generator (ReportLab, a print-to-PDF of raw text, etc.)
 * instead of being exported from a screenwriting tool. Such a file reads as
 * unprofessional and is not in screenplay format.
 *
 * An "orphan" here = a line that is a single lowercase word with NO trailing
 * punctuation, i.e. the sentence continues on the next line. Properly formatted
 * screenplays essentially never do this; sentence-ending short lines ("trees.")
 * are explicitly NOT orphans.
 *
 * Calibrated on 80 real submitted screenplays (clean) plus known-broken
 * submissions extracted with the SAME pdf-parse text the model reads:
 *     clean corpus       : median 0.01, p95 0.05, MAX 0.09 orphans/page
 *     broken (raw paste) : 1.0 - 1.2 orphans/page
 * The 0.4/page threshold sits ~4x above the worst clean script and ~2.6x below
 * the broken ones — a >10x separation, ~0 false-positive risk on the corpus.
 * Tune ORPHAN_PER_PAGE_LIMIT if real submissions ever land in the gap.
 */

const ORPHAN_PER_PAGE_LIMIT = 0.4;
const MIN_ORPHANS = 10; // absolute floor — a short excerpt can't trip the rate
const LINES_PER_PAGE = 55; // fallback page estimate when pageCount is unknown

// A lone lowercase word, no trailing punctuation → a sentence orphaned across a
// broken wrap. Trailing-dash interruptions ("anything-") and sentence enders
// ("trees.") are deliberately excluded — both are legitimate in real scripts.
const isOrphanLine = (l) => /^[a-z][a-z'’]{0,16}$/.test(l);

/**
 * @param {string} text     extracted screenplay text (the same text the model evaluates)
 * @param {object} opts
 * @param {number} opts.pageCount  pages from the PDF parse (0/undefined → estimated)
 * @returns {{ ok: boolean, reasons: Array<{code:string,detail:string}>, metrics: object }}
 */
export function screenplayFormatGate(text, { pageCount = 0 } = {}) {
  const reasons = [];
  const nonblank = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const orphans = nonblank.filter(isOrphanLine);
  const pages = Math.max(pageCount || 0, Math.round(nonblank.length / LINES_PER_PAGE), 1);
  const orphansPerPage = Number((orphans.length / pages).toFixed(2));

  if (orphans.length >= MIN_ORPHANS && orphansPerPage >= ORPHAN_PER_PAGE_LIMIT) {
    const sample = [...new Set(orphans)]
      .slice(0, 6)
      .map((w) => `"${w}"`)
      .join(', ');
    reasons.push({
      code: 'broken_line_wrapping',
      detail:
        `The screenplay's text is reflowed at a broken width, leaving roughly ${orphansPerPage} ` +
        `single words per page stranded on their own lines (e.g. ${sample}). Properly formatted ` +
        `screenplays show under 0.1 per page. This indicates the file was generated from pasted ` +
        `text rather than exported from a screenwriting application, and is not in standard ` +
        `screenplay format.`,
    });
  }

  return {
    ok: reasons.length === 0,
    reasons,
    metrics: { pages, orphans: orphans.length, orphansPerPage },
  };
}
