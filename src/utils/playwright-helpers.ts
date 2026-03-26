import { chromium, type Page, type BrowserContext, type Browser } from 'playwright';
import { VIEWPORTS, SUB_ELEMENT_SELECTORS } from '../config.js';
import type { ViewportName } from '../types/index.js';

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

export async function createPage(
  viewport: ViewportName = 'desktop'
): Promise<{ context: BrowserContext; page: Page }> {
  const browser = await getBrowser();
  const vp = VIEWPORTS[viewport];
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: vp.width, height: vp.height },
  });
  const page = await context.newPage();
  return { context, page };
}

export async function openPage(
  domain: string,
  path: string = '/',
  viewport: ViewportName = 'desktop',
  timeout: number = 30_000
): Promise<{ context: BrowserContext; page: Page }> {
  const { context, page } = await createPage(viewport);
  const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
  const fullUrl = path === '/' ? baseUrl : `${baseUrl}${path}`;

  try {
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout });
  } catch {
    const httpUrl = fullUrl.replace('https://', 'http://');
    await page.goto(httpUrl, { waitUntil: 'domcontentloaded', timeout });
  }

  await handleDisclaimer(page);
  await handleSplashPage(page);

  return { context, page };
}

async function handleDisclaimer(page: Page): Promise<void> {
  const disclaimer = await page.$(SUB_ELEMENT_SELECTORS.disclaimer);
  if (disclaimer) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click(SUB_ELEMENT_SELECTORS.disclaimerAccept).catch(() => {}),
    ]);
  }
}

async function handleSplashPage(page: Page): Promise<void> {
  const splash = await page.$(SUB_ELEMENT_SELECTORS.splashPage);
  if (splash) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click(SUB_ELEMENT_SELECTORS.splashSkip).catch(() => {}),
    ]);
  }
}

export async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.documentElement.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  });
}

export async function waitForFullLoad(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await scrollToBottom(page);
  await page.waitForTimeout(500);
}

export function getSectionSelector(sectionId: string): string {
  return `#${sectionId}`;
}
