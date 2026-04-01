/**
 * Content Mismatch Detector — Part 3 of the QA report.
 *
 * Extracts identity markers from both the original and migrated homepages
 * (company name, phone numbers, email addresses, physical addresses, person names)
 * and flags any mismatches that indicate data was mixed between sites during migration.
 *
 * Designed to catch the "Mile High Investments showing Neil H. Resnik's info" class of bugs.
 */

import type { Page } from 'playwright';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SiteIdentity {
  pageTitle: string;
  companyNames: string[];
  phoneNumbers: string[];
  emailAddresses: string[];
  physicalAddresses: string[];
  personNames: string[];
  footerText: string;
}

export interface ContentMismatch {
  field: 'company-name' | 'phone' | 'email' | 'address' | 'person-name' | 'footer';
  originalValue: string;
  migratedValue: string;
  severity: 'critical' | 'warning';
  note: string;
}

export interface ContentCheckResult {
  originalIdentity: SiteIdentity | null;
  migratedIdentity: SiteIdentity | null;
  mismatches: ContentMismatch[];
  error?: string;
}

// ─── Extraction logic ─────────────────────────────────────────────────────────

const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// US-style addresses: number + street + city/state/zip patterns
const ADDRESS_RE = /\d{1,5}\s+(?:[A-Z][a-z]+\s*){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Suite|Ste|Floor|Fl)[.,]?\s*(?:#?\d+[.,]?\s*)?(?:[A-Z][a-z]+[.,]?\s*){1,3}(?:[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/g;

/**
 * Extract identity markers from a page that is already navigated and loaded.
 * Does NOT navigate — the caller must have the page at the desired URL.
 */
export async function extractIdentity(page: Page): Promise<SiteIdentity> {
  return page.evaluate(() => {
    const doc = document;

    // Page title
    const pageTitle = doc.title?.trim() ?? '';

    // Company names: primarily from page title and og:site_name
    // Avoid H1/H2 as they often contain page navigation titles like "Resources", "Contact Us"
    const companyNames = new Set<string>();
    const ogSiteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim();
    if (ogSiteName) companyNames.add(ogSiteName);

    // First H1 only (likely the main company name), skip generic/short ones
    const firstH1 = doc.querySelector('h1');
    if (firstH1) {
      const t = firstH1.textContent?.trim();
      if (t && t.length > 5 && t.length < 80 && t.split(' ').length >= 2) companyNames.add(t);
    }

    // Page title (split on common separators), skip bare URLs and template artifacts
    const urlLike = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}$/i;
    const templateLike = /^template\d/i;
    const titleParts = (doc.title || '').split(/\s*[|–—]\s*/);
    for (const part of titleParts) {
      const t = part.trim();
      if (t && t.length > 5 && t.length < 80 && t.split(' ').length >= 2
          && !urlLike.test(t) && !templateLike.test(t)) {
        companyNames.add(t);
      }
    }

    // Also filter out URL-like and template names from og:site_name / h1
    for (const name of [...companyNames]) {
      if (urlLike.test(name) || templateLike.test(name) || /^<[a-z]/.test(name)) {
        companyNames.delete(name);
      }
    }

    // Footer text: usually contains company name, address, phone, disclaimers
    const footerEls = doc.querySelectorAll('footer, [role="contentinfo"], #footer, .footer');
    let footerText = '';
    for (const el of footerEls) {
      const t = el.textContent?.replace(/\s+/g, ' ')?.trim() ?? '';
      if (t.length > footerText.length) footerText = t;
    }
    // Fallback: last section of the page often contains contact info
    if (!footerText) {
      const sections = doc.querySelectorAll('section');
      const lastSection = sections[sections.length - 1];
      if (lastSection) {
        footerText = lastSection.textContent?.replace(/\s+/g, ' ')?.trim()?.substring(0, 500) ?? '';
      }
    }

    // Collect all visible text for regex extraction
    const bodyText = doc.body?.innerText ?? '';

    return {
      pageTitle,
      companyNames: [...companyNames],
      footerText: footerText.substring(0, 1000),
      _bodyText: bodyText.substring(0, 20000),
    };
  }).then((raw) => {
    // Run regex extraction in Node (not in browser evaluate) for cleaner code
    const bodyText = raw._bodyText;

    const phoneNumbers = [...new Set((bodyText.match(PHONE_RE) ?? []).map(normalizePhone))];
    const emailAddresses = [...new Set((bodyText.match(EMAIL_RE) ?? []).filter(isRealEmail))];
    const physicalAddresses = [...new Set(bodyText.match(ADDRESS_RE) ?? [])];

    // Person names: look for common patterns like "John D. Smith, CFP®"
    const personNames = extractPersonNames(bodyText);

    return {
      pageTitle: raw.pageTitle,
      companyNames: raw.companyNames,
      phoneNumbers,
      emailAddresses,
      physicalAddresses,
      personNames,
      footerText: raw.footerText,
    };
  });
}

