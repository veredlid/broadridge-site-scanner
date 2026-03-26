import type { Page } from 'playwright';
import type { CTAInfo, CTAValidationResult } from '../types/index.js';
import { THRESHOLDS } from '../config.js';

export async function validateCTAs(
  page: Page,
  ctas: CTAInfo[]
): Promise<CTAValidationResult[]> {
  const results: CTAValidationResult[] = [];
  const visibleCTAs = ctas.filter((c) => c.isVisible);

  for (const cta of visibleCTAs) {
    const result = await validateSingleCTA(page, cta);
    results.push(result);
  }

  return results;
}

async function validateSingleCTA(
  page: Page,
  cta: CTAInfo
): Promise<CTAValidationResult> {
  const currentUrl = page.url();

  try {
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page', { timeout: THRESHOLDS.ctaWaitMs }),
      page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el) {
          const clone = el.cloneNode(true) as HTMLElement;
          clone.setAttribute('target', '_blank');
          el.parentNode?.replaceChild(clone, el);
          (clone as HTMLElement).click();
        }
      }, cta.elementSelector),
    ]).catch(() => [null]);

    if (newPage) {
      await newPage.waitForLoadState('domcontentloaded').catch(() => {});
      const destinationUrl = newPage.url();
      const title = await newPage.title();
      await newPage.close();

      return {
        ...cta,
        navigatesTo: destinationUrl,
        destinationTitle: title,
        navigationWorks:
          !destinationUrl.includes('404') &&
          !destinationUrl.includes('error') &&
          destinationUrl !== 'about:blank',
      };
    }
  } catch {
    // New tab approach failed, try direct click
  }

  try {
    await page.click(cta.elementSelector, { timeout: THRESHOLDS.ctaWaitMs });
    await page.waitForTimeout(THRESHOLDS.ctaWaitMs);
    const newUrl = page.url();

    const result: CTAValidationResult = {
      ...cta,
      navigatesTo: newUrl !== currentUrl ? newUrl : null,
      navigationWorks: newUrl !== currentUrl,
    };

    if (newUrl !== currentUrl) {
      await page.goBack().catch(() => {
        return page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
      });
    }

    return result;
  } catch {
    return {
      ...cta,
      navigatesTo: null,
      navigationWorks: false,
    };
  }
}
