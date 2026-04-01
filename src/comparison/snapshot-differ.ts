import type {
  SiteSnapshot,
  SnapshotDiff,
  DiffItem,
  DiffSummary,
  PageDiff,
  PageSnapshot,
} from '../types/index.js';
import { THRESHOLDS } from '../config.js';

export function compareSnapshots(
  original: SiteSnapshot,
  migrated: SiteSnapshot,
  mode: 'before-after' | 'cross-site' = 'before-after'
): SnapshotDiff {
  const items: DiffItem[] = [];
  const pageDiffs: PageDiff[] = [];

  // Menu is a global site-wide element — identical on every page.
  // Compare it only once on the home page (first page whose url is '/' or '',
  // falling back to the very first page) to avoid N duplicate menu bug reports.
  // Skip menu comparison entirely when the original is an API-only snapshot — we have
  // no live nav data so any comparison would produce false positives.
  const isApiOnlyOriginal = original.scanLabel?.includes('api-only') ?? false;
  const homePageUrl = migrated.pages.find((p) => p.url === '/' || p.url === '')?.url
    ?? migrated.pages[0]?.url;

  for (const migratedPage of migrated.pages) {
    const originalPage = findMatchingPage(original.pages, migratedPage, mode);
    const pageItems: DiffItem[] = [];
    const isMenuPage = migratedPage.url === homePageUrl;

    pageItems.push(...compareLinks(migratedPage, originalPage));
    pageItems.push(...compareSections(migratedPage, originalPage));
    if (isMenuPage && !isApiOnlyOriginal) pageItems.push(...compareMenu(migratedPage, originalPage));
    pageItems.push(...compareForms(migratedPage, originalPage));
    pageItems.push(...compareImages(migratedPage, originalPage));
    pageItems.push(...compareImageAspectRatios(migratedPage, originalPage));
    pageItems.push(...compareSliderControls(migratedPage, originalPage));
    pageItems.push(...compareMapEmbeds(migratedPage, originalPage));
    pageItems.push(...compareContactInfo(migratedPage, originalPage));
    pageItems.push(...comparePrintButton(migratedPage, originalPage));
    pageItems.push(...compareBackToTop(migratedPage, originalPage));
    pageItems.push(...checkMalformedUrls(migratedPage));
    pageItems.push(...checkPlaceholderTexts(migratedPage));
    pageItems.push(...checkInvalidCTAs(migratedPage));
    pageItems.push(...checkInvalidContactLinks(migratedPage));
    pageItems.push(...checkWixTemplateSocialLinks(migratedPage));

    // Assign smart verdict to every item for this page
    for (const item of pageItems) {
      item.verdict = classifyVerdict(item);
    }

    items.push(...pageItems);
    pageDiffs.push({
      url: migratedPage.url,
      originalUrl: originalPage?.url,
      migratedUrl: migratedPage.url,
      items: pageItems,
    });
  }

  const consolidated = consolidateSiteWideItems(items, migrated.pages.length);
  const summary = computeSummary(consolidated);

  return {
    originalDomain: original.domain,
    migratedDomain: migrated.domain,
    originalTimestamp: original.capturedAt,
    migratedTimestamp: migrated.capturedAt,
    mode,
    summary,
    items: consolidated,
    pages: pageDiffs,
  };
}

// ═══════════════════════════════════════
//  Site-wide consolidation
// ═══════════════════════════════════════

/**
 * When the exact same issue (checkId + description) appears on 3 or more pages,
 * collapse them into a single "site-wide" DiffItem that lists all affected pages.
 * This prevents the diff table from being flooded by e.g. 10 identical
 * "Menu is non-functional" rows — one per page.
 *
 * Threshold: max(3, floor(totalPages / 2)) — at least 3 pages, or half the site.
 */
