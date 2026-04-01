import { chromium, type Page, type BrowserContext, type Browser } from 'playwright';
import { VIEWPORTS, SUB_ELEMENT_SELECTORS } from '../config.js';
import type { ViewportName } from '../types/index.js';

// Long-lived headless browser — shared across concurrent background scans.
let _browser: Browser | null = null;

// Separate instance for headed (visible) debug sessions — never shared.
let _headedBrowser: Browser | null = null;

export async function getBrowser(headed = false, slowMo = 0): Promise<Browser> {
  if (headed) {
    // Always use a fresh dedicated browser for debug sessions.
    if (_headedBrowser && _headedBrowser.isConnected()) {
      return _headedBrowser;
    }
    _headedBrowser = await chromium.launch({
      headless: false,
      slowMo: slowMo > 0 ? slowMo : 400, // default 400 ms so actions are visible
    });
    return _headedBrowser;
  }

  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  return _browser;
}

export async function closeHeadedBrowser(): Promise<void> {
  if (_headedBrowser) {
    await _headedBrowser.close().catch(() => {});
    _headedBrowser = null;
  }
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

/**
 * JavaScript injected into every headed-mode page so the cursor is
 * clearly visible in screen recordings. Draws a red-orange ring that
 * follows the mouse and pulses on click.
 */
const CURSOR_OVERLAY_SCRIPT = `
(function () {
  const ring = document.createElement('div');
  ring.id = '__br-cursor-ring__';
  Object.assign(ring.style, {
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    background: 'rgba(255, 80, 0, 0.25)',
    border: '2.5px solid rgba(255, 80, 0, 0.9)',
    boxShadow: '0 0 6px 2px rgba(255,80,0,0.45)',
    transform: 'translate(-50%, -50%)',
    transition: 'transform 0.12s ease, background 0.12s ease',
    left: '-100px',
    top: '-100px',
  });

  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'absolute',
    top: '50%', left: '50%',
    width: '5px', height: '5px',
    borderRadius: '50%',
    background: 'rgba(255,80,0,0.9)',
    transform: 'translate(-50%, -50%)',
  });
  ring.appendChild(dot);

  function mount() {
    if (!document.getElementById('__br-cursor-ring__') && document.body) {
      document.body.appendChild(ring);
    }
  }

  if (document.body) { mount(); }
  else { document.addEventListener('DOMContentLoaded', mount); }

  document.addEventListener('mousemove', (e) => {
    ring.style.left = e.clientX + 'px';
    ring.style.top  = e.clientY + 'px';
  }, { passive: true });

  document.addEventListener('mousedown', () => {
    ring.style.transform = 'translate(-50%, -50%) scale(1.9)';
    ring.style.background = 'rgba(255, 80, 0, 0.55)';
  }, { passive: true });

  document.addEventListener('mouseup', () => {
    ring.style.transform = 'translate(-50%, -50%) scale(1)';
    ring.style.background = 'rgba(255, 80, 0, 0.25)';
  }, { passive: true });
})();
`;

// Real Chrome 124 UA — avoids "HeadlessChrome" string that triggers bot-detection on Wix/Cloudflare sites
const REAL_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function createPage(
  viewport: ViewportName = 'desktop',
  headed = false,
  slowMo = 0
): Promise<{ context: BrowserContext; page: Page }> {
  const browser = await getBrowser(headed, slowMo);
  const vp = VIEWPORTS[viewport];
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: vp.width, height: vp.height },
    userAgent: REAL_USER_AGENT,
    // Mimic a real browser locale / timezone to further avoid bot fingerprinting
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // Disable WebRTC leak that reveals headless Chrome
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  // Stealth patches — mimic a real Chrome browser so Cloudflare/Wix bot detection doesn't block us
  await context.addInitScript(() => {
    // 1. navigator.webdriver — the most obvious headless tell
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 2. window.chrome — real Chrome always has this; headless Chrome does not
    if (!(window as any).chrome) {
      (window as any).chrome = {
        runtime: {
          id: undefined,
          connect: () => {},
          sendMessage: () => {},
        },
        loadTimes: () => ({}),
        csi: () => ({}),
        app: {},
      };
    }

    // 3. navigator.plugins — empty in headless, real browsers have PDF viewer etc.
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
          ];
          return Object.assign(plugins, { item: (i: number) => plugins[i], namedItem: (n: string) => plugins.find(p => p.name === n) || null, refresh: () => {} });
        },
      });
    }

    // 4. navigator.languages — headless Chrome may omit this
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    }

    // 5. navigator.permissions — headless Chrome returns 'denied' for notifications; real Chrome returns 'default'
    const originalQuery = window.navigator.permissions?.query?.bind(navigator.permissions);
    if (originalQuery) {
      (navigator.permissions as any).query = (params: any) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: 'default', onchange: null } as any)
          : originalQuery(params);
    }
  });

  // In headed mode, inject a visible cursor ring so it shows up in screen recordings
  if (headed) {
    await context.addInitScript(CURSOR_OVERLAY_SCRIPT);
  }

  const page = await context.newPage();
  return { context, page };
}