// ─── Comparison logic ─────────────────────────────────────────────────────────

// Known Broadridge template/default phone numbers — appear on migrated sites
// but don't belong to the actual company. Flagged as a specific template artifact.
const KNOWN_TEMPLATE_PHONES = new Set(['9723800097']);

export function compareIdentities(
  original: SiteIdentity,
  migrated: SiteIdentity,
  originalDomain: string,
): ContentMismatch[] {
  const mismatches: ContentMismatch[] = [];

  // Phone number comparison — critical if migrated has phones not present on original
  const origPhones = new Set(original.phoneNumbers.map(normalizePhone));
  const migrPhones = new Set(migrated.phoneNumbers.map(normalizePhone));
  for (const mp of migrPhones) {
    if (!mp) continue;
    const isTemplate = KNOWN_TEMPLATE_PHONES.has(mp);
    if (isTemplate) {
      mismatches.push({
        field: 'phone',
        originalValue: [...origPhones].map(denormalizePhone).join(', ') || '(none found)',
        migratedValue: denormalizePhone(mp),
        severity: 'critical',
        note: `Template phone "${denormalizePhone(mp)}" found on migrated site — not the company's real number`,
      });
    } else if (origPhones.size > 0 && !origPhones.has(mp)) {
      mismatches.push({
        field: 'phone',
        originalValue: [...origPhones].map(denormalizePhone).join(', ') || '(none found)',
        migratedValue: denormalizePhone(mp),
        severity: 'critical',
        note: `Phone "${denormalizePhone(mp)}" on migrated site not found on original`,
      });
    }
  }

  // Email comparison
  const origEmails = new Set(original.emailAddresses.map((e) => e.toLowerCase()));
  const migrEmails = new Set(migrated.emailAddresses.map((e) => e.toLowerCase()));
  for (const me of migrEmails) {
    if (me && origEmails.size > 0 && !origEmails.has(me)) {
      const domainMatch = [...origEmails].some((oe) => oe.split('@')[1] === me.split('@')[1]);
      mismatches.push({
        field: 'email',
        originalValue: [...origEmails].join(', ') || '(none found)',
        migratedValue: me,
        severity: domainMatch ? 'warning' : 'critical',
        note: `Email "${me}" on migrated site not found on original`,
      });
    }
  }

  // Person names — critical if different people appear
  const origNames = new Set(original.personNames.map(normName));
  const migrNames = new Set(migrated.personNames.map(normName));
  for (const mn of migrNames) {
    if (mn && origNames.size > 0 && !origNames.has(mn) && !fuzzyNameMatch(mn, origNames)) {
      mismatches.push({
        field: 'person-name',
        originalValue: [...original.personNames].join(', ') || '(none found)',
        migratedValue: [...migrated.personNames].find((n) => normName(n) === mn) ?? mn,
        severity: 'critical',
        note: `Person "${[...migrated.personNames].find((n) => normName(n) === mn) ?? mn}" appears on migrated site but not on original`,
      });
    }
  }

  // Company name comparison (use page title + h1 + og:site_name)
  const origCompanyNorms = new Set(original.companyNames.map(normCompany));
  const migrCompanyNorms = new Set(migrated.companyNames.map(normCompany));
  // Only flag if migrated has company names that share NO words with original
  for (const mc of migrCompanyNorms) {
    if (mc && origCompanyNorms.size > 0 && !origCompanyNorms.has(mc) && !fuzzyCompanyMatch(mc, origCompanyNorms)) {
      const origDisplay = original.companyNames.join(' / ') || '(none found)';
      const migrDisplay = migrated.companyNames.find((c) => normCompany(c) === mc) ?? mc;
      mismatches.push({
        field: 'company-name',
        originalValue: origDisplay,
        migratedValue: migrDisplay,
        severity: 'warning',
        note: `Company name "${migrDisplay}" on migrated site may not match original`,
      });
    }
  }

  // Address comparison
  if (original.physicalAddresses.length > 0 && migrated.physicalAddresses.length > 0) {
    const origAddrNorms = new Set(original.physicalAddresses.map(normAddress));
    for (const ma of migrated.physicalAddresses) {
      const maNorm = normAddress(ma);
      if (!origAddrNorms.has(maNorm)) {
        mismatches.push({
          field: 'address',
          originalValue: original.physicalAddresses[0],
          migratedValue: ma,
          severity: 'critical',
          note: 'Physical address on migrated site differs from original',
        });
      }
    }
  }

  return mismatches;
}

