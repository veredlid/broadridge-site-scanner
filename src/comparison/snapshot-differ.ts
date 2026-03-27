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

  for (const migratedPage of migrated.pages) {
    const originalPage = findMatchingPage(original.pages, migratedPage, mode);
    const pageItems: DiffItem[] = [];

    pageItems.push(...compareLinks(migratedPage, originalPage));
    pageItems.push(...compareSections(migratedPage, originalPage));
    pageItems.push(...compareMenu(migratedPage, originalPage));
    pageItems.push(...compareForms(migratedPage, originalPage));
    pageItems.push(...compareImages(migratedPage, originalPage));
    pageItems.push(...compareContactInfo(migratedPage, originalPage));

    items.push(...pageItems);
    pageDiffs.push({
      url: migratedPage.url,
      originalUrl: originalPage?.url,
      migratedUrl: migratedPage.url,
      items: pageItems,
    });
  }

  const summary = computeSummary(items);

  return {
    originalDomain: original.domain,
    migratedDomain: migrated.domain,
    originalTimestamp: original.capturedAt,
    migratedTimestamp: migrated.capturedAt,
    mode,
    summary,
    items,
    pages: pageDiffs,
  };
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

function normalizePath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '') || '/';
  } catch {
    return url.replace(/\/$/, '') || '/';
  }
}

// ═══════════════════════════════════════
//  Link comparison
// ═══════════════════════════════════════

function compareLinks(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

  for (const mLink of migrated.links) {
    const oLink = original.links.find((l) => l.text === mLink.text && l.location === mLink.location)
      ?? original.links.find((l) => l.href === mLink.href);

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

    if (oLink.href !== mLink.href) {
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

  for (const oLink of original.links) {
    const exists = migrated.links.some(
      (l) => l.text === oLink.text || l.href === oLink.href
    );
    if (!exists) {
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

  return items;
}

// ═══════════════════════════════════════
//  Section comparison
// ═══════════════════════════════════════

function compareSections(migrated: PageSnapshot, original?: PageSnapshot): DiffItem[] {
  const items: DiffItem[] = [];
  if (!original) return items;

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
      items.push({
        page: migrated.url,
        section: mSection.id,
        checkId: 'section-missing',
        description: `Section #${mSection.id} is missing`,
        severity: 'critical',
        original: oSection,
        migrated: mSection,
        changeType: 'missing-in-migrated',
      });
      continue;
    }

    if (!mSection.isPresent) continue;

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
      });
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
      });
    }
  }

  // Sections present on original but missing from migrated
  for (const oSection of original.sections) {
    if (!oSection.isPresent) continue;
    const exists = migrated.sections.find((s) => s.id === oSection.id);
    if (!exists) {
      items.push({
        page: migrated.url,
        section: oSection.id,
        checkId: 'section-missing',
        description: `Section #${oSection.id} present on original, missing on migrated`,
        severity: 'critical',
        original: oSection,
        migrated: null,
        changeType: 'missing-in-migrated',
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
//  Summary
// ═══════════════════════════════════════

function computeSummary(items: DiffItem[]): DiffSummary {
  return {
    totalChecks: items.length,
    passed: items.filter((i) => i.changeType === 'match').length,
    failed: items.filter((i) => i.changeType === 'mismatch' || i.changeType === 'missing-in-migrated').length,
    contentChanged: items.filter((i) => i.changeType === 'content-changed').length,
    fixed: items.filter((i) => i.changeType === 'fixed').length,
    regressed: items.filter((i) => i.changeType === 'regressed').length,
    newIssues: items.filter((i) => i.changeType === 'new-in-migrated').length,
  };
}
