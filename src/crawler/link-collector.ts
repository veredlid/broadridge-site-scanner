import type { Page } from 'playwright';
import type { LinkInfo } from '../types/index.js';
import { SECTION_IDS } from '../config.js';

/**
 * Hover over nav/dropdown triggers so CSS hover-states reveal their hidden
 * child links before we collect the DOM. This captures:
 *   • BR footer service grids (Annuity, LTC, etc.) that slide in on hover
 *   • Wix mega-menu sub-items that only render when parent is hovered
 *
 * We keep the timeout short (150 ms per item, capped at 20 elements) so the
 * total overhead stays under ~3 s per page.
 */
async function triggerHoverMenus(page: Page): Promise<void> {
  const selectors = [
    // Standard nav patterns
    'nav > ul > li',
    'nav li',
    'header li',
    // BR-specific patterns
    '[id*="nav"] li',
    '[id*="menu"] li',
    '[class*="nav"] > li',
    '[class*="menu"] > li',
    // ARIA
    '[role="menuitem"]',
    '[role="menu"] > *',
  ];

  const seen = new Set<string>();
  for (const sel of selectors) {
    try {
      const elements = await page.$$(sel);
      for (const el of elements.slice(0, 20)) {
        try {
          // Use a stable selector as dedup key
          const key = await el.evaluate((e) => e.tagName + (e.id ? '#' + e.id : '') + e.className);
          if (seen.has(key)) continue;
          seen.add(key);

          await el.hover({ timeout: 1500, force: true });
          // Give CSS transitions time to finish
          await page.waitForTimeout(150);
        } catch {
          // Element might be detached or off-screen — skip silently
        }
      }
    } catch {
      // Selector might not exist on this page
    }
  }
}

export async function collectAllLinks(page: Page): Promise<LinkInfo[]> {
  const hostname = new URL(page.url()).hostname;

  // Trigger hover states so dropdown/hover-revealed links are present in the DOM
  await triggerHoverMenus(page);

  // NOTE: Use page.evaluate() + document.querySelectorAll() — NOT page.$$eval() — to avoid
  // a tsx/esbuild serialisation bug where named functions get __name-wrapped and the browser
  // context throws "ReferenceError: __name is not defined".
  return page.evaluate(({ sel, hostname, sectionIds }: { sel: string; hostname: string; sectionIds: string[] }) => {
    const anchors = Array.from(document.querySelectorAll(sel)) as HTMLAnchorElement[];

    const findSection = (el: Element): string => {
      // Pass 1: look for a parent with a known BR section ID
      let current: Element | null = el;
      while (current) {
        if (current.id && sectionIds.includes(current.id)) {
          return current.id;
        }
        current = current.parentElement;
      }

      // Pass 2: semantic HTML5 / ARIA fallback (covers Wix and other non-BR sites)
      current = el;
      while (current && current !== document.body) {
        const tag = current.tagName?.toLowerCase();
        const role = current.getAttribute('role');
        if (tag === 'header' || role === 'banner') return 'header';
        if (tag === 'footer' || role === 'contentinfo') return 'footer';
        if (tag === 'nav' || role === 'navigation') return 'nav';
        if (tag === 'main' || role === 'main') return 'main';
        if (tag === 'aside' || role === 'complementary') return 'aside';
        // Wix uses data-testid on landmark containers
        const testId = current.getAttribute('data-testid') || current.getAttribute('data-hook');
        if (testId) return testId;
        current = current.parentElement;
      }

      return 'unknown';
    };

    const buildSelector = (el: Element): string => {
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector += `#${current.id}`;
          parts.unshift(selector);
          break;
        }
        if (current.className && typeof current.className === 'string') {
          const cls = current.className.trim().split(/\s+/).slice(0, 2).join('.');
          if (cls) selector += `.${cls}`;
        }
        parts.unshift(selector);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };

    return anchors.map((a) => ({
      // Use aria-label / title as fallback for icon-only links (social media buttons etc.)
      text: a.textContent?.trim() || a.getAttribute('aria-label') || a.getAttribute('title') || '',
      href: a.href,
      target: (a.target || '_self') as '_blank' | '_self' | '',
      httpStatus: null,
      isExternal: !a.href.includes(hostname),
      location: findSection(a),
      elementSelector: buildSelector(a),
    }));
  }, { sel: 'a[href]', hostname, sectionIds: [...SECTION_IDS] as string[] });
}
