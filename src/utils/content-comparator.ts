/**
 * content-comparator.ts
 *
 * Compares the text content of an original BR page against the migrated Wix page.
 *
 * Uses the same text extraction approach as @wix/html-to-rich-text (site-immigrator-wml-ctoo):
 *  - Strip non-whitelisted HTML, decode entities, normalize whitespace
 *  - Tokenize to normalized word sets
 *  - Score using Jaccard similarity (intersection / union)
 *  - Surface missing key phrases from original not found in migrated
 *
 * Why Jaccard? It's robust to reordering (Wix templates reflow content),
 * doesn't penalize synonyms, and gives a 0–100% score that's easy to read
 * in a QA checklist.
 */

import { htmlToText, tokenize } from './html-to-text.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContentFieldSource {
  /** Field identifier (e.g. "OurFirm", "Disclosure") */
  fieldName: string;
  /** Raw HTML from the BR source (user-content-fields or user-custom-pages) */
  html: string;
}

export interface ContentComparisonResult {
  /** Which BR field this result is for */
  fieldName: string;
  /** Original plain text after HTML cleaning */
  originalText: string;
  /** Jaccard similarity score 0–1 */
  similarity: number;
  /** Percentage string for display */
  similarityPct: string;
  /** Rating: high (≥0.75), medium (0.5–0.75), low (<0.5) */
  rating: 'high' | 'medium' | 'low';
  /** Key words/phrases in the original NOT found in the migrated text */
  missingKeyTerms: string[];
  /** Whether this comparison has enough content to be meaningful */
  meaningful: boolean;
}

export interface PageContentComparison {
  pageUrl: string;
  pageTitle: string;
  fields: ContentComparisonResult[];
  /** Overall score across all fields on the page */
  overallSimilarity: number;
  /** true if all fields score ≥ 0.75 */
  allHigh: boolean;
}

// ─── Thresholds ──────────────────────────────────────────────────────────────

const SIMILARITY_HIGH = 0.75;
const SIMILARITY_MEDIUM = 0.50;

/** Minimum number of meaningful words for a comparison to be worth reporting */
const MIN_WORD_COUNT = 10;

// ─── Core comparison ─────────────────────────────────────────────────────────

/**
 * Compute Jaccard similarity between two word sets.
 * |A ∩ B| / |A ∪ B|
 */
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

/**
 * Find key terms from the original text that are absent in the migrated text.
 * Returns up to 10 most significant missing terms (longest words first —
 * they tend to be more domain-specific and meaningful).
 */
function findMissingKeyTerms(
  originalWords: Set<string>,
  migratedWords: Set<string>,
  limit = 10
): string[] {
  return [...originalWords]
    .filter((w) => !migratedWords.has(w) && w.length > 4)  // skip short words
    .sort((a, b) => b.length - a.length)
    .slice(0, limit);
}

/**
 * Compare a single BR content field's HTML against a Wix page's extracted text.
 */
export function compareContentField(
  fieldName: string,
  originalHtml: string,
  migratedPageText: string
): ContentComparisonResult {
  const { text: originalText } = htmlToText(originalHtml);
  const originalWords = tokenize(originalText);
  const migratedWords = tokenize(migratedPageText);

  const meaningful = originalWords.size >= MIN_WORD_COUNT;
  const similarity = meaningful ? jaccardSimilarity(originalWords, migratedWords) : 1;
  const missingKeyTerms = meaningful ? findMissingKeyTerms(originalWords, migratedWords) : [];

  const rating: ContentComparisonResult['rating'] =
    similarity >= SIMILARITY_HIGH ? 'high' :
    similarity >= SIMILARITY_MEDIUM ? 'medium' : 'low';

  return {
    fieldName,
    originalText,
    similarity,
    similarityPct: `${Math.round(similarity * 100)}%`,
    rating,
    missingKeyTerms,
    meaningful,
  };
}

/**
 * Compare all BR content fields for a page against the Wix page's combined text.
 *
 * @param fields     BR content fields (HTML) for this page
 * @param pageText   Full text extracted from the Wix page (all sections combined)
 * @param pageUrl    Used for identification in the report
 * @param pageTitle  Used for display
 */
export function comparePageContent(
  fields: ContentFieldSource[],
  pageText: string,
  pageUrl: string,
  pageTitle: string
): PageContentComparison {
  const results = fields
    .filter((f) => f.html && f.html.trim().length > 0)
    .map((f) => compareContentField(f.fieldName, f.html, pageText));

  const meaningful = results.filter((r) => r.meaningful);
  const overallSimilarity =
    meaningful.length > 0
      ? meaningful.reduce((sum, r) => sum + r.similarity, 0) / meaningful.length
      : 1;

  return {
    pageUrl,
    pageTitle,
    fields: results,
    overallSimilarity,
    allHigh: meaningful.every((r) => r.rating === 'high'),
  };
}

/**
 * Match BR custom pages to scanned Wix pages by title similarity.
 * Returns pairs of (brPageTitle, wixPageUrl) for comparison.
 */
export function matchBrPagesToWixPages(
  brPages: Array<{ pageTitle: string; fields: ContentFieldSource[] }>,
  wixPages: Array<{ url: string; title: string; textContent: string }>
): Array<{
  brTitle: string;
  fields: ContentFieldSource[];
  wixUrl: string;
  wixTitle: string;
  wixText: string;
}> {
  return brPages.map((brPage) => {
    // Find best Wix page match by title word overlap
    const brTitleWords = tokenize(brPage.pageTitle);

    let bestMatch = wixPages[0];
    let bestScore = 0;

    for (const wixPage of wixPages) {
      const wixTitleWords = tokenize(wixPage.title);
      const score = jaccardSimilarity(brTitleWords, wixTitleWords);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = wixPage;
      }
    }

    return {
      brTitle: brPage.pageTitle,
      fields: brPage.fields,
      wixUrl: bestMatch?.url ?? '/',
      wixTitle: bestMatch?.title ?? '',
      wixText: bestMatch?.textContent ?? '',
    };
  });
}
