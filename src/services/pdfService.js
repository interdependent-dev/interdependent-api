import { PDFParse } from 'pdf-parse';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Extract text and metadata from a PDF buffer.
 * Returns { text, pageCount, wordCount, charCount }.
 */
export async function extractText(buffer) {
  const parser = new PDFParse({ data: buffer });
  let result;
  try {
    result = await parser.getText();
  } catch (err) {
    throw new AppError(`Failed to parse PDF: ${err.message}`, 422);
  } finally {
    await parser.destroy().catch(() => {});
  }

  const text = result.text?.trim() ?? '';

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