function consolidateSiteWideItems(items: DiffItem[], totalPages: number): DiffItem[] {
  const THRESHOLD = Math.max(3, Math.floor(totalPages / 2));

  // Only consolidate check IDs that are truly page-independent (same element appears on every page)
  // Section/image/form checks are page-specific — never consolidate those.
  const CONSOLIDATABLE = new Set([
    'cta-non-functional',
    'contact-tel-invalid',
    'contact-mailto-invalid',
    'content-placeholder-text',
    'link-malformed-url',
    'link-href-changed',
    'link-new',
    'link-broken',
    'slider-controls-missing',
    'section-font-family',
    'page-js-error',
  ]);

  // Group consolidatable items by checkId + description
  const groups = new Map<string, DiffItem[]>();
  const passThrough: DiffItem[] = [];

  for (const item of items) {
    if (!CONSOLIDATABLE.has(item.checkId)) {
      passThrough.push(item);
      continue;
    }
    const key = `${item.checkId}::${item.description}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const result: DiffItem[] = [...passThrough];

  for (const group of groups.values()) {
    if (group.length < THRESHOLD) {
      result.push(...group);
    } else {
      // Consolidate: keep the first item's data, mark as site-wide
      const base = group[0];
      result.push({
        ...base,
        page: 'site-wide',
        affectedPages: group.map((i) => i.page),
      });
    }
  }

  return result;
}

function findMatchingPage(
  originalPages: PageSnapshot[],
  migratedPage: PageSnapshot,
  mode: 'before-after' | 'cross-site'
): PageSnapshot | undefined {
  if (mode === 'before-after') {
    return originalPages.find((p) => normalizePath(p.url) === normalizePath(migratedPage.url));
  }

  // Cross-site: match by page path or title since domains differ
  return (
    originalPages.find((p) => normalizePath(p.url) === normalizePath(migratedPage.url)) ??
    originalPages.find((p) => p.title.toLowerCase() === migratedPage.title.toLowerCase()) ??
    originalPages.find((p) => p.pageId === migratedPage.pageId)
  );
}

/**
 * Extracts the generic CSS font family keyword from a font stack.
 * e.g. "Georgia, 'Times New Roman', serif" → "serif"
 * Returns undefined if no known generic is found.
 */
function extractGenericFamily(fontStack: string): string | undefined {
  const generics = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
  const lower = fontStack.toLowerCase();
  return generics.find((g) => {
    // Must be a whole token — avoid "sans-serif" matching inside "some-serif"
    const idx = lower.indexOf(g);
    if (idx === -1) return false;
    const before = idx === 0 ? ',' : lower[idx - 1];
    const after = idx + g.length >= lower.length ? ',' : lower[idx + g.length];
    return /[,\s]/.test(before) && /[,\s]/.test(after);
  });
}

/**
 * Extracts the primary (first) font name from a CSS font stack.
 * e.g. "Georgia, 'Times New Roman', serif" → "Georgia"
 */
function extractPrimaryFont(fontStack: string): string {
  const first = fontStack.split(',')[0].trim().replace(/['"]/g, '');
  return first;
}

function normalizePath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '') || '/';
  } catch {
    return url.replace(/\/$/, '') || '/';
  }
}

/**
 * Returns true when two URLs differ only in their hostname — the path,
 * query-string and hash are identical. This is the normal outcome of a Wix
 * migration: every internal link goes from `www.originalsite.com/path` to
 * `site-12345.brprodaccount.com/path` (or a similar Wix staging domain).
 * Those swaps are EXPECTED and must NOT be flagged as regressions.
 *
 * Normalises trailing slashes so `/our-firm` and `/our-firm/` are treated
 * as the same path.
 */
function isDomainOnlyChange(href1: string, href2: string): boolean {
  try {
    const u1 = new URL(href1);
    const u2 = new URL(href2);
    const p1 = u1.pathname.replace(/\/$/, '') || '/';
    const p2 = u2.pathname.replace(/\/$/, '') || '/';
    // Same path + query + hash, different host → domain-only swap
    return (
      u1.hostname !== u2.hostname &&
      p1 === p2 &&
      u1.search === u2.search &&
      u1.hash === u2.hash
    );
  } catch {
    return false;
  }
}

/**
 * Returns true when the href uses a legacy server-side file extension
 * (.htm, .html, .asp, .aspx, .cfm, .php, .shtml).
 *
 * Original BR sites use file-based routing (e.g. `/Our-Firm.1.htm`).
 * Wix migrations replace these with clean URL slugs (e.g. `/our-firm1`).
 * The path therefore changes on EVERY internal link — but this is 100%
 * expected during a BR→Wix migration and must NOT be counted as a bug.
 * Redirect setup should be verified separately in the Wix URL Redirect Manager.
 */
function isLegacyExtensionUrl(href: string): boolean {
  try {
    const { pathname } = new URL(href);
    // Server-side scripts → clean slug (BR→Wix URL cleanup)
    if (/\.(htm|html|asp|aspx|cfm|php|shtml)(\/|$|\?|#)/i.test(pathname)) return true;
    // Media files get re-hosted to Wix CDN (usrfiles.com / wixstatic.com)
    // so the URL completely changes — expected migration artifact
    if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|mp4|mp3|zip)(\/|$|\?|#)/i.test(pathname)) return true;
    return false;
  } catch {
    return /\.(htm|html|asp|aspx|cfm|php|shtml|pdf|doc|docx|xls|xlsx)(\/|$|\?|#)/i.test(href);
  }
}

// ═══════════════════════════════════════
//  Verdict classification
// ═══════════════════════════════════════

/**
 * Classify a diff item as a genuine bug, an expected migration artifact, or info-only.
 *
 * 'bug'      — action required: contact data wrong, menu missing, link path changed (redirect risk), etc.
 * 'expected' — known migration artifact: domain swap, Wix template links, HTML structure change
 * 'info'     — informational / editorial: content edits, new template sections, minor styling
 *
 * Key URL concept: a "URL path change" (e.g. /team-bios → /our-team) is a **bug** because
 * the old URL will 404 unless a 301 redirect is set up in the Wix URL Redirect Manager.
 * A "domain-only change" (path unchanged, only hostname differs) is **expected** — that's
 * the entire point of migration.
 */
function classifyVerdict(item: Pick<DiffItem, 'checkId' | 'changeType' | 'severity' | 'description'>): 'bug' | 'expected' | 'info' {
  // Already tagged as expected by the differ (domain swaps, structural HTML mismatch)
  if (item.changeType === 'expected-change') return 'expected';

  // Matched items are fine
  if (item.changeType === 'match') return 'info';

  // New items added to migrated site
  if (item.changeType === 'new-in-migrated') {
    // Wix injects template/legal/platform links — these are expected boilerplate
    if (item.checkId === 'link-new' || item.checkId === 'menu-item-new') {
      const desc = item.description.toLowerCase();
      if (
        desc.includes('privacy') ||
        desc.includes('terms') ||
        desc.includes('accessibility') ||
        desc.includes('cookie') ||
        desc.includes('wix') ||
        desc.includes('blog') ||
        desc.includes('sitemap') ||
        desc.includes('legal')
      ) return 'expected';
    }
    // Other new content (sections, forms, images) is informational — not a regression
    return 'info';
  }

  // Text/content edits are editorial work done during migration — expected
  if (item.changeType === 'content-changed') return 'info';

  // ── Real bugs ──────────────────────────────────────────────────────────────

  // Contact info mismatches are always bugs (wrong phone/email/address = data error)
  if (['contact-phone', 'contact-email', 'contact-address'].includes(item.checkId)) return 'bug';

  // Missing print button — deliberate feature on article/newsletter pages, always a bug
  if (item.checkId === 'cta-print-missing') return 'bug';

  // Missing back-to-top — UX regression, minor bug
  if (item.checkId === 'cta-back-to-top-missing') return 'bug';

  // Malformed URL with unencoded `?` — causes 404, always a bug
  if (item.checkId === 'link-malformed-url') return 'bug';

  // Placeholder text — template never filled in, always critical
  if (item.checkId === 'content-placeholder-text') return 'bug';

  // Non-functional CTA — button does nothing when clicked
  if (item.checkId === 'cta-non-functional') return 'bug';

  // Broken tel:/mailto: links — contact info doesn't work
  if (item.checkId === 'contact-tel-invalid' || item.checkId === 'contact-mailto-invalid') return 'bug';

  // Wix template placeholder social accounts left on migrated site — always a bug
  if (item.checkId === 'wix-template-social-link') return 'bug';

  // Broken link on migrated site (HTTP 4xx/5xx) — always a bug
  if (item.checkId === 'link-broken') return 'bug';

  // Font family mismatch — serif↔sans-serif swap is a visible regression
  if (item.checkId === 'section-font-family') return 'bug';

  // Image cropped differently — aspect ratio changed by >10%
  if (item.checkId === 'image-aspect-ratio') return 'bug';

  // Slider prev/next or pause/play controls missing on migrated
  if (item.checkId === 'slider-controls-missing') return 'bug';

  // Google Maps zoom level changed (too zoomed out = no office pin)
  // If the map is "missing" entirely, that's an expected implementation swap:
  // BR uses a raw Google Maps iframe; Wix replaces it with its own Maps widget.
  // Only flag a genuine zoom drift when both sides have parseable iframes.
  if (item.checkId === 'map-zoom-changed') {
    return item.changeType === 'missing-in-migrated' ? 'expected' : 'bug';
  }

  // Navigation regressions — but check for deprecated BR items first
  if (item.checkId === 'menu-item-missing' || item.checkId === 'menu-subitem-missing') {
    const desc = item.description.toLowerCase();
    // Deprecated BR features that are intentionally removed on Wix:
    if (desc.includes('flipbook'))                      return 'expected';
    if (desc.includes('request a quote'))               return 'expected';
    if (desc.includes('blog'))                          return 'expected';
    if (desc.includes('events'))                        return 'expected';
    if (desc.includes('tell a friend'))                 return 'expected';
    if (desc.includes('p&c') || desc.includes('p & c')) return 'expected';
    if (desc.includes('sitemap'))                       return 'expected';
    return 'bug';
  }

  // menu-count / menu-subitems are derived metrics — the individual missing
  // items are already reported above. A count-only diff just adds noise.
  if (item.checkId === 'menu-count' || item.checkId === 'menu-subitems') return 'info';

  // URL path changed (slug/structure changed, not just domain swap).
  // In a BR→Wix migration, URL restructuring is the norm — the content still
  // exists, the path just changed. Flag as 'info' so the team can set up 301
  // redirects in the Wix URL Redirect Manager without cluttering the bug count.
  if (item.checkId === 'link-href-changed') return 'info';

  // Link gone entirely from migrated site — also a 404 risk / navigation gap
  // EXCEPT: some links are expected to disappear on Wix-migrated sites.
  if (item.checkId === 'link-missing') {
    const desc = item.description.toLowerCase();

    // ── Wix platform replacements ──────────────────────────────────────────
    // Wix auto-generates its own sitemap — the old sitemap.htm link goes away
    if (desc.includes('sitemap')) return 'expected';
    // Wix injects its own "Skip to main content" accessibility widget
    if (desc.includes('skip to main') || desc.includes('skip to content')) return 'expected';
    // CDN/infrastructure error-page links (Cloudflare, etc.) injected during
    // scanning when the server is rate-limiting — not real site content
    if (desc.includes('cloudflare') || desc.includes('5xx-error') || desc.includes('cdn-cgi')) return 'expected';

    // ── Deprecated BR content (per QA checklist row 1, 29-31) ───────────────
    // These items should NOT appear on migrated Wix sites:
    //   • Flipbooks         — deprecated BR resource type
    //   • Blog / Events     — not migrated to Wix
    //   • Tell A Friend     — third-party BR tool, unavailable on Wix
    //   • P&C forms         — deprecated BR form type
    //   • Request a Quote   — replaced by Wix contact forms
    if (desc.includes('flipbook')) return 'expected';
    if (desc.includes('"blog"') || desc.includes("'blog'") || /link missing: "blog"/.test(desc)) return 'expected';
    if (desc.includes('"events"') || desc.includes("'events'")) return 'expected';
    if (desc.includes('tell a friend') || desc.includes('tellafriend')) return 'expected';
    if (desc.includes('p&c') || desc.includes('p & c')) return 'expected';
    if (/link missing: "request a quote"/.test(desc)) return 'expected';

    // ── URL restructuring patterns ────────────────────────────────────────────
    // "More X »" links are BR "view all" widget buttons — always restructured
    // to different URLs on Wix (but the destination page still exists).
    if (item.description.includes('»') || /link missing: "more /i.test(item.description)) return 'info';

    // Extract the href from the description to inspect its path structure.
    // Format: Link missing: "Text" → https://domain.com/path
    const hrefMatch = item.description.match(/→\s*(https?:\/\/\S+)$/);
    if (hrefMatch) {
      try {
        const u = new URL(hrefMatch[1]);
        const segments = u.pathname.split('/').filter(Boolean);
        // Social/platform links (LinkedIn, Facebook, etc.) are always bugs regardless
        // of path depth — a missing social profile link is a real regression.
        if (isKnownSocialDomain(hrefMatch[1])) return 'bug';
        // Multi-segment paths (e.g. /learning_center/calculators/ira_eligibility)
        // are typically flattened in Wix migrations (/calculator/ira-eligibility).
        // The content still exists — just under a different URL.
        if (segments.length >= 2) return 'info';
        // Media files re-hosted to Wix CDN (URL completely changes)
        if (isLegacyExtensionUrl(hrefMatch[1])) return 'info';
      } catch { /* ignore malformed urls */ }
    }

    return 'bug';
  }

  // Section missing — structural mismatch is already caught as 'expected-change',
  // section-missing can be template restructuring or a real regression — surface as Info/Watch
  // for the user to review rather than auto-classifying as a bug
  if (item.checkId === 'section-missing') return 'info';

  // Image lost its link
  if (item.checkId === 'image-link-lost') return 'bug';

  // Contact form missing — NOTE: Wix migrated sites often replace the old BR
  // contact form with Wix's own contact system, so 'form-missing' is NOT a bug.
  // We intentionally do NOT classify form-missing as a bug here.

  // ── Severity-based fallback ────────────────────────────────────────────────
  // Critical items not covered above are still bugs
  if (item.severity === 'critical') return 'bug';
  // Major items default to bug (catches any new check IDs we add later)
  if (item.severity === 'major') return 'bug';

  // Minor / info = informational only
  return 'info';
}

// ═══════════════════════════════════════
//  Link comparison
// ═══════════════════════════════════════

/** Normalise link text for comparison: trim, collapse whitespace, lowercase. */
function normText(t: string): string {
  return t.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Normalise a tel: href to digits only for comparison.
 * "tel:574-271-3400", "tel:574.271.3400", "tel:5742713400" → "5742713400"
 * Returns null for non-tel hrefs.
 */
function normalizeTelHref(href: string): string | null {
  if (!href.startsWith('tel:')) return null;
  return href.replace('tel:', '').replace(/\D/g, '');
}

/** Known social/platform domains where a missing link is always a bug regardless of path depth. */
const SOCIAL_DOMAINS = [
  'facebook.com', 'twitter.com', 'x.com', 'linkedin.com',
  'instagram.com', 'youtube.com', 'tiktok.com', 'pinterest.com',
];

function isKnownSocialDomain(href: string): boolean {
  try {
    const hostname = new URL(href).hostname;
    return SOCIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

/**
 * Returns true when the href is a pure anchor / dropdown-trigger that carries
 * no real navigation intent (e.g. href="#", href="javascript:void(0)").
 * These exist on the original BR site as dropdown openers and must NOT be
 * flagged as missing when the Wix site turns them into real page links.
 */
function isPlaceholderHref(href: string): boolean {
  try {
    const u = new URL(href);
    // href="#" or href="#something" with no path  → placeholder
    if (!u.pathname || u.pathname === '/') {
      if (u.hash && !u.search) return true;
    }
  } catch {
    // relative: "#", "#foo", "javascript:..."
    if (href.startsWith('#') || href.startsWith('javascript:')) return true;
  }
  return false;
}

function compareLinks(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  // Build a set of menu item texts from the migrated site so we can skip
  // link-missing false positives for nav items that Wix renders as JS widgets
  // (not plain <a> elements) — compareMenu() is the authoritative nav check.
  const migratedMenuTexts = new Set<string>();
  for (const m of migrated.menu.items) {
    migratedMenuTexts.add(normText(m.text));
    for (const s of m.subItems) migratedMenuTexts.add(normText(s.text));
  }

  // Deduplicate links by (href, normalised text) to prevent the hover-sweep
  // from creating double entries when the same link is revealed twice
  // (once in the normal DOM, once after triggering hover states).
  const dedupeKey = (l: { href: string; text: string }) => `${l.href}|||${normText(l.text)}`;
  const seenM = new Set<string>();
  const dedupedMigrated = migrated.links.filter((l) => {
    const k = dedupeKey(l); if (seenM.has(k)) return false; seenM.add(k); return true;
  });
  const seenO = new Set<string>();
  const dedupedOriginal = original.links.filter((l) => {
    const k = dedupeKey(l); if (seenO.has(k)) return false; seenO.add(k); return true;
  });

  // Track which original links have already been compared so the same original
  // link isn't reported multiple times if it matches several migrated links
  // (e.g. "View Videos" appears in nav, footer, and a CTA on the migrated page).
  const reportedOLinkKeys = new Set<string>();

  for (const mLink of dedupedMigrated) {
    const oLink =
      dedupedOriginal.find(
        (l) => normText(l.text) === normText(mLink.text) && l.location === mLink.location,
      ) ?? dedupedOriginal.find((l) => normText(l.text) === normText(mLink.text))
        ?? dedupedOriginal.find((l) => l.href === mLink.href);

    if (!oLink) {
      items.push({
        page: migrated.url,
        section: mLink.location,
        checkId: 'link-new',
        description: `New link: "${mLink.text}" → ${mLink.href}`,
        severity: 'info',
        original: null,
        migrated: mLink,
        changeType: 'new-in-migrated',
      });
      continue;
    }

    // One report per original link — skip if we already reported this oLink
    const oKey = `${oLink.href}|||${normText(oLink.text)}`;
    if (reportedOLinkKeys.has(oKey)) continue;
    reportedOLinkKeys.add(oKey);

    if (oLink.href !== mLink.href) {
      if (isDomainOnlyChange(oLink.href, mLink.href)) {
        // Domain swapped but path is identical — expected during Wix migration.
        items.push({
          page: migrated.url,
          section: mLink.location,
          checkId: 'link-domain-migrated',
          description: `Link "${mLink.text}" domain migrated (path unchanged): ${oLink.href} → ${mLink.href}`,
          severity: 'info',
          original: oLink.href,
          migrated: mLink.href,
          changeType: 'expected-change',
        });
      } else if (isPlaceholderHref(oLink.href)) {
        // Original was a dropdown trigger (#) that became a real page link — expected.
        items.push({
          page: migrated.url,
          section: mLink.location,
          checkId: 'link-placeholder-resolved',
          description: `Link "${mLink.text}" was a placeholder (#) on original, now points to: ${mLink.href}`,
          severity: 'info',
          original: oLink.href,
          migrated: mLink.href,
          changeType: 'expected-change',
        });
      } else if (isLegacyExtensionUrl(oLink.href)) {
        // Original used a legacy file extension (.htm/.asp/.cfm/etc.) and Wix
        // replaced it with a clean URL slug — 100% expected in a BR→Wix migration.
        // The redirect mapping should be verified in the Wix URL Redirect Manager.
        items.push({
          page: migrated.url,
          section: mLink.location,
          checkId: 'link-url-cleaned',
          description: `Link "${mLink.text}" migrated from legacy URL: ${oLink.href} → ${mLink.href}`,
          severity: 'info',
          original: oLink.href,
          migrated: mLink.href,
          changeType: 'expected-change',
        });
      } else {
        // Path actually changed — real regression (redirect risk).
        items.push({
          page: migrated.url,
          section: mLink.location,
          checkId: 'link-href-changed',
          description: `Link "${mLink.text}" destination changed: ${oLink.href} → ${mLink.href}`,
          severity: 'major',
          original: oLink.href,
          migrated: mLink.href,
          changeType: 'mismatch',
        });
      }
    }

    if (oLink.target !== mLink.target) {
      items.push({
        page: migrated.url,
        section: mLink.location,
        checkId: 'link-target-changed',
        description: `Link "${mLink.text}" target changed: ${oLink.target || '_self'} → ${mLink.target || '_self'}`,
        severity: 'minor',
        original: oLink.target,
        migrated: mLink.target,
        changeType: 'mismatch',
      });
    }
  }

  for (const oLink of dedupedOriginal) {
    // Skip placeholder hrefs (#, javascript:) — they were dropdown triggers on
    // the original site. compareMenu() already verifies nav items by text.
    if (isPlaceholderHref(oLink.href)) continue;

    const nt = normText(oLink.text);

    // Skip links whose text matches a migrated menu item — compareMenu() is
    // the authoritative check for nav items. Wix may render them as JS widgets
    // (not plain <a> tags), so they won't appear in migrated.links even though
    // they are visually present in the navigation.
    if (migratedMenuTexts.has(nt)) continue;

    // For tel: links, also match by digit-normalised number so that
    // "tel:574-271-3400" and "tel:5742713400" are treated as the same link.
    const oTelDigits = normalizeTelHref(oLink.href);
    const exists = dedupedMigrated.some(
      (l) =>
        normText(l.text) === nt ||
        l.href === oLink.href ||
        (oTelDigits && oTelDigits.length >= 7 && oTelDigits === normalizeTelHref(l.href)),
    );
    if (!exists) {
      // Legacy extension URLs (.htm/.asp/.cfm/etc.) disappear on Wix because
      // the page was given a clean URL slug — expected migration artifact.
      if (isLegacyExtensionUrl(oLink.href)) {
        items.push({
          page: migrated.url,
          section: oLink.location,
          checkId: 'link-url-cleaned',
          description: `Link URL cleaned up (legacy extension removed): "${oLink.text}" → ${oLink.href}`,
          severity: 'info',
          original: oLink,
          migrated: null,
          changeType: 'expected-change',
        });
        continue;
      }
      items.push({
        page: migrated.url,
        section: oLink.location,
        checkId: 'link-missing',
        description: `Link missing: "${oLink.text}" → ${oLink.href}`,
        severity: 'major',
        original: oLink,
        migrated: null,
        changeType: 'missing-in-migrated',
      });
    }
  }

  // ── Broken links on migrated site ─────────────────────────────────────────
  // HTTP status is populated by validateLinks() during the scan phase.
  // Flag links that are structurally present on the migrated page but return
  // 404/410/5xx — these are genuinely broken, not just missing from comparison.
  const originalHrefs = new Set(dedupedOriginal.map((l) => l.href));
  for (const mLink of dedupedMigrated) {
    if (mLink.httpStatus === null || mLink.httpStatus === 0 || mLink.httpStatus === -1) continue;
    if (mLink.httpStatus < 400) continue;
    // Skip social/anti-bot domains that block HEAD requests — those 403s are expected
    if (isKnownSocialDomain(mLink.href)) continue;
    // Skip links that were ALSO broken on the original site (pre-existing issue)
    const wasAlsoBrokenOnOriginal = dedupedOriginal.some(
      (l) => l.href === mLink.href && l.httpStatus !== null && l.httpStatus >= 400
    );
    if (wasAlsoBrokenOnOriginal) continue;

    const severity = mLink.httpStatus >= 500 ? 'critical' : 'major';
    const label = originalHrefs.has(mLink.href) ? '' : ' (new link)';
    items.push({
      page: migrated.url,
      section: mLink.location,
      checkId: 'link-broken',
      description: `Broken link${label}: "${mLink.text || mLink.href}" → ${mLink.href} [HTTP ${mLink.httpStatus}]`,
      severity,
      original: null,
      migrated: mLink.httpStatus,
      changeType: 'mismatch',
    });
  }

  return items;
}

