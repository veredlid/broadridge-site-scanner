/**
 * html-to-text.ts
 *
 * Converts Broadridge CKEditor HTML to clean plain text for comparison.
 *
 * Mirrors the philosophy of @wix/html-to-rich-text used by the site-immigrator-wml-ctoo
 * team — same tag whitelist, same CSS property whitelist, same superscript symbol map.
 * We output plain text rather than Wix-compatible HTML since our goal is comparison,
 * not component generation.
 *
 * References:
 *   packages/html-to-rich-text/src/html-to-rich-text.js  (site-immigrator-wml-ctoo)
 *   packages/html-to-rich-text/src/report.js
 */

// ─── Whitelists (identical to @wix/html-to-rich-text) ───────────────────────

/**
 * HTML tags that are meaningful to preserve during conversion.
 * Everything else is unwrapped (content kept) or removed (script/style).
 */
export const TAG_WHITELIST = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'span', 'ul', 'ol', 'li', 'br',
  'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
]);

/**
 * CSS properties worth preserving for layout/visual context.
 * Unlisted properties (border, display, position, etc.) are stripped.
 */
export const STYLE_WHITELIST = new Set([
  'font-family', 'font-face', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'color', 'background-color', 'text-align',
  'margin-left', 'text-shadow', 'line-height', 'letter-spacing',
  'width', 'padding', 'margin',
]);

/**
 * Superscript text → Unicode symbol mapping.
 * Handles the common financial/legal marks that appear in BR content.
 */
export const SUPERSCRIPT_MAP: Record<string, string> = {
  TM: '™', tm: '™', SM: '℠', sm: '℠',
  R: '®', r: '®', c: '©', C: '©',
  '©': '©', '®': '®', '™': '™', '℠': '℠',
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴',
  5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
};

// ─── Conversion report ───────────────────────────────────────────────────────

export interface HtmlConversionReport {
  removedTags: Record<string, number>;
  removedStyles: Record<string, number>;
}

function incrementKey(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

// ─── HTML entity decoder ─────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', ndash: '–', mdash: '—', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201C', rdquo: '\u201D', copy: '©', reg: '®', trade: '™',
  hellip: '…', bull: '•', middot: '·', times: '×', divide: '÷',
};

export function decodeEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/&([a-zA-Z]+);/g, (match, name) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? match
    );
}

// ─── Core HTML → plain text pipeline ─────────────────────────────────────────

/**
 * Processes raw HTML from a BR CKEditor field and returns clean plain text.
 *
 * Steps mirror the @wix/html-to-rich-text pipeline:
 *  1. Strip comments
 *  2. Remove display:none elements
 *  3. Expand <br> to newlines
 *  4. Expand <li> with bullet prefix
 *  5. Convert <sup> to Unicode symbols
 *  6. Remove <script> and <style> blocks entirely
 *  7. Unwrap non-whitelisted tags (keep text content)
 *  8. Strip remaining HTML tags
 *  9. Decode HTML entities
 * 10. Normalize whitespace
 *
 * @returns Plain text and a report of what was stripped.
 */
export function htmlToText(html: string): { text: string; report: HtmlConversionReport } {
  const report: HtmlConversionReport = { removedTags: {}, removedStyles: {} };

  let result = html;

  // 1. Strip HTML comments
  result = result.replace(/<!--[\s\S]*?-->/g, '');

  // 2. Remove display:none elements (including their content)
  result = result.replace(/<[^>]+style="[^"]*display\s*:\s*none[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '');
  result = result.replace(/<[^>]+style='[^']*display\s*:\s*none[^']*'[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  // 3. Remove <script> and <style> blocks (content + tag)
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, () => {
    incrementKey(report.removedTags, 'script');
    return '';
  });
  result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, () => {
    incrementKey(report.removedTags, 'style');
    return '';
  });

  // 4. Convert <sup> to Unicode symbols
  result = result.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, (_, inner) => {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    // Try full text match first, then digit-by-digit
    if (SUPERSCRIPT_MAP[text]) return SUPERSCRIPT_MAP[text];
    if (/^\d+$/.test(text)) {
      return text.split('').map((d: string) => SUPERSCRIPT_MAP[d] ?? d).join('');
    }
    return text; // Unknown superscript — keep as-is
  });

  // 5. Expand <br> to newlines
  result = result.replace(/<br\s*\/?>/gi, '\n');

  // 6. Expand <li> with a bullet so list structure is preserved in plain text
  result = result.replace(/<li[^>]*>/gi, '\n• ');
  result = result.replace(/<\/li>/gi, '');

  // 7. Add spacing after block-level tags so words don't merge
  result = result.replace(/<\/(p|h[1-6]|td|th|div|tr)>/gi, ' ');

  // 8. Strip all remaining HTML tags
  result = result.replace(/<[^>]+>/g, '');

  // 9. Decode HTML entities
  result = decodeEntities(result);

  // 10. Normalize whitespace — collapse runs, trim
  result = result
    .replace(/[ \t]+/g, ' ')       // collapse horizontal space
    .replace(/\n{3,}/g, '\n\n')    // max 2 consecutive newlines
    .replace(/^\s+|\s+$/gm, '')    // trim each line
    .trim();

  return { text: result, report };
}

/**
 * Extract normalized word tokens from a text string.
 * Lowercased, punctuation stripped, stop-words excluded.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'not',
  'no', 'it', 'its', 'this', 'that', 'these', 'those', 'we', 'our',
  'you', 'your', 'they', 'their', 'he', 'she', 'his', 'her', 'my',
]);

export function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}
