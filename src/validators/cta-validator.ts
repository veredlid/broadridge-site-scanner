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
  const el = await page.$(cta.elementSelector);
  if (!el) {
    return { ...cta, navigatesTo: null, navigationWorks: false };
  }

  const isVisible = await el.isVisible().catch(() => false);
  if (!isVisible) {
    return { ...cta, navigatesTo: null, navigationWorks: false };
  }

  // Strategy 1: If it's an anchor with href, validate the href directly
  // without clicking — this avoids DOM mutation entirely
  if (cta.type === 'link' && cta.href) {
    try {
      const res = await fetch(cta.href, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(THRESHOLDS.linkTimeout),
      });
      return {
        ...cta,
        navigatesTo: cta.href,
        destinationTitle: undefined,
        navigationWorks: res.status < 400,
        httpStatus: res.status,
      };
    } catch {
      return { ...cta, navigatesTo: cta.href, navigationWorks: false };
    }
  }

  // Strategy 2: For buttons/submits, use Playwright's native click
  // and intercept navigation via waitForNavigation or new tab events
  try {
    const navigationPromise = page.waitForURL(
      (url) => url.toString() !== currentUrl,
      { timeout: THRESHOLDS.ctaWaitMs }
    ).catch(() => null);

    const newPagePromise = page.context().waitForEvent('page', {
      timeout: THRESHOLDS.ctaWaitMs,
    }).catch(() => null);

    await el.click({ timeout: THRESHOLDS.ctaWaitMs });

    const [navResult, newPage] = await Promise.all([navigationPromise, newPagePromise]);

    // Case A: Click opened a new tab
    if (newPage) {
      await newPage.waitForLoadState('domcontentloaded').catch(() => {});
      const destinationUrl = newPage.url();
      const title = await newPage.title().catch(() => '');
      await newPage.close();

      return {
        ...cta,
        navigatesTo: destinationUrl,
        destinationTitle: title,
        navigationWorks:
          destinationUrl !== 'about:blank' &&
          !destinationUrl.includes('404') &&
          !destinationUrl.includes('error'),
      };
    }

    // Case B: Same-tab navigation occurred
    const newUrl = page.url();
    if (newUrl !== currentUrl) {
      const title = await page.title().catch(() => '');
      await page.goBack({ timeout: THRESHOLDS.pageTimeout }).catch(() =>
        page.goto(currentUrl, { waitUntil: 'domcontentloaded' })
      );

      return {
        ...cta,
        navigatesTo: newUrl,
        destinationTitle: title,
        navigationWorks: true,
      };
    }

    // Case C: No navigation — button may trigger in-page action (modal, accordion, etc.)
    return { ...cta, navigatesTo: null, navigationWorks: true };
  } catch {
    // Restore page state if click caused unexpected navigation
    if (page.url() !== currentUrl) {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    return { ...cta, navigatesTo: null, navigationWorks: false };
  }
}
