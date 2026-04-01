import type { Page } from 'playwright';
import type { SectionSnapshot } from '../types/index.js';
import { SECTION_IDS } from '../config.js';
import { getSectionSelector } from '../utils/playwright-helpers.js';

/**
 * Semantic section detection: maps HTML5/ARIA landmarks to BR section IDs.
 * Used as a fallback when a site (e.g. Wix-hosted migration) doesn't use
 * Broadridge's specific section IDs.
 *
 * Priority within each bucket: first matching selector wins.
 */
const SEMANTIC_SECTION_MAP: Array<{
  brId: string;
  selectors: string[];
}> = [
  {
    brId: 'headerContainer',
    selectors: [
      'header',
      '[role="banner"]',
      '[data-testid*="header"]',
      '[data-hook*="header"]',
    ],
  },
  {
    brId: 'navigationContainer',
    selectors: [
      'header nav',
      'nav',
      '[role="navigation"]',
    ],
  },
  {
    brId: 'heroContainer',
    selectors: [
      '[class*="hero" i]',
      '[data-testid*="hero"]',
      // First large <section> is usually the hero on Wix sites
      'section:first-of-type',
      'main > section:first-child',
      'main > div:first-child',
    ],
  },
  {
    brId: 'mapContainer',
    selectors: [
      '[class*="map" i]',
      'iframe[src*="google.com/maps"]',
      '[data-testid*="map"]',
    ],
  },
  {
    brId: 'footerContainer',
    selectors: [
      'footer',
      '[role="contentinfo"]',
      '[data-testid*="footer"]',
      '[data-hook*="footer"]',
      '[class*="footer" i]',
    ],
  },
  {
    brId: 'contentContainer',
    selectors: [
      'main',
      '[role="main"]',
    ],
  },
];

export async function inspectAllSections(
  page: Page,
  captureScreenshots: boolean = false,
  outputDir?: string
): Promise<SectionSnapshot[]> {
  // Count how many BR-specific section IDs actually exist on this page
  let brSectionsFound = 0;
  for (const sectionId of SECTION_IDS) {
    const el = await page.$(`#${sectionId}`);
    if (el) brSectionsFound++;
  }

  // If fewer than 2 BR IDs found, this is a Wix/generic site —
  // use semantic detection so sections are identified regardless of HTML structure
  const useSemanticFallback = brSectionsFound < 2;

  const sections: SectionSnapshot[] = [];

  if (useSemanticFallback) {
    const detectedIds = new Set<string>();

    for (const { brId, selectors } of SEMANTIC_SECTION_MAP) {
      let snapshot: SectionSnapshot | null = null;

      for (const sel of selectors) {
        try {
          snapshot = await inspectSectionBySelector(page, sel, brId);
          if (snapshot?.isPresent) break;
        } catch {
          // selector may not be supported — try next
        }
      }

      if (!detectedIds.has(brId)) {
        const entry = snapshot ?? createEmptySection(brId);

        if (captureScreenshots && outputDir && entry.isPresent) {
          for (const sel of selectors) {
            const el = await page.$(sel).catch(() => null);
            if (el) {
              const path = `${outputDir}/${brId}.png`;
              await el.screenshot({ path }).catch(() => {});
              entry.screenshot = path;
              break;
            }
          }
        }

        sections.push(entry);
        detectedIds.add(brId);
      }
    }

    // Pad with absent entries for any BR IDs not in the semantic map
    for (const sectionId of SECTION_IDS) {
      if (!detectedIds.has(sectionId)) {
        sections.push(createEmptySection(sectionId));
      }
    }
  } else {
    // BR mode: standard section ID selectors
    for (const sectionId of SECTION_IDS) {
      const snapshot = await inspectSection(page, sectionId);
      if (snapshot && captureScreenshots && outputDir) {
        const el = await page.$(getSectionSelector(sectionId));
        if (el) {
          const path = `${outputDir}/${sectionId}.png`;
          await el.screenshot({ path }).catch(() => {});
          snapshot.screenshot = path;
        }
      }
      sections.push(snapshot ?? createEmptySection(sectionId));
    }
  }

  return sections;
}

/**
 * Inspect a section using an arbitrary CSS selector, assigning a logical BR-style ID.
 * Used in semantic fallback mode for non-BR sites.
 */
async function inspectSectionBySelector(
  page: Page,
  selector: string,
  logicalId: string
): Promise<SectionSnapshot | null> {
  const el = await page.$(selector).catch(() => null);
  if (!el) return null;

  try {
    // NOTE: Use page.evaluate() + document.querySelector() — NOT page.$eval() — to avoid
    // a tsx/esbuild serialisation bug where named functions get __name-wrapped and the browser
    // context throws "ReferenceError: __name is not defined".
    return await page.evaluate(({ sel, id }: { sel: string; id: string }) => {
      const section = document.querySelector(sel);
      if (!section) return null;

      const style = window.getComputedStyle(section);
      const rect = section.getBoundingClientRect();

      const allText = section.textContent?.trim() ?? '';
      const headings = Array.from(section.querySelectorAll('h1, h2, h3, h4, h5, h6'))
        .map((h) => h.textContent?.trim() ?? '');
      const imageCount = section.querySelectorAll('img').length;
      const linkCount = section.querySelectorAll('a[href]').length;
      const buttonCount = section.querySelectorAll('button, a.btn, a[class*="button"]').length;

      return {
        id,                           // Use the logical BR-style ID, not the DOM element's ID
        isPresent: true,
        isVisible: style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0,
        backgroundColor: style.backgroundColor,
        textColor: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        boundingBox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        textContent: allText.substring(0, 500),
        headings,
        imageCount,
        linkCount,
        buttonCount,
      };
    }, { sel: selector, id: logicalId });
  } catch {
    return null;
  }
}

async function inspectSection(
  page: Page,
  sectionId: string
): Promise<SectionSnapshot | null> {
  const selector = getSectionSelector(sectionId);
  const el = await page.$(selector);
  if (!el) return null;

  // NOTE: Use page.evaluate() + document.querySelector() — NOT page.$eval() — to avoid
  // a tsx/esbuild serialisation bug where named functions get __name-wrapped and the browser
  // context throws "ReferenceError: __name is not defined".
  return page.evaluate(({ sel }: { sel: string }) => {
    const section = document.querySelector(sel);
    if (!section) return null;

    const style = window.getComputedStyle(section);
    const rect = section.getBoundingClientRect();

    const allText = section.textContent?.trim() ?? '';
    const headings = Array.from(section.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map((h: Element) => h.textContent?.trim() ?? '');
    const imageCount = section.querySelectorAll('img').length;
    const linkCount = section.querySelectorAll('a[href]').length;
    const buttonCount = section.querySelectorAll('button, a.btn, a[class*="button"]').length;

    return {
      id: (section as HTMLElement).id,
      isPresent: true,
      isVisible: style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0,
      backgroundColor: style.backgroundColor,
      textColor: style.color,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      textContent: allText.substring(0, 500),
      headings,
      imageCount,
      linkCount,
      buttonCount,
    };
  }, { sel: selector });
}

function createEmptySection(sectionId: string): SectionSnapshot {
  return {
    id: sectionId,
    isPresent: false,
    isVisible: false,
    backgroundColor: '',
    textColor: '',
    fontFamily: '',
    fontSize: '',
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    paddingTop: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    paddingRight: '0px',
    textContent: '',
    headings: [],
    imageCount: 0,
    linkCount: 0,
    buttonCount: 0,
  };
}
