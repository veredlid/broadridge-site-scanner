import type {
  PageSnapshot,
  SiteSnapshot,
  ValidationResult,
  ValidationReport,
  LinkValidationResult,
} from '../types/index.js';
import { PROHIBITED_FORMS, PROHIBITED_MENU_ITEMS, THRESHOLDS, SOCIAL_PLATFORMS } from '../config.js';

type SiteType = 'vanilla' | 'flex' | 'deprecated';

/**
 * Metadata for a rule check — which site types it applies to.
 * 'all' means the check runs for every site type.
 */
type RuleAppliesTo = SiteType[] | 'all';

/** Wrap a rule result array with site-type applicability info. */
function applyIf(
  siteType: SiteType,
  appliesTo: RuleAppliesTo,
  results: ValidationResult[]
): ValidationResult[] {
  if (appliesTo === 'all') return results;
  if (appliesTo.includes(siteType)) return results;
  return [];
}

export function runAllRules(
  snapshot: SiteSnapshot,
  linkResults: Map<string, LinkValidationResult[]>,
  siteType: SiteType = 'flex',
  originalSnapshot?: SiteSnapshot
): ValidationReport {
  const results: ValidationResult[] = [];
  const t = siteType; // shorthand

  // ── Per-page checks ──────────────────────────────────────────────────────
  for (const page of snapshot.pages) {
    const originalPage = originalSnapshot?.pages.find((p) => matchPageUrls(p.url, page.url));
    const pageLinks = linkResults.get(page.url) ?? [];

    // All site types
    results.push(...applyIf(t, 'all', checkProhibitedForms(page)));
    results.push(...applyIf(t, 'all', checkMobileLayout(page)));
    results.push(...applyIf(t, 'all', checkBrokenLinks(pageLinks, page.url)));
    results.push(...applyIf(t, 'all', checkProhibitedMenuItems(page)));
    results.push(...applyIf(t, 'all', checkFooterRules(page)));
    results.push(...applyIf(t, 'all', checkHeroSection(page)));
    results.push(...applyIf(t, 'all', checkContactConsistency(page)));
    results.push(...applyIf(t, 'all', checkSocialLinks(page)));
    results.push(...applyIf(t, 'all', checkDeadCTAs(page)));
    results.push(...applyIf(t, 'all', checkCrossNavConsistency(page)));

    // Vanilla only: strict 1-1 comparison checks
    results.push(...applyIf(t, ['vanilla'], checkImageLinks(page, originalPage)));
    results.push(...applyIf(t, ['vanilla'], checkMapSection(page, originalPage)));
    results.push(...applyIf(t, ['vanilla'], checkSectionDimensions(page, originalPage)));
    results.push(...applyIf(t, ['vanilla'], checkMenuStructure(page, originalPage)));
    results.push(...applyIf(t, ['vanilla'], checkBrokerCheck(page, originalPage)));

    // Flex + Deprecated: template-based checks
    results.push(...applyIf(t, ['flex', 'deprecated'], checkCalloutSections(page)));
  }

  // ── Cross-page checks (run once on the whole snapshot) ───────────────────
  results.push(...applyIf(t, 'all', checkHeaderOnEveryPage(snapshot)));
  results.push(...applyIf(t, 'all', checkFooterOnEveryPage(snapshot)));
  results.push(...applyIf(t, 'all', checkMenuConsistencyAcrossPages(snapshot)));
  results.push(...applyIf(t, 'all', checkLogoOnEveryPage(snapshot)));
  results.push(...applyIf(t, 'all', checkContactInfoAcrossPages(snapshot)));
  results.push(...applyIf(t, 'all', checkBackToTopOnEveryPage(snapshot)));
  results.push(...applyIf(t, 'all', checkNavCoverageMatchesScannedPages(snapshot)));

  const passed = results.filter((r) => r.passed).length;
  return {
    domain: snapshot.domain,
    timestamp: snapshot.capturedAt,
    totalChecks: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

function matchPageUrls(url1: string, url2: string): boolean {
  const normalize = (u: string) => u.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/';
  return normalize(url1) === normalize(url2);
}

// ═══════════════════════════════════════
//  V1: No prohibited forms
// ═══════════════════════════════════════

function checkProhibitedForms(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  const prohibited = page.forms.filter(
    (f) => f.isVisible && (PROHIBITED_FORMS as readonly string[]).includes(f.formType)
  );

  if (prohibited.length > 0) {
    for (const form of prohibited) {
      results.push({
        ruleId: 'V1',
        ruleName: 'No prohibited forms',
        category: 'Forms',
        severity: 'critical',
        passed: false,
        message: `Prohibited form found: "${form.formType}" in ${form.section}`,
        page: page.url,
        section: form.section,
        details: form,
      });
    }
  } else {
    results.push({
      ruleId: 'V1',
      ruleName: 'No prohibited forms',
      category: 'Forms',
      severity: 'critical',
      passed: true,
      message: 'No prohibited forms found',
      page: page.url,
      section: 'all',
    });
  }

  return results;
}

// ═══════════════════════════════════════
//  V2: Image links preserved
// ═══════════════════════════════════════

function checkImageLinks(page: PageSnapshot, originalPage?: PageSnapshot): ValidationResult[] {
  if (!originalPage) return [];
  const results: ValidationResult[] = [];

  const originalLinkedImages = originalPage.images.filter((img) => img.hasLink);
  for (const origImg of originalLinkedImages) {
    const migratedImg = page.images.find(
      (img) => img.src === origImg.src || img.alt === origImg.alt
    );
    if (migratedImg && !migratedImg.hasLink) {
      results.push({
        ruleId: 'V2',
        ruleName: 'Image links preserved',
        category: 'Images',
        severity: 'major',
        passed: false,
        message: `Image "${origImg.alt || origImg.src}" lost its link (was: ${origImg.linkHref})`,
        page: page.url,
        section: origImg.section,
        details: { original: origImg, migrated: migratedImg },
      });
    }
  }

  if (results.length === 0 && originalLinkedImages.length > 0) {
    results.push({
      ruleId: 'V2',
      ruleName: 'Image links preserved',
      category: 'Images',
      severity: 'major',
      passed: true,
      message: `All ${originalLinkedImages.length} linked images still have links`,
      page: page.url,
      section: 'all',
    });
  }

  return results;
}

// ═══════════════════════════════════════
//  V4-V8: Mobile layout checks
// ═══════════════════════════════════════

function checkMobileLayout(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const [vpName, metrics] of Object.entries(page.viewports) as Array<
    [string, typeof page.viewports.desktop]
  >) {
    if (vpName === 'desktop') continue;

    if (metrics.hasHorizontalScroll) {
      results.push({
        ruleId: 'V6',
        ruleName: 'No horizontal scroll',
        category: 'Mobile',
        severity: 'major',
        passed: false,
        message: `Horizontal scroll detected on ${vpName}`,
        page: page.url,
        section: 'page',
      });
    }

    if (vpName === 'mobile' && metrics.smallestFontSize > 0 && metrics.smallestFontSize < THRESHOLDS.minMobileFontSize) {
      results.push({
        ruleId: 'V7',
        ruleName: 'No text < 12px on mobile',
        category: 'Mobile',
        severity: 'major',
        passed: false,
        message: `Font ${metrics.smallestFontSize}px found on element "${metrics.smallestFontElement}" (min: ${THRESHOLDS.minMobileFontSize}px)`,
        page: page.url,
        section: 'page',
      });
    }

    if (metrics.textOverflows.length > 0) {
      results.push({
        ruleId: 'V8',
        ruleName: 'No text overflow',
        category: 'Mobile',
        severity: 'major',
        passed: false,
        message: `${metrics.textOverflows.length} text overflow(s) on ${vpName}`,
        page: page.url,
        section: 'page',
        details: metrics.textOverflows,
      });
    }

    for (const issue of metrics.paddingIssues) {
      results.push({
        ruleId: 'V12',
        ruleName: 'Padding ≥ 3%',
        category: 'Padding',
        severity: 'minor',
        passed: false,
        message: `${issue.element}: ${issue.paddingPercent}% padding (need ${issue.threshold}%)`,
        page: page.url,
        section: issue.element,
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════
//  V9: Broken links
// ═══════════════════════════════════════

function checkBrokenLinks(links: LinkValidationResult[], pageUrl: string): ValidationResult[] {
  const results: ValidationResult[] = [];
  const flagged = links.filter((l) => l.isFlagged);

  for (const link of flagged) {
    results.push({
      ruleId: 'V9',
      ruleName: 'No broken links',
      category: 'Links',
      severity: 'critical',
      passed: false,
      message: `Broken link: "${link.text}" → ${link.href} (${link.httpStatus})`,
      page: pageUrl,
      section: link.location,
      details: link,
    });
  }

  if (flagged.length === 0) {
    results.push({
      ruleId: 'V9',
      ruleName: 'No broken links',
      category: 'Links',
      severity: 'critical',
      passed: true,
      message: `All ${links.length} links validated successfully`,
      page: pageUrl,
      section: 'all',
    });
  }

  return results;
}

// ═══════════════════════════════════════
//  V29: Prohibited menu items
// ═══════════════════════════════════════

function checkProhibitedMenuItems(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const item of page.menu.items) {
    const lower = item.text.toLowerCase();
    if ((PROHIBITED_MENU_ITEMS as readonly string[]).includes(lower)) {
      results.push({
        ruleId: 'V29',
        ruleName: 'Prohibited menu items',
        category: 'Menu',
        severity: 'critical',
        passed: false,
        message: `Prohibited menu item found: "${item.text}"`,
        page: page.url,
        section: 'navigationContainer',
      });
    }

    for (const sub of item.subItems) {
      const subLower = sub.text.toLowerCase();
      if ((PROHIBITED_MENU_ITEMS as readonly string[]).includes(subLower)) {
        results.push({
          ruleId: 'V29',
          ruleName: 'Prohibited menu items',
          category: 'Menu',
          severity: 'critical',
          passed: false,
          message: `Prohibited sub-menu item: "${sub.text}" under "${item.text}"`,
          page: page.url,
          section: 'navigationContainer',
        });
      }
    }
  }

  if (results.length === 0) {
    results.push({
      ruleId: 'V29',
      ruleName: 'Prohibited menu items',
      category: 'Menu',
      severity: 'critical',
      passed: true,
      message: 'No prohibited menu items found',
      page: page.url,
      section: 'navigationContainer',
    });
  }

  return results;
}

// ═══════════════════════════════════════
//  V31-V34: Footer rules
// ═══════════════════════════════════════

function checkFooterRules(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  const footerLinks = page.links.filter((l) => l.location === 'footerContainer');

  const siteMapLink = footerLinks.find((l) => l.text.toLowerCase().includes('site map'));
  results.push({
    ruleId: 'V31',
    ruleName: 'No "Site Map" in footer',
    category: 'Footer',
    severity: 'major',
    passed: !siteMapLink,
    message: siteMapLink ? '"Site Map" link found in footer' : 'No "Site Map" in footer',
    page: page.url,
    section: 'footerContainer',
  });

  const privacyLink = footerLinks.find((l) => l.text.toLowerCase().includes('privacy'));
  if (privacyLink) {
    results.push({
      ruleId: 'V33',
      ruleName: 'Privacy policy → new tab',
      category: 'Footer',
      severity: 'major',
      passed: privacyLink.target === '_blank',
      message: privacyLink.target === '_blank'
        ? 'Privacy policy opens in new tab'
        : `Privacy policy opens in same tab (target="${privacyLink.target}")`,
      page: page.url,
      section: 'footerContainer',
    });
  }

  const disclosuresLink = footerLinks.find((l) =>
    l.text.toLowerCase().includes('disclosures') || l.text.toLowerCase().includes('disclosure')
  );
  if (disclosuresLink) {
    results.push({
      ruleId: 'V34',
      ruleName: 'Client Disclosures → new tab',
      category: 'Footer',
      severity: 'major',
      passed: disclosuresLink.target === '_blank',
      message: disclosuresLink.target === '_blank'
        ? 'Client Disclosures opens in new tab'
        : `Client Disclosures opens in same tab (target="${disclosuresLink.target}")`,
      page: page.url,
      section: 'footerContainer',
    });
  }

  return results;
}

// ═══════════════════════════════════════
//  V35-V36: Hero section
// ═══════════════════════════════════════

function checkHeroSection(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  const heroImages = page.images.filter((img) => img.section === 'heroContainer');

  for (const img of heroImages) {
    if (img.isUpscaled) {
      results.push({
        ruleId: 'V35',
        ruleName: 'Hero image quality',
        category: 'Hero',
        severity: 'major',
        passed: false,
        message: `Hero image upscaled: natural ${img.naturalWidth}×${img.naturalHeight}, displayed ${img.displayWidth}×${img.displayHeight}`,
        page: page.url,
        section: 'heroContainer',
        details: img,
      });
    }

    if (img.isDistorted) {
      results.push({
        ruleId: 'V35',
        ruleName: 'Hero image quality',
        category: 'Hero',
        severity: 'major',
        passed: false,
        message: 'Hero image appears distorted (aspect ratio mismatch >5%)',
        page: page.url,
        section: 'heroContainer',
        details: img,
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════
//  V16, V37: Contact info consistency
// ═══════════════════════════════════════

function checkContactConsistency(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];

  if (page.contactInfo.length < 2) return results;

  const reference = page.contactInfo[0];
  for (let i = 1; i < page.contactInfo.length; i++) {
    const other = page.contactInfo[i];

    if (reference.phone && other.phone && reference.phone !== other.phone) {
      results.push({
        ruleId: 'V16',
        ruleName: 'Contact info consistent',
        category: 'Contact',
        severity: 'major',
        passed: false,
        message: `Phone mismatch: "${reference.phone}" (${reference.location}) vs "${other.phone}" (${other.location})`,
        page: page.url,
        section: 'contact',
      });
    }

    if (reference.email && other.email && reference.email !== other.email) {
      results.push({
        ruleId: 'V16',
        ruleName: 'Contact info consistent',
        category: 'Contact',
        severity: 'major',
        passed: false,
        message: `Email mismatch: "${reference.email}" (${reference.location}) vs "${other.email}" (${other.location})`,
        page: page.url,
        section: 'contact',
      });
    }
  }

  if (results.length === 0) {
    results.push({
      ruleId: 'V16',
      ruleName: 'Contact info consistent',
      category: 'Contact',
      severity: 'major',
      passed: true,
      message: 'Contact info is consistent across all locations',
      page: page.url,
      section: 'contact',
    });
  }

  return results;
}

// ═══════════════════════════════════════
//  V13-V14, V39-V40: Map checks
// ═══════════════════════════════════════

function checkMapSection(page: PageSnapshot, originalPage?: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  const mapSection = page.sections.find((s) => s.id === 'mapContainer');
  if (!mapSection || !mapSection.isPresent) return results;

  if (originalPage) {
    const origMap = originalPage.sections.find((s) => s.id === 'mapContainer');
    if (origMap && origMap.isPresent) {
      const hOrig = origMap.boundingBox.height;
      const hMig = mapSection.boundingBox.height;
      if (hOrig > 0) {
        const diff = Math.abs(hMig - hOrig) / hOrig;
        results.push({
          ruleId: 'V40',
          ruleName: 'Map height ± 20%',
          category: 'Map',
          severity: 'minor',
          passed: diff <= THRESHOLDS.mapHeightTolerance,
          message: diff <= THRESHOLDS.mapHeightTolerance
            ? `Map height within tolerance (${(diff * 100).toFixed(0)}% diff)`
            : `Map height differs by ${(diff * 100).toFixed(0)}%: ${hOrig}px → ${hMig}px`,
          page: page.url,
          section: 'mapContainer',
        });
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════
//  V42-V43: Section dimensions
// ═══════════════════════════════════════

function checkSectionDimensions(page: PageSnapshot, originalPage?: PageSnapshot): ValidationResult[] {
  if (!originalPage) return [];
  const results: ValidationResult[] = [];

  for (const section of page.sections) {
    if (!section.isPresent || !section.isVisible) continue;
    const origSection = originalPage.sections.find((s) => s.id === section.id);
    if (!origSection || !origSection.isPresent) continue;

    const hOrig = origSection.boundingBox.height;
    const hMig = section.boundingBox.height;
    if (hOrig > 0) {
      const diff = Math.abs(hMig - hOrig) / hOrig;
      if (diff > THRESHOLDS.sectionHeightTolerance) {
        results.push({
          ruleId: 'V42',
          ruleName: 'Section heights ± 30%',
          category: 'Sections',
          severity: diff > 0.5 ? 'major' : 'minor',
          passed: false,
          message: `#${section.id} height differs ${(diff * 100).toFixed(0)}%: ${hOrig}px → ${hMig}px`,
          page: page.url,
          section: section.id,
        });
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════
//  V45-V49: Menu structure
// ═══════════════════════════════════════

function checkMenuStructure(page: PageSnapshot, originalPage?: PageSnapshot): ValidationResult[] {
  if (!originalPage) return [];
  const results: ValidationResult[] = [];

  const origItems = originalPage.menu.items;
  const migItems = page.menu.items;

  if (origItems.length !== migItems.length) {
    results.push({
      ruleId: 'V47',
      ruleName: 'No extra/missing menu items',
      category: 'Menu',
      severity: 'critical',
      passed: false,
      message: `Menu items count: ${origItems.length} → ${migItems.length}`,
      page: page.url,
      section: 'navigationContainer',
      details: {
        original: origItems.map((i) => i.text),
        migrated: migItems.map((i) => i.text),
      },
    });
  }

  for (const origItem of origItems) {
    const migItem = migItems.find(
      (m) => m.text.toLowerCase() === origItem.text.toLowerCase()
    );
    if (!migItem) {
      results.push({
        ruleId: 'V45',
        ruleName: 'Menu names match',
        category: 'Menu',
        severity: 'major',
        passed: false,
        message: `Menu item "${origItem.text}" missing in migrated site`,
        page: page.url,
        section: 'navigationContainer',
      });
      continue;
    }

    if (origItem.hasDropdown && !migItem.hasDropdownArrow) {
      results.push({
        ruleId: 'V49',
        ruleName: 'Dropdown arrows present',
        category: 'Menu',
        severity: 'minor',
        passed: false,
        message: `Dropdown arrow missing for "${migItem.text}"`,
        page: page.url,
        section: 'navigationContainer',
      });
    }

    if (origItem.subItems.length !== migItem.subItems.length) {
      results.push({
        ruleId: 'V46',
        ruleName: 'Menu structure matches',
        category: 'Menu',
        severity: 'major',
        passed: false,
        message: `Sub-items for "${origItem.text}": ${origItem.subItems.length} → ${migItem.subItems.length}`,
        page: page.url,
        section: 'navigationContainer',
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════
//  V54: Social media links
// ═══════════════════════════════════════

function checkSocialLinks(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  const footerLinks = page.links.filter((l) => l.location === 'footerContainer');

  const socialLinks = footerLinks.filter((l) =>
    SOCIAL_PLATFORMS.some((platform) => l.href.toLowerCase().includes(platform))
  );

  if (socialLinks.length > 0) {
    results.push({
      ruleId: 'V54',
      ruleName: 'Social media links',
      category: 'Social',
      severity: 'info',
      passed: true,
      message: `Found ${socialLinks.length} social media link(s): ${socialLinks.map((l) => l.href.match(/facebook|linkedin|twitter|x\.com|instagram|youtube/i)?.[0] ?? 'unknown').join(', ')}`,
      page: page.url,
      section: 'footerContainer',
    });
  }

  return results;
}

// ═══════════════════════════════════════
//  V30, V41: Callout sections
// ═══════════════════════════════════════

function checkCalloutSections(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  const mediaSection = page.sections.find((s) => s.id === 'mediaContainer');
  if (!mediaSection || !mediaSection.isPresent) return results;

  const text = mediaSection.textContent.toLowerCase();
  const prohibited = ['flipbook', 'blog', 'events'];

  for (const term of prohibited) {
    if (text.includes(term)) {
      results.push({
        ruleId: 'V30',
        ruleName: 'No deprecated callout items',
        category: 'Callout',
        severity: 'critical',
        passed: false,
        message: `"${term}" found in callout section`,
        page: page.url,
        section: 'mediaContainer',
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════
//  V55: Broker Check presence
// ═══════════════════════════════════════

function checkBrokerCheck(page: PageSnapshot, originalPage?: PageSnapshot): ValidationResult[] {
  const hasBrokerCheck = (p: PageSnapshot): boolean =>
    p.links.some((l) => l.href.toLowerCase().includes('brokercheck.finra.org')) ||
    p.sections.some((s) => s.textContent.toLowerCase().includes('brokercheck'));

  const presentOnMigrated = hasBrokerCheck(page);

  // Comparison mode: if original had it, migrated must too
  if (originalPage) {
    const presentOnOriginal = hasBrokerCheck(originalPage);
    if (!presentOnOriginal) return []; // original didn't have it — no requirement
    return [{
      ruleId: 'V55',
      ruleName: 'Broker Check preserved',
      category: 'Compliance',
      severity: 'critical',
      passed: presentOnMigrated,
      message: presentOnMigrated
        ? 'BrokerCheck link/widget present on migrated site'
        : 'BrokerCheck link/widget present on original but MISSING on migrated site',
      page: page.url,
      section: 'footerContainer',
    }];
  }

  // Single-scan mode: report presence as info
  if (presentOnMigrated) {
    return [{
      ruleId: 'V55',
      ruleName: 'Broker Check presence',
      category: 'Compliance',
      severity: 'info',
      passed: true,
      message: 'BrokerCheck link/widget detected',
      page: page.url,
      section: 'footerContainer',
    }];
  }

  return [];
}

// ═══════════════════════════════════════
//  V56: Cross-nav link consistency
// ═══════════════════════════════════════

function checkCrossNavConsistency(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];

  const normalizeUrl = (href: string): string =>
    href.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/';

  const headerLinks = page.links.filter(
    (l) => l.location === 'headerContainer' || l.location === 'navigationContainer'
  );
  const footerLinks = page.links.filter(
    (l) => l.location === 'footerContainer' || l.location === 'bottomNavigationContainer'
  );

  for (const headerLink of headerLinks) {
    if (!headerLink.text.trim()) continue;
    const matchingFooter = footerLinks.find(
      (f) => f.text.trim().toLowerCase() === headerLink.text.trim().toLowerCase()
    );
    if (!matchingFooter) continue;

    const headerDest = normalizeUrl(headerLink.href);
    const footerDest = normalizeUrl(matchingFooter.href);

    if (headerDest !== footerDest) {
      results.push({
        ruleId: 'V56',
        ruleName: 'Nav link consistency',
        category: 'Navigation',
        severity: 'major',
        passed: false,
        message: `"${headerLink.text}" navigates to different URLs: header → "${headerDest}" vs footer → "${footerDest}"`,
        page: page.url,
        section: 'navigationContainer',
        details: { headerLink, matchingFooter },
      });
    }
  }

  if (results.length === 0 && headerLinks.length > 0) {
    results.push({
      ruleId: 'V56',
      ruleName: 'Nav link consistency',
      category: 'Navigation',
      severity: 'major',
      passed: true,
      message: 'All shared header/footer navigation links point to consistent destinations',
      page: page.url,
      section: 'navigationContainer',
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CROSS-PAGE CHECKS  (V58–V64)
//  These receive the full SiteSnapshot and run once per site, not per page.
// ═══════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────
//  V58: Header present on every page
// ───────────────────────────────────────
function checkHeaderOnEveryPage(snapshot: SiteSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const page of snapshot.pages) {
    const header = page.sections.find((s) => s.id === 'headerContainer');
    const ok = header?.isPresent === true && header?.isVisible === true;
    results.push({
      ruleId: 'V58',
      ruleName: 'Header on every page',
      category: 'Consistency',
      severity: 'critical',
      passed: ok,
      message: ok
        ? 'Header is present and visible'
        : 'Header section is missing or hidden',
      page: page.url,
      section: 'headerContainer',
    });
  }
  return results;
}

// ───────────────────────────────────────
//  V59: Footer with disclaimer on every page
// ───────────────────────────────────────

/** Compliance keywords that should appear in the footer disclaimer. */
const DISCLAIMER_KEYWORDS = [
  'investment', 'advisor', 'securities', 'registered', 'insurance',
  'sec', 'finra', 'disclosure', 'advisor',
];

function checkFooterOnEveryPage(snapshot: SiteSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const page of snapshot.pages) {
    const footer = page.sections.find((s) => s.id === 'footerContainer');
    const footerPresent = footer?.isPresent === true;
    const text = footer?.textContent?.toLowerCase() ?? '';
    const hasDisclaimer = DISCLAIMER_KEYWORDS.some((kw) => text.includes(kw));

    if (!footerPresent) {
      results.push({
        ruleId: 'V59',
        ruleName: 'Footer with disclaimer on every page',
        category: 'Consistency',
        severity: 'critical',
        passed: false,
        message: 'Footer section is missing',
        page: page.url,
        section: 'footerContainer',
      });
    } else {
      results.push({
        ruleId: 'V59',
        ruleName: 'Footer with disclaimer on every page',
        category: 'Compliance',
        severity: 'critical',
        passed: hasDisclaimer,
        message: hasDisclaimer
          ? 'Footer contains compliance disclaimer'
          : 'Footer is present but no compliance disclaimer text detected',
        page: page.url,
        section: 'footerContainer',
      });
    }
  }
  return results;
}

// ───────────────────────────────────────
//  V60: Navigation menu consistent across all pages
// ───────────────────────────────────────
function checkMenuConsistencyAcrossPages(snapshot: SiteSnapshot): ValidationResult[] {
  if (snapshot.pages.length < 2) return [];

  // Use the home page (first page) as the reference menu
  const referencePage = snapshot.pages[0];
  const referenceItems = referencePage.menu.items
    .map((i) => i.text.toLowerCase().trim())
    .sort()
    .join('|');

  if (!referenceItems) return []; // No menu on reference page — skip

  const results: ValidationResult[] = [];

  for (const page of snapshot.pages.slice(1)) {
    const pageItems = page.menu.items
      .map((i) => i.text.toLowerCase().trim())
      .sort()
      .join('|');

    if (!pageItems) {
      results.push({
        ruleId: 'V60',
        ruleName: 'Nav menu consistent across pages',
        category: 'Consistency',
        severity: 'major',
        passed: false,
        message: `No nav menu extracted on this page (expected: [${referenceItems.replace(/\|/g, ', ')}])`,
        page: page.url,
        section: 'navigationContainer',
      });
    } else if (pageItems !== referenceItems) {
      results.push({
        ruleId: 'V60',
        ruleName: 'Nav menu consistent across pages',
        category: 'Consistency',
        severity: 'major',
        passed: false,
        message: `Menu differs from home page — got [${pageItems.replace(/\|/g, ', ')}], expected [${referenceItems.replace(/\|/g, ', ')}]`,
        page: page.url,
        section: 'navigationContainer',
      });
    } else {
      results.push({
        ruleId: 'V60',
        ruleName: 'Nav menu consistent across pages',
        category: 'Consistency',
        severity: 'major',
        passed: true,
        message: 'Nav menu matches home page',
        page: page.url,
        section: 'navigationContainer',
      });
    }
  }

  return results;
}

// ───────────────────────────────────────
//  V61: Company logo / image in header on every page
// ───────────────────────────────────────
function checkLogoOnEveryPage(snapshot: SiteSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const page of snapshot.pages) {
    const header = page.sections.find((s) => s.id === 'headerContainer');
    if (!header?.isPresent) continue; // V58 already flags missing header

    const hasLogoImage = (header.imageCount ?? 0) > 0;
    // Also accept a text-based logo (heading/text in header)
    const hasLogoText = (header.headings ?? []).length > 0 || header.textContent.trim().length > 0;
    const ok = hasLogoImage || hasLogoText;

    results.push({
      ruleId: 'V61',
      ruleName: 'Company logo / name in header',
      category: 'Consistency',
      severity: 'major',
      passed: ok,
      message: ok
        ? hasLogoImage
          ? `Header contains ${header.imageCount} image(s) — logo likely present`
          : 'Header contains text content — text logo likely present'
        : 'Header has no logo image and no visible text',
      page: page.url,
      section: 'headerContainer',
    });
  }
  return results;
}

// ───────────────────────────────────────
//  V62: Contact info consistent across all pages
// ───────────────────────────────────────
function checkContactInfoAcrossPages(snapshot: SiteSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Collect all phone numbers and emails found across all pages
  const phones = new Map<string, string[]>(); // phone → [pages]
  const emails = new Map<string, string[]>();

  for (const page of snapshot.pages) {
    for (const contact of page.contactInfo) {
      if (contact.phone) {
        const normalized = contact.phone.replace(/\D/g, '');
        if (!phones.has(normalized)) phones.set(normalized, []);
        phones.get(normalized)!.push(page.url);
      }
      if (contact.email) {
        const normalized = contact.email.toLowerCase().trim();
        if (!emails.has(normalized)) emails.set(normalized, []);
        emails.get(normalized)!.push(page.url);
      }
    }
  }

  if (phones.size > 1) {
    const variants = [...phones.keys()].join(', ');
    results.push({
      ruleId: 'V62',
      ruleName: 'Contact info consistent across pages',
      category: 'Consistency',
      severity: 'major',
      passed: false,
      message: `Multiple phone numbers found across pages: ${variants}`,
      page: 'site-wide',
      section: 'contact',
      details: Object.fromEntries(phones),
    });
  }

  if (emails.size > 1) {
    const variants = [...emails.keys()].join(', ');
    results.push({
      ruleId: 'V62',
      ruleName: 'Contact info consistent across pages',
      category: 'Consistency',
      severity: 'major',
      passed: false,
      message: `Multiple email addresses found across pages: ${variants}`,
      page: 'site-wide',
      section: 'contact',
      details: Object.fromEntries(emails),
    });
  }

  if (results.length === 0 && (phones.size > 0 || emails.size > 0)) {
    results.push({
      ruleId: 'V62',
      ruleName: 'Contact info consistent across pages',
      category: 'Consistency',
      severity: 'major',
      passed: true,
      message: `Contact info is consistent across all ${snapshot.pages.length} pages`,
      page: 'site-wide',
      section: 'contact',
    });
  }

  return results;
}

// ───────────────────────────────────────
//  V63: Back-to-top CTA present on every page
// ───────────────────────────────────────
const BACK_TO_TOP_PATTERNS = [
  /back\s*to\s*top/i,
  /scroll\s*to\s*top/i,
  /go\s*to\s*top/i,
  /\^|↑|⬆/,
];

function checkBackToTopOnEveryPage(snapshot: SiteSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const page of snapshot.pages) {
    const backToTopLink = page.links.find((l) => {
      const text = l.text.trim();
      const isAnchorTarget = l.href === '#' || l.href.endsWith('#top') || l.href.endsWith('#');
      const isTextMatch = BACK_TO_TOP_PATTERNS.some((re) => re.test(text));
      return isAnchorTarget || isTextMatch;
    });

    // Also check CTAs
    const backToTopCta = page.ctas.find((c) =>
      BACK_TO_TOP_PATTERNS.some((re) => re.test(c.text))
    );

    const ok = !!(backToTopLink || backToTopCta);
    results.push({
      ruleId: 'V63',
      ruleName: 'Back-to-top CTA present',
      category: 'Navigation',
      severity: 'minor',
      passed: ok,
      message: ok
        ? `Back-to-top link found: "${(backToTopLink ?? backToTopCta)?.text}"`
        : 'No back-to-top link or CTA found on this page',
      page: page.url,
      section: 'footerContainer',
    });
  }
  return results;
}

// ───────────────────────────────────────
//  V64: All nav sub-pages were actually scanned
// ───────────────────────────────────────
function checkNavCoverageMatchesScannedPages(snapshot: SiteSnapshot): ValidationResult[] {
  if (snapshot.pages.length === 0) return [];

  // Collect all internal nav sub-item URLs from the home page menu
  const homePage = snapshot.pages.find((p) => p.url === '/' || p.url === '') ?? snapshot.pages[0];
  const scannedPaths = new Set(
    snapshot.pages.map((p) => normalizePath(p.url))
  );

  const results: ValidationResult[] = [];
  const missingPages: string[] = [];

  for (const item of homePage.menu.items) {
    for (const sub of item.subItems) {
      try {
        const path = normalizePath(sub.href);
        if (path.startsWith('/') && !scannedPaths.has(path)) {
          missingPages.push(`"${sub.text}" (${path})`);
        }
      } catch {
        // ignore non-URL sub items (external links, anchors)
      }
    }
    // Also check top-level items that have their own page (href not '#')
    if (item.href && item.href !== '#') {
      try {
        const path = normalizePath(item.href);
        if (path.startsWith('/') && path !== '/' && !scannedPaths.has(path)) {
          missingPages.push(`"${item.text}" (${path})`);
        }
      } catch {
        // ignore
      }
    }
  }

  if (missingPages.length > 0) {
    results.push({
      ruleId: 'V64',
      ruleName: 'All nav sub-pages scanned',
      category: 'Coverage',
      severity: 'minor',
      passed: false,
      message: `${missingPages.length} nav page(s) not included in scan: ${missingPages.join(', ')}`,
      page: 'site-wide',
      section: 'navigationContainer',
      details: missingPages,
    });
  } else {
    results.push({
      ruleId: 'V64',
      ruleName: 'All nav sub-pages scanned',
      category: 'Coverage',
      severity: 'minor',
      passed: true,
      message: `All ${scannedPaths.size} pages discovered in nav were scanned`,
      page: 'site-wide',
      section: 'navigationContainer',
    });
  }

  return results;
}

function normalizePath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '') || '/';
  } catch {
    return url.replace(/\/$/, '') || '/';
  }
}

// ═══════════════════════════════════════
//  V57: Dead CTAs (visible, no destination)
// ═══════════════════════════════════════

const NAV_CTA_KEYWORDS = [
  'learn more', 'watch now', 'view', 'read more', 'get started',
  'explore', 'discover', 'see more', 'find out', 'click here',
  'start', 'go to', 'open', 'launch', 'visit',
];

function checkDeadCTAs(page: PageSnapshot): ValidationResult[] {
  const results: ValidationResult[] = [];

  const deadCTAs = page.ctas.filter((cta) => {
    if (!cta.isVisible) return false;
    if (cta.href !== null) return false;         // has a destination
    if (cta.navigatesTo !== null) return false;   // clicked and navigated
    if (cta.type === 'submit') return false;       // form submit — intentional
    const textLower = cta.text.toLowerCase();
    return NAV_CTA_KEYWORDS.some((kw) => textLower.includes(kw));
  });

  for (const cta of deadCTAs) {
    results.push({
      ruleId: 'V57',
      ruleName: 'No dead CTAs',
      category: 'CTAs',
      severity: 'major',
      passed: false,
      message: `CTA "${cta.text}" in ${cta.section} has no navigation destination`,
      page: page.url,
      section: cta.section,
      details: cta,
    });
  }

  if (deadCTAs.length === 0 && page.ctas.filter((c) => c.isVisible).length > 0) {
    results.push({
      ruleId: 'V57',
      ruleName: 'No dead CTAs',
      category: 'CTAs',
      severity: 'major',
      passed: true,
      message: `All visible CTAs have navigation destinations`,
      page: page.url,
      section: 'all',
    });
  }

  return results;
}