/**
 * Check a migrated site's identity for known template artifacts, even without
 * the original site for comparison (BUG 8 fix). This catches the template phone
 * on sites where the original crawl failed entirely.
 */
export function checkForKnownTemplateArtifacts(migrated: SiteIdentity): ContentMismatch[] {
  const mismatches: ContentMismatch[] = [];
  for (const phone of migrated.phoneNumbers) {
    const digits = normalizePhone(phone);
    if (KNOWN_TEMPLATE_PHONES.has(digits)) {
      mismatches.push({
        field: 'phone',
        originalValue: '(original not available)',
        migratedValue: denormalizePhone(digits),
        severity: 'critical',
        note: `Template phone "${denormalizePhone(digits)}" found on migrated site — not the company's real number`,
      });
    }
  }
  return mismatches;
}

// ─── Helper functions ─────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

function denormalizePhone(digits: string): string {
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

function isRealEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return !lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.gif')
    && !lower.includes('example.com') && !lower.includes('sentry');
}

function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normCompany(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\b(llc|inc|corp|ltd|lp|financial|group|advisory|advisors?|wealth|management|partners?|services?|consulting)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normAddress(addr: string): string {
  return addr.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function fuzzyNameMatch(name: string, nameSet: Set<string>): boolean {
  const parts = name.split(' ').filter((p) => p.length > 2);
  return [...nameSet].some((existing) => {
    const existingParts = existing.split(' ').filter((p) => p.length > 2);
    const overlap = parts.filter((p) => existingParts.includes(p));
    return overlap.length >= 2;
  });
}

function fuzzyCompanyMatch(name: string, companySet: Set<string>): boolean {
  const words = name.split(' ').filter((w) => w.length > 2);
  return [...companySet].some((existing) => {
    const existingWords = existing.split(' ').filter((w) => w.length > 2);
    if (existingWords.length === 0 || words.length === 0) return false;
    const overlap = words.filter((w) => existingWords.includes(w));
    return overlap.length >= Math.min(2, Math.min(words.length, existingWords.length));
  });
}

// Person name extraction using common patterns for financial advisors
const CREDENTIAL_SUFFIXES = /,?\s*(?:CFP|CFA|CPA|ChFC|CLU|RICP|AIF|AAMS|CRPC|JD|MBA|PhD|MD|Esq|LUTCF|WMCP|CEPA|CIMA|CPWA|RIA|CDFA|EA|MSF|BFA|Series \d+)®?/gi;

function extractPersonNames(text: string): string[] {
  const names = new Set<string>();

  // Look for names near credential suffixes (strong signal for financial advisor sites)
  const withCreds = text.match(
    /\b[A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:\s+[A-Z][a-z]+){1,2},?\s*(?:CFP|CFA|CPA|ChFC|CLU|RICP|AIF|AAMS|CRPC|JD|MBA|PhD|Esq|LUTCF|WMCP|CEPA|CIMA|CPWA|RIA|CDFA|EA)®?/g
  ) ?? [];
  for (const match of withCreds) {
    const name = match.replace(CREDENTIAL_SUFFIXES, '').trim();
    if (name.split(' ').length >= 2) names.add(name);
  }

  // Look for "President", "Founder", "CEO" preceded or followed by a name
  const titlePatterns = [
    /\b([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:\s+[A-Z][a-z]+){1,2})\s*[-–—,]\s*(?:President|Founder|CEO|Managing Director|Partner|Principal|Owner|Chief)/g,
    /(?:President|Founder|CEO|Managing Director|Partner|Principal|Owner|Chief)\s*[-–—,]\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:\s+[A-Z][a-z]+){1,2})/g,
  ];
  for (const re of titlePatterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1].trim();
      if (name.split(' ').length >= 2) names.add(name);
    }
  }

  return [...names];
}
