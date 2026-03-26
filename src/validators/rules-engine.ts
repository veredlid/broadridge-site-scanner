import type {
  PageSnapshot,
  SiteSnapshot,
  ValidationResult,
  ValidationReport,
  LinkValidationResult,
} from '../types/index.js';
import { PROHIBITED_FORMS, PROHIBITED_MENU_ITEMS, THRESHOLDS, SOCIAL_PLATFORMS } from '../config.js';

export function runAllRules(
  snapshot: SiteSnapshot,
  linkResults: Map<string, LinkValidationResult[]>,
  originalSnapshot?: SiteSnapshot
): ValidationReport {
  const results: ValidationResult[] = [];

  for (const page of snapshot.pages) {
    const originalPage = originalSnapshot?.pages.find((p) => matchPageUrls(p.url, page.url));
    const pageLinks = linkResults.get(page.url) ?? [];

    results.push(...checkProhibitedForms(page));
    results.push(...checkImageLinks(page, originalPage));
    results.push(...checkMobileLayout(page));
    results.push(...checkBrokenLinks(pageLinks, page.url));
    results.push(...checkProhibitedMenuItems(page));
    results.push(...checkFooterRules(page));
    results.push(...checkHeroSection(page));
    results.push(...checkContactConsistency(page));
    results.push(...checkMapSection(page, originalPage));
    results.push(...checkSectionDimensions(page, originalPage));
    results.push(...checkMenuStructure(page, originalPage));
    results.push(...checkSocialLinks(page));
    results.push(...checkCalloutSections(page));
  }

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
