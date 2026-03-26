import type { Page } from 'playwright';
import type { SectionSnapshot } from '../types/index.js';
import { SECTION_IDS } from '../config.js';
import { getSectionSelector } from '../utils/playwright-helpers.js';

export async function inspectAllSections(
  page: Page,
  captureScreenshots: boolean = false,
  outputDir?: string
): Promise<SectionSnapshot[]> {
  const sections: SectionSnapshot[] = [];

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

  return sections;
}

async function inspectSection(
  page: Page,
  sectionId: string
): Promise<SectionSnapshot | null> {
  const selector = getSectionSelector(sectionId);
  const el = await page.$(selector);
  if (!el) return null;

  return page.$eval(selector, (section) => {
    const style = window.getComputedStyle(section);
    const rect = section.getBoundingClientRect();

    const allText = section.textContent?.trim() ?? '';
    const headings = Array.from(section.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map((h: Element) => h.textContent?.trim() ?? '');
    const imageCount = section.querySelectorAll('img').length;
    const linkCount = section.querySelectorAll('a[href]').length;
    const buttonCount = section.querySelectorAll('button, a.btn, a[class*="button"]').length;

    return {
      id: section.id,
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
  });
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
