import type { Page } from 'playwright';
import type { CTAInfo } from '../types/index.js';
import { SECTION_IDS } from '../config.js';

export async function collectAllCTAs(page: Page): Promise<CTAInfo[]> {
  return page.$$eval(
    'button, a.btn, a[class*="button"], a[class*="cta"], input[type="submit"]',
    (elements, sectionIds) => {
      function findSection(el: Element): string {
        let current: Element | null = el;
        while (current) {
          if (current.id && sectionIds.includes(current.id)) {
            return current.id;
          }
          current = current.parentElement;
        }
        return 'unknown';
      }

      function buildSelector(el: Element): string {
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
      }

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
    },
    [...SECTION_IDS] as string[]
  );
}