export async function openPage(
  domain: string,
  path: string = '/',
  viewport: ViewportName = 'desktop',
  timeout: number = 30_000,
  headed = false,
  slowMo = 0
): Promise<{ context: BrowserContext; page: Page }> {
  const { context, page } = await createPage(viewport, headed, slowMo);
  const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
  const fullUrl = path === '/' ? baseUrl : `${baseUrl}${path}`;

  // Use a generous effective timeout — Wix preview sites can be slow on cold start.
  const effectiveTimeout = Math.max(timeout, 60_000);

  const urls = [fullUrl];
  const hasHttpsFallback = fullUrl.startsWith('https://');
  if (hasHttpsFallback) urls.push(fullUrl.replace('https://', 'http://'));

  const RETRYABLE_ERRORS = ['ERR_NETWORK_CHANGED', 'ERR_CONNECTION_RESET', 'ERR_TIMED_OUT', 'ERR_NAME_NOT_RESOLVED'];
  const MAX_RETRIES = 3;

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await page.waitForTimeout(2_000 * attempt);
    }

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const isLastAttempt = i === urls.length - 1;
      // Give HTTPS the full timeout — ignoreHTTPSErrors handles cert issues,
      // and VPN-routed sites can take 15-20s for the TLS handshake alone.
      const attemptTimeout = effectiveTimeout;

      try {
        await page.goto(url, { waitUntil: 'commit', timeout: attemptTimeout });
        await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});

        const pageTitle = await page.title().catch(() => '');
        const bodyText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '');
        const isRateLimited =
          pageTitle.includes('1015') ||
          pageTitle.toLowerCase().includes('rate limit') ||
          pageTitle.toLowerCase().includes('just a moment') ||
          bodyText.includes('Ray ID:') ||
          bodyText.includes('error code: 1015') ||
          (await page.locator('text=You are being rate limited').count().catch(() => 0)) > 0;

        if (isRateLimited) {
          await page.waitForTimeout(8_000);
          await page.goto(url, { waitUntil: 'commit', timeout: effectiveTimeout });
          await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
          const retryTitle = await page.title().catch(() => '');
          const retryBody = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '');
          if (
            retryTitle.includes('1015') ||
            retryTitle.toLowerCase().includes('rate limit') ||
            retryBody.includes('Ray ID:') ||
            retryBody.includes('error code: 1015')
          ) {
            throw new Error(`Cloudflare rate limited (1015) — site is temporarily blocking scans. Try again in a few minutes.`);
          }
        }

        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!lastError) break;

    const errMsg = (lastError as Error).message ?? '';
    const isRetryable = RETRYABLE_ERRORS.some((e) => errMsg.includes(e));
    if (!isRetryable) break;
  }
  if (lastError) throw lastError;

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