// ═══════════════════════════════════════
//  Section comparison
// ═══════════════════════════════════════

function compareSections(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  // Detect structural mismatch: when the migrated site shares no section IDs
  // with the original, it almost certainly uses a completely different DOM
  // structure (e.g. Wix vs vanilla BR HTML).
  //
  // Old threshold required ALL migrated sections to be absent (length === 0).
  // Changed to: original has ≥ 2 content sections AND zero of them are found
  // on the migrated site — this covers the common case where Wix provides its
  // own header/footer but none of the BR content sections (cn_container,
  // mediaContainer, videoContainer, etc.) are present.
  const presentOnOriginal = original.sections.filter((s) => s.isPresent);
  const presentOnMigrated = migrated.sections.filter((s) => s.isPresent);
  const matchedCount = presentOnOriginal.filter((o) =>
    migrated.sections.some((m) => m.id === o.id && m.isPresent)
  ).length;
  const isStructuralMismatch =
    presentOnOriginal.length >= 2 &&
    matchedCount === 0;  // not a single original section ID found on migrated

  if (isStructuralMismatch) {
    // Build a readable summary of what the original sections contained
    const sectionSummaries = presentOnOriginal
      .map((s) => {
        const preview = s.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60);
        return `#${s.id}${preview ? ` ("${preview}${preview.length >= 60 ? '…' : ''}")` : ''}`;
      })
      .join(', ');

    items.push({
      page: migrated.url,
      section: 'page',
      checkId: 'section-structure-mismatch',
      description: `Migrated site uses Wix HTML structure — BR section IDs not found: ${sectionSummaries}. Content may still be present visually; verify each section manually.`,
      severity: 'minor',
      original: presentOnOriginal.map((s) => s.id),
      migrated: presentOnMigrated.map((s) => s.id),
      changeType: 'expected-change',
    });
    return items; // skip per-section checks for structurally incompatible pages
  }

  for (const mSection of migrated.sections) {
    const oSection = original.sections.find((s) => s.id === mSection.id);

    if (!oSection) {
      if (mSection.isPresent) {
        items.push({
          page: migrated.url,
          section: mSection.id,
          checkId: 'section-new',
          description: `New section: #${mSection.id}`,
          severity: 'info',
          original: null,
          migrated: mSection,
          changeType: 'new-in-migrated',
        });
      }
      continue;
    }

    if (oSection.isPresent && !mSection.isPresent) {
      const preview = oSection.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80);
      items.push({
        page: migrated.url,
        section: mSection.id,
        checkId: 'section-missing',
        description: `Section #${mSection.id} is missing on migrated site${preview ? ` — original contained: "${preview}${preview.length >= 80 ? '…' : ''}"` : ''}`,
        severity: 'critical',
        original: oSection,
        migrated: mSection,
        changeType: 'missing-in-migrated',
        evidence: oSection.screenshot
          ? { originalScreenshot: oSection.screenshot, migratedScreenshot: undefined }
          : undefined,
      });
      continue;
    }

    if (!mSection.isPresent) continue;

    // Evidence: screenshots of this section from both sites (if available)
    const sectionEvidence = (oSection.screenshot || mSection.screenshot)
      ? { originalScreenshot: oSection.screenshot, migratedScreenshot: mSection.screenshot }
      : undefined;

    // Height comparison
    const hOrig = oSection.boundingBox.height;
    const hMig = mSection.boundingBox.height;
    if (hOrig > 0) {
      const hDiff = Math.abs(hMig - hOrig) / hOrig;
      if (hDiff > THRESHOLDS.sectionHeightTolerance) {
        items.push({
          page: migrated.url,
          section: mSection.id,
          checkId: 'section-height',
          description: `#${mSection.id} height changed ${(hDiff * 100).toFixed(0)}%: ${hOrig}px → ${hMig}px`,
          severity: hDiff > 0.5 ? 'major' : 'minor',
          original: hOrig,
          migrated: hMig,
          changeType: 'mismatch',
          evidence: sectionEvidence,
        });
      }
    }

    // Background color
    if (oSection.backgroundColor !== mSection.backgroundColor) {
      items.push({
        page: migrated.url,
        section: mSection.id,
        checkId: 'section-bgcolor',
        description: `#${mSection.id} background: ${oSection.backgroundColor} → ${mSection.backgroundColor}`,
        severity: 'minor',
        original: oSection.backgroundColor,
        migrated: mSection.backgroundColor,
        changeType: 'mismatch',
        evidence: sectionEvidence,
      });
    }

    // Text color
    if (oSection.textColor !== mSection.textColor) {
      items.push({
        page: migrated.url,
        section: mSection.id,
        checkId: 'section-textcolor',
        description: `#${mSection.id} text color: ${oSection.textColor} → ${mSection.textColor}`,
        severity: 'minor',
        original: oSection.textColor,
        migrated: mSection.textColor,
        changeType: 'mismatch',
        evidence: sectionEvidence,
      });
    }

    // Font family — compare generic family (serif/sans-serif) and primary font name.
    // A generic family switch (e.g. serif → sans-serif) is a visible regression;
    // same generic but different primary font is a minor style drift.
    if (oSection.fontFamily && mSection.fontFamily && oSection.fontFamily !== mSection.fontFamily) {
      const oGeneric = extractGenericFamily(oSection.fontFamily);
      const mGeneric = extractGenericFamily(mSection.fontFamily);
      const oPrimary = extractPrimaryFont(oSection.fontFamily);
      const mPrimary = extractPrimaryFont(mSection.fontFamily);

      if (oGeneric && mGeneric && oGeneric !== mGeneric) {
        // e.g. serif → sans-serif: clearly visible, always flag
        items.push({
          page: migrated.url,
          section: mSection.id,
          checkId: 'section-font-family',
          description: `#${mSection.id} font family changed: ${oPrimary} (${oGeneric}) → ${mPrimary} (${mGeneric})`,
          severity: 'major',
          original: oSection.fontFamily,
          migrated: mSection.fontFamily,
          changeType: 'mismatch',
          evidence: sectionEvidence,
        });
      } else if (oPrimary && mPrimary && oPrimary !== mPrimary) {
        // Same generic family (both sans-serif) but different primary font — minor style drift
        items.push({
          page: migrated.url,
          section: mSection.id,
          checkId: 'section-font-family',
          description: `#${mSection.id} primary font changed: ${oPrimary} → ${mPrimary} (both ${oGeneric ?? 'unspecified'})`,
          severity: 'minor',
          original: oSection.fontFamily,
          migrated: mSection.fontFamily,
          changeType: 'mismatch',
          evidence: sectionEvidence,
        });
      }
    }

    // Text content — intentional edits are expected during migration,
    // so content changes are informational rather than regressions
    if (oSection.textContent !== mSection.textContent) {
      items.push({
        page: migrated.url,
        section: mSection.id,
        checkId: 'section-content',
        description: `#${mSection.id} text content changed`,
        severity: 'info',
        original: oSection.textContent.substring(0, 200),
        migrated: mSection.textContent.substring(0, 200),
        changeType: 'content-changed',
        evidence: sectionEvidence,
      });
    }
  }

  // Sections present on original but not tracked at all on migrated
  for (const oSection of original.sections) {
    if (!oSection.isPresent) continue;
    const exists = migrated.sections.find((s) => s.id === oSection.id);
    if (!exists) {
      const preview = oSection.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80);
      items.push({
        page: migrated.url,
        section: oSection.id,
        checkId: 'section-missing',
        description: `Section #${oSection.id} not found on migrated site${preview ? ` — original contained: "${preview}${preview.length >= 80 ? '…' : ''}"` : ''}`,
        severity: 'critical',
        original: oSection,
        migrated: null,
        changeType: 'missing-in-migrated',
        evidence: oSection.screenshot
          ? { originalScreenshot: oSection.screenshot, migratedScreenshot: undefined }
          : undefined,
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Menu comparison
// ═══════════════════════════════════════

function compareMenu(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  const oItems = original.menu.items;
  const mItems = migrated.menu.items;

  if (oItems.length !== mItems.length) {
    items.push({
      page: migrated.url,
      section: 'navigationContainer',
      checkId: 'menu-count',
      description: `Menu items: ${oItems.length} → ${mItems.length}`,
      severity: 'critical',
      original: oItems.map((i) => i.text),
      migrated: mItems.map((i) => i.text),
      changeType: 'mismatch',
    });
  }

  for (const oItem of oItems) {
    const mItem = mItems.find((m) => m.text.toLowerCase() === oItem.text.toLowerCase());
    if (!mItem) {
      items.push({
        page: migrated.url,
        section: 'navigationContainer',
        checkId: 'menu-item-missing',
        description: `Menu item "${oItem.text}" missing in migrated`,
        severity: 'major',
        original: oItem,
        migrated: null,
        changeType: 'missing-in-migrated',
      });
      continue;
    }

    if (oItem.subItems.length !== mItem.subItems.length) {
      items.push({
        page: migrated.url,
        section: 'navigationContainer',
        checkId: 'menu-subitems',
        description: `"${oItem.text}" sub-items: ${oItem.subItems.length} → ${mItem.subItems.length}`,
        severity: 'major',
        original: oItem.subItems.map((s) => s.text),
        migrated: mItem.subItems.map((s) => s.text),
        changeType: 'mismatch',
      });
    }

    for (const oSub of oItem.subItems) {
      const mSub = mItem.subItems.find((s) => s.text.toLowerCase() === oSub.text.toLowerCase());
      if (!mSub) {
        items.push({
          page: migrated.url,
          section: 'navigationContainer',
          checkId: 'menu-subitem-missing',
          description: `Sub-item "${oSub.text}" under "${oItem.text}" missing`,
          severity: 'major',
          original: oSub,
          migrated: null,
          changeType: 'missing-in-migrated',
        });
      }
    }
  }

  for (const mItem of mItems) {
    const exists = oItems.find((o) => o.text.toLowerCase() === mItem.text.toLowerCase());
    if (!exists) {
      items.push({
        page: migrated.url,
        section: 'navigationContainer',
        checkId: 'menu-item-new',
        description: `New menu item in migrated: "${mItem.text}"`,
        severity: 'info',
        original: null,
        migrated: mItem,
        changeType: 'new-in-migrated',
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Form comparison
// ═══════════════════════════════════════

function compareForms(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  for (const mForm of migrated.forms) {
    if (!mForm.isVisible) continue;
    const oForm = original.forms.find((f) => f.formType === mForm.formType);

    if (!oForm) {
      items.push({
        page: migrated.url,
        section: mForm.section,
        checkId: 'form-new',
        description: `New form: ${mForm.formType}`,
        severity: mForm.formType === 'contact-us' ? 'info' : 'critical',
        original: null,
        migrated: mForm,
        changeType: 'new-in-migrated',
      });
    }
  }

  for (const oForm of original.forms) {
    if (!oForm.isVisible) continue;
    const exists = migrated.forms.find((f) => f.formType === oForm.formType && f.isVisible);
    if (!exists && oForm.formType === 'contact-us') {
      items.push({
        page: migrated.url,
        section: oForm.section,
        checkId: 'form-missing',
        description: `Contact form missing in migrated site`,
        severity: 'critical',
        original: oForm,
        migrated: null,
        changeType: 'missing-in-migrated',
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Image comparison
// ═══════════════════════════════════════

function compareImages(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  const oLinked = original.images.filter((i) => i.hasLink);
  for (const oImg of oLinked) {
    const mImg = migrated.images.find(
      (i) => i.src === oImg.src || (i.alt && i.alt === oImg.alt)
    );
    if (mImg && !mImg.hasLink) {
      items.push({
        page: migrated.url,
        section: oImg.section,
        checkId: 'image-link-lost',
        description: `Image "${oImg.alt}" lost its link (was: ${oImg.linkHref})`,
        severity: 'major',
        original: oImg.linkHref,
        migrated: null,
        changeType: 'mismatch',
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Image aspect ratio comparison
// ═══════════════════════════════════════

/**
 * Compares natural image aspect ratios between original and migrated.
 * Matches images by alt text (most stable identifier), falling back to
 * the filename portion of the src URL.
 * Flags when the ratio shifts by more than 10% — indicates the image
 * was cropped differently on the new site.
 */
function compareImageAspectRatios(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  const RATIO_TOLERANCE = 0.10; // 10%

  const srcFilename = (src: string) => {
    try { return new URL(src).pathname.split('/').pop() ?? ''; }
    catch { return src.split('/').pop() ?? ''; }
  };

  for (const oImg of original.images) {
    if (!oImg.naturalWidth || !oImg.naturalHeight) continue;
    const oRatio = oImg.naturalWidth / oImg.naturalHeight;

    // Match by alt text first, then by filename
    const mImg = migrated.images.find((m) => {
      if (oImg.alt && m.alt && oImg.alt === m.alt) return true;
      const oFile = srcFilename(oImg.src);
      const mFile = srcFilename(m.src);
      return oFile && oFile === mFile;
    });

    if (!mImg || !mImg.naturalWidth || !mImg.naturalHeight) continue;

    const mRatio = mImg.naturalWidth / mImg.naturalHeight;
    const diff = Math.abs(mRatio - oRatio) / oRatio;

    if (diff > RATIO_TOLERANCE) {
      const oLabel = `${oImg.naturalWidth}×${oImg.naturalHeight} (${oRatio.toFixed(2)})`;
      const mLabel = `${mImg.naturalWidth}×${mImg.naturalHeight} (${mRatio.toFixed(2)})`;
      const name = oImg.alt || srcFilename(oImg.src) || oImg.src.substring(0, 50);
      items.push({
        page: migrated.url,
        section: oImg.section,
        checkId: 'image-aspect-ratio',
        description: `Image "${name}" aspect ratio changed ${(diff * 100).toFixed(0)}%: ${oLabel} → ${mLabel} — image may be cropped differently`,
        severity: diff > 0.25 ? 'major' : 'minor',
        original: oLabel,
        migrated: mLabel,
        changeType: 'mismatch',
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Slider controls comparison
// ═══════════════════════════════════════

/**
 * Checks whether carousels/sliders that had prev/next or pause/play controls
 * on the original site still have them on the migrated site.
 * Matches sliders by section location (header, footer, main, etc.).
 */
function compareSliderControls(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  const oSliders = original.sliderControls ?? [];
  const mSliders = migrated.sliderControls ?? [];

  if (oSliders.length === 0) return items;

  for (const oSlider of oSliders) {
    // Match by section — most sites have at most one slider per section
    const mSlider = mSliders.find((m) => m.section === oSlider.section);

    if (!mSlider) {
      // Slider exists on original but not found at all on migrated
      if (oSlider.hasPrevNext || oSlider.hasPausePlay) {
        items.push({
          page: migrated.url,
          section: oSlider.section,
          checkId: 'slider-controls-missing',
          description: `Slider in "${oSlider.section}" had controls on original (prev/next: ${oSlider.hasPrevNext}, pause/play: ${oSlider.hasPausePlay}) but no slider detected on migrated`,
          severity: 'minor',
          original: oSlider,
          migrated: null,
          changeType: 'missing-in-migrated',
        });
      }
      continue;
    }

    // Slider found on both — check if controls were lost
    if (oSlider.hasPrevNext && !mSlider.hasPrevNext) {
      items.push({
        page: migrated.url,
        section: oSlider.section,
        checkId: 'slider-controls-missing',
        description: `Slider in "${oSlider.section}" is missing prev/next navigation arrows (present on original)`,
        severity: 'major',
        original: true,
        migrated: false,
        changeType: 'mismatch',
      });
    }

    if (oSlider.hasPausePlay && !mSlider.hasPausePlay) {
      items.push({
        page: migrated.url,
        section: oSlider.section,
        checkId: 'slider-controls-missing',
        description: `Slider in "${oSlider.section}" is missing pause/play controls (present on original)`,
        severity: 'major',
        original: true,
        migrated: false,
        changeType: 'mismatch',
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Google Maps zoom comparison
// ═══════════════════════════════════════

/**
 * Compares Google Maps iframe zoom levels between original and migrated.
 * A zoom level that's too low means the map shows a wide-area view instead
 * of the office location pin (as reported in linkfinancialbenefits bug #18).
 * Matches maps by section location.
 */
function compareMapEmbeds(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  const oMaps = original.mapEmbeds ?? [];
  const mMaps = migrated.mapEmbeds ?? [];

  if (oMaps.length === 0) return items;

  for (const oMap of oMaps) {
    const mMap = mMaps.find((m) => m.section === oMap.section) ?? mMaps[0];

    if (!mMap) {
      items.push({
        page: migrated.url,
        section: oMap.section,
        checkId: 'map-zoom-changed',
        description: `Google Map present on original but not found on migrated site`,
        severity: 'major',
        original: oMap.zoom,
        migrated: null,
        changeType: 'missing-in-migrated',
      });
      continue;
    }

    // Both maps found — compare zoom levels
    if (oMap.zoom !== null && mMap.zoom !== null && oMap.zoom !== mMap.zoom) {
      const diff = oMap.zoom - mMap.zoom;
      // Smaller z= = more zoomed out; a drop of 3+ levels is a significant regression
      const severity = Math.abs(diff) >= 3 ? 'major' : 'minor';
      items.push({
        page: migrated.url,
        section: oMap.section,
        checkId: 'map-zoom-changed',
        description: `Google Map zoom changed: z=${oMap.zoom} → z=${mMap.zoom}${diff > 0 ? ' (more zoomed out — may not show office pin)' : ' (more zoomed in)'}`,
        severity,
        original: oMap.zoom,
        migrated: mMap.zoom,
        changeType: 'mismatch',
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Contact info comparison
// ═══════════════════════════════════════

function compareContactInfo(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  for (const oContact of original.contactInfo) {
    const mContact = migrated.contactInfo.find((c) => c.location === oContact.location);
    if (!mContact) continue;

    if (oContact.phone && mContact.phone && oContact.phone !== mContact.phone) {
      items.push({
        page: migrated.url,
        section: 'contact',
        checkId: 'contact-phone',
        description: `Phone mismatch at ${oContact.location}: "${oContact.phone}" → "${mContact.phone}"`,
        severity: 'major',
        original: oContact.phone,
        migrated: mContact.phone,
        changeType: 'mismatch',
      });
    }

    if (oContact.email && mContact.email && oContact.email !== mContact.email) {
      items.push({
        page: migrated.url,
        section: 'contact',
        checkId: 'contact-email',
        description: `Email mismatch at ${oContact.location}: "${oContact.email}" → "${mContact.email}"`,
        severity: 'major',
        original: oContact.email,
        migrated: mContact.email,
        changeType: 'mismatch',
      });
    }

    if (oContact.address && mContact.address && oContact.address !== mContact.address) {
      items.push({
        page: migrated.url,
        section: 'contact',
        checkId: 'contact-address',
        description: `Address mismatch at ${oContact.location}`,
        severity: 'major',
        original: oContact.address,
        migrated: mContact.address,
        changeType: 'mismatch',
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Print Button
// ═══════════════════════════════════════

/**
 * Flags pages where the original BR site had a print button but the migrated
 * Wix site does not. Print buttons on article/newsletter detail pages are a
 * deliberate feature that users rely on — their absence is a regression.
 */
function comparePrintButton(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  if (!original) return [];
  if (!original.hasPrintButton || migrated.hasPrintButton) return [];

  return [{
    page: migrated.url,
    section: 'page',
    checkId: 'cta-print-missing',
    description: `Print button present on original but missing on migrated page`,
    severity: 'major',
    original: true,
    migrated: false,
    changeType: 'missing-in-migrated',
  }];
}

/**
 * Flags pages where the original BR site had a back-to-top button but the
 * migrated Wix site does not. Common on long article/newsletter pages.
 */
function compareBackToTop(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  if (!original) return [];
  if (!original.hasBackToTopButton || migrated.hasBackToTopButton) return [];

  return [{
    page: migrated.url,
    section: 'footer',
    checkId: 'cta-back-to-top-missing',
    description: `Back-to-top button present on original but missing on migrated page`,
    severity: 'minor',
    original: true,
    migrated: false,
    changeType: 'missing-in-migrated',
  }];
}

/**
 * Detects links on the MIGRATED page whose href contains a raw `?` in the URL
 * path — a known Wix slug-encoding bug where article titles ending with `?`
 * (e.g. "Why Do People Buy Annuities?") generate broken URLs like
 * `/why-do-people-buy-annuities?` that the server cannot resolve (404).
 *
 * Heuristic: a `?` is malformed when:
 *   - It appears at the END of the pathname (nothing after it), OR
 *   - It is followed by characters that look like a slug continuation
 *     (no `=` sign anywhere after it → not a real query param)
 */
function checkMalformedUrls(migrated: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];

  for (const link of migrated.links) {
    if (!link.href) continue;
    let url: URL;
    try { url = new URL(link.href); } catch { continue; }

    const search = url.search; // includes the leading '?'
    if (!search || search === '?') {
      // Trailing bare `?` — definitely malformed
      if (link.href.endsWith('?')) {
        items.push({
          page: migrated.url,
          section: link.location,
          checkId: 'link-malformed-url',
          description: `Link "${link.text || link.href}" has a malformed URL ending with "?" — likely an unencoded article title. This causes a 404 in Chrome's prefetch.`,
          severity: 'critical',
          original: null,
          migrated: link.href,
          changeType: 'mismatch',
        });
      }
    } else if (search.length > 1 && !search.includes('=')) {
      // `?something` with no `=` — looks like slug text leaked into the query string
      items.push({
        page: migrated.url,
        section: link.location,
        checkId: 'link-malformed-url',
        description: `Link "${link.text || link.href}" has a suspicious URL — the "?" may be an unencoded character from an article title (e.g. "Why Do People Buy Annuities?"). Verify this URL loads correctly.`,
        severity: 'major',
        original: null,
        migrated: link.href,
        changeType: 'mismatch',
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Page Health Checks (single-site issues)
// ═══════════════════════════════════════

/**
 * Flags Wix editor placeholder texts found on the migrated page.
 * "Footer link 1", "Add paragraph text", etc. should never appear on a live site.
 */
function checkPlaceholderTexts(page: PageSnapshot): DiffItem[] {
  return (page.placeholderTexts ?? []).map((p) => ({
    page: page.url,
    section: p.location,
    checkId: 'content-placeholder-text',
    description: `Placeholder text found: "${p.text}" — this is unfilled template content that should be replaced before launch`,
    severity: 'critical' as const,
    original: null,
    migrated: p.text,
    changeType: 'mismatch' as const,
  }));
}

/**
 * Flags CTAs/buttons on the migrated page that are non-functional
 * (empty href, href="#", javascript:void, or self-referencing links).
 */
function checkInvalidCTAs(page: PageSnapshot): DiffItem[] {
  return (page.invalidCTAs ?? []).map((cta) => ({
    page: page.url,
    section: cta.section,
    checkId: 'cta-non-functional',
    description: `Button/link "${cta.text}" is non-functional: ${cta.reason}`,
    severity: 'major' as const,
    original: null,
    migrated: cta.href ?? '(no href)',
    changeType: 'mismatch' as const,
  }));
}

/**
 * Flags tel: and mailto: links that are broken or malformed.
 */
function checkInvalidContactLinks(page: PageSnapshot): DiffItem[] {
  return (page.invalidContactLinks ?? []).map((link) => ({
    page: page.url,
    section: link.location,
    checkId: `contact-${link.type}-invalid`,
    description: `${link.type === 'tel' ? 'Phone' : 'Email'} link "${link.text}" is invalid: ${link.reason}`,
    severity: 'major' as const,
    original: null,
    migrated: link.href,
    changeType: 'mismatch' as const,
  }));
}

/**
 * Detects Wix template placeholder social media links.
 * Wix templates ship with social icons pointing to Wix's own demo accounts
 * (facebook.com/WixStudio, twitter.com/WixStudio, linkedin.com/company/wix-com, etc.).
 * These must be replaced during migration — if they're still present it's a bug.
 */
const WIX_TEMPLATE_SOCIAL_PATHS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /facebook\.com\/(?:wixstudio|wix\.com|wixcom)\b/i, label: 'Facebook → facebook.com/WixStudio (Wix template default — not the client\'s account)' },
  { pattern: /twitter\.com\/(?:wixstudio|wixcom|wix)\b/i,      label: 'Twitter → twitter.com/WixStudio (Wix template default — not the client\'s account)' },
  { pattern: /x\.com\/(?:wixstudio|wixcom|wix)\b/i,            label: 'X/Twitter → x.com/WixStudio (Wix template default — not the client\'s account)' },
  { pattern: /linkedin\.com\/company\/wix(?:-com|com|studio)?\b/i, label: 'LinkedIn → linkedin.com/company/wix-com (Wix template default — not the client\'s account)' },
  { pattern: /instagram\.com\/(?:wix|wixstudio)\b/i,           label: 'Instagram → instagram.com/wix (Wix template default — not the client\'s account)' },
  { pattern: /youtube\.com\/(?:user\/wix|c\/wix|@wix)\b/i,     label: 'YouTube → youtube.com/wix (Wix template default — not the client\'s account)' },
];

function checkWixTemplateSocialLinks(page: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  const seen = new Set<string>();

  for (const link of page.links) {
    for (const { pattern, label } of WIX_TEMPLATE_SOCIAL_PATHS) {
      if (pattern.test(link.href) && !seen.has(link.href)) {
        seen.add(link.href);
        items.push({
          page: page.url,
          section: link.location,
          checkId: 'wix-template-social-link',
          description: `Wix template social link not replaced: ${label}`,
          severity: 'critical' as const,
          original: null,
          migrated: link.href,
          changeType: 'new-in-migrated' as const,
        });
      }
    }
  }

  return items;
}

// ═══════════════════════════════════════
//  Summary
// ═══════════════════════════════════════

function computeSummary(items: DiffItem[]): DiffSummary {
  return {
    totalChecks: items.length,
    passed: items.filter((i) => i.changeType === 'match').length,
    failed: items.filter((i) => i.changeType === 'mismatch' || i.changeType === 'missing-in-migrated').length,
    bugs: items.filter((i) => i.verdict === 'bug').length,
    contentChanged: items.filter((i) => i.changeType === 'content-changed').length,
    fixed: items.filter((i) => i.changeType === 'fixed').length,
    regressed: items.filter((i) => i.changeType === 'regressed').length,
    newIssues: items.filter((i) => i.changeType === 'new-in-migrated').length,
    expectedChanges: items.filter((i) => i.changeType === 'expected-change').length,
  };
}
