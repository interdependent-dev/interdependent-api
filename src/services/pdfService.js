import { PDFParse } from 'pdf-parse';
import { AppError } from '../middleware/errorHandler.js';
import { stripSceneNumbers } from './sceneNumbers.js';

/**
 * Extract text and metadata from a PDF buffer.
 * Returns { text, pageCount, wordCount, charCount }.
 */
export async function extractText(buffer) {
  const parser = new PDFParse({ data: buffer });
  let result;
  let watermarks = new Set();
  try {
    result = await parser.getText();
    // Same parsed document, second look: which text items are a reader
    // watermark. Best effort — a failure here must never fail the extraction.
    watermarks = await pageTextItems(parser.doc, result.total)
      .then(watermarkStrings)
      .catch(() => new Set());
  } catch (err) {
    throw new AppError(`Failed to parse PDF: ${err.message}`, 422);
  } finally {
    await parser.destroy().catch(() => {});
  }

  const text = normalizeExtractedText(stripWatermarkLines(result, watermarks));

  if (!text) {
    throw new AppError(
      'PDF appears to contain no extractable text (it may be image-based or encrypted)',
      422,
    );
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    pageCount: result.total ?? 0,
    wordCount,
    charCount: text.length,
  };
}

/**
 * Remove extraction artifacts so the model never scores OUR parsing against
 * the writer's page: tabs and runs of spaces carry no meaning (pdf-parse drops
 * the layout anyway), and margin scene numbers come out appended to every
 * heading ("INT. CAR - NIGHT<tab>12 <tab>12") — see sceneNumbers.js.
 */
export function normalizeExtractedText(raw) {
  const flat = (raw ?? '')
    .split('\n')
    .map((l) => l.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .trim();
  return stripSceneNumbers(flat).text;
}

// A reader watermark is text that repeats on most pages AND is drawn unlike
// body text: rotated ("COURTNEY PARCHMAN" diagonally across every page at
// 67pt) or in huge type ("Kayrom Studios", 50pt). Screenplay text is 12pt and
// never rotated. Left in, the parser chops the watermark into junk lines on
// every page and the model reads them as the writer's formatting. Both
// conditions are required: skewed italics and big cover-page titles are
// unusual type on one page or a few, and stay.
const ROTATION_EPS = 0.01;
const OVERSIZE_FACTOR = 2.5;
const WATERMARK_MIN_PAGES = 10;
const WATERMARK_PAGE_SHARE = 0.5;

const pageThreshold = (pageCount) =>
  Math.max(WATERMARK_MIN_PAGES, Math.ceil(pageCount * WATERMARK_PAGE_SHARE));

// pdf.js text items per page, from the document pdf-parse already loaded.
async function pageTextItems(doc, total) {
  if (!doc || !total) return [];
  const pages = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const { items } = await page.getTextContent();
    pages.push(items.filter((it) => typeof it.str === 'string' && Array.isArray(it.transform)));
  }
  return pages;
}

/** The strings of watermark text items: unusual type repeated on most pages. */
export function watermarkStrings(pages) {
  const size = (i) => Math.hypot(i.transform[0], i.transform[1]);
  const rotated = (i) =>
    Math.abs(i.transform[1]) > ROTATION_EPS || Math.abs(i.transform[2]) > ROTATION_EPS;
  const sizes = pages
    .flat()
    .map(size)
    .sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 0;
  const unusual = (i) => rotated(i) || (median > 0 && size(i) > OVERSIZE_FACTOR * median);

  const pagesWith = new Map();
  for (const items of pages) {
    const seen = new Set();
    for (const i of items) {
      const k = i.str.trim();
      if (!k || seen.has(k) || !unusual(i)) continue;
      seen.add(k);
      pagesWith.set(k, (pagesWith.get(k) || 0) + 1);
    }
  }
  const threshold = pageThreshold(pages.length);
  return new Set([...pagesWith].filter(([, n]) => n >= threshold).map(([k]) => k));
}

/**
 * Drop the text lines a watermark produced. pdf-parse may split a watermark
 * differently from pdf.js's items ("URTNEY PARCHM" vs "OURTNEY PARCHMA"), so a
 * line counts when it repeats on most pages and is a fragment (or superset) of
 * a watermark string; very short lines must match a watermark item exactly.
 * Everything else — including the page joiners — is left untouched.
 */
export function stripWatermarkLines(result, watermarks) {
  const text = result.text ?? '';
  const pages = result.pages ?? [];
  if (!watermarks.size || !pages.length) return text;

  const pagesWith = new Map();
  for (const p of pages) {
    const lines = new Set(
      (p.text ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
    for (const l of lines) pagesWith.set(l, (pagesWith.get(l) || 0) + 1);
  }
  const related = (l) =>
    watermarks.has(l) ||
    (l.length >= 4 && [...watermarks].some((w) => w.includes(l) || l.includes(w)));
  const threshold = pageThreshold(pages.length);
  const drop = new Set(
    [...pagesWith].filter(([l, n]) => n >= threshold && related(l)).map(([l]) => l),
  );
  if (!drop.size) return text;
  return text
    .split('\n')
    .filter((line) => !drop.has(line.trim()))
    .join('\n');
}
