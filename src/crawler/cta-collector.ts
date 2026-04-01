import type { Page } from 'playwright';
import type { CTAInfo } from '../types/index.js';
import { SECTION_IDS } from '../config.js';

export async function collectAllCTAs(page: Page): Promise<CTAInfo[]> {
  // NOTE: Use page.evaluate() + document.querySelectorAll() — NOT page.$$eval() — to avoid
  // a tsx/esbuild serialisation bug where named functions get __name-wrapped and the browser
  // context throws "ReferenceError: __name is not defined".
  return page.evaluate(({ sel, sectionIds }: { sel: string; sectionIds: string[] }) => {
    const elements = Array.from(document.querySelectorAll(sel));

    const findSection = (el: Element): string => {
      let current: Element | null = el;
      while (current) {
        if (current.id && sectionIds.includes(current.id)) {
          return current.id;
        }
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
          parts.unshift(`${selector}#${current.id}`);
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

    return elements.map((el) => {
      const tag = el.tagName.toLowerCase();
      const isAnchor = tag === 'a';
      const isSubmit = tag === 'input' && (el as HTMLInputElement).type === 'submit';
      const style = window.getComputedStyle(el);

      return {
        text: el.textContent?.trim() || (el as HTMLInputElement).value || '',
        type: (isSubmit ? 'submit' : isAnchor ? 'link' : 'button') as 'button' | 'link' | 'submit',
        href: isAnchor ? (el as HTMLAnchorElement).href : null,
        navigatesTo: null,
        httpStatus: null,
        section: findSection(el),
        isVisible: style.display !== 'none' && style.visibility !== 'hidden',
        elementSelector: buildSelector(el),
      };
    });
  }, { sel: 'button, a.btn, a[class*="button"], a[class*="cta"], input[type="submit"]', sectionIds: [...SECTION_IDS] as string[] });
}

/**
 * Detects whether the page has a visible print button/link.
 * BR sites typically have a "Print" text link or a button with onclick="window.print()".
 * Checks for:
 *  - Any element with onclick/href containing "print"
 *  - Any visible button/link whose text is "Print" (case-insensitive)
 *  - Common print icon classes (fa-print, icon-print, etc.)
 */
export async function detectPrintButton(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const allClickable = Array.from(document.querySelectorAll(
      'a, button, [onclick], [class*="print"]'
    ));

    return allClickable.some((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;

      const text    = (el.textContent?.trim() ?? '').toLowerCase();
      const href    = (el as HTMLAnchorElement).href ?? '';
      const onclick = el.getAttribute('onclick') ?? '';
      const cls     = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';

      return (
        text === 'print' ||
        text.startsWith('print ') ||
        href.toLowerCase().includes('javascript:window.print') ||
        href.toLowerCase().includes('javascript:print') ||
        onclick.toLowerCase().includes('window.print') ||
        cls.includes('print')
      );
    });
  });
}

/**
 * Detects whether the page has a visible back-to-top button/link.
 * BR/Wix article pages typically place a "Back to top" or "↑" anchor at the bottom
 * that scrolls the user to the page header. Missing on migrated = regression.
 * Checks for:
 *  - Links with href="#top", href="#", href="#header" etc.
 *  - Buttons/links whose text matches "back to top", "return to top", "↑", "▲"
 *  - Elements with onclick containing "scrollTo(0" or "scrollTop"
 *  - Common back-to-top class names
 */
export async function detectBackToTopButton(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const allClickable = Array.from(document.querySelectorAll(
      'a, button, [onclick], [class*="back-to-top"], [class*="backtotop"], [class*="scroll-top"]'
    ));

    return allClickable.some((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;

      const text    = (el.textContent?.trim() ?? '').toLowerCase();
      const href    = ((el as HTMLAnchorElement).href ?? '').toLowerCase();
      const onclick = (el.getAttribute('onclick') ?? '').toLowerCase();
      const cls     = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
      const ariaLabel = (el.getAttribute('aria-label') ?? '').toLowerCase();

      const backToTopTexts = ['back to top', 'return to top', 'scroll to top', 'go to top', '↑', '▲', 'top'];

      return (
        backToTopTexts.some(t => text === t || ariaLabel.includes(t)) ||
        href === '#top' || href.endsWith('#top') || href === '#header' || href === '#' ||
        href.endsWith('#page-top') || href.endsWith('#pagetop') ||
        onclick.includes('scrollto(0') || onclick.includes('scrolltop') ||
        cls.includes('back-to-top') || cls.includes('backtotop') || cls.includes('scroll-top')
      );
    });
  });
}
