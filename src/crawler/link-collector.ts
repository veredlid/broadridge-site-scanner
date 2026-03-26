import type { Page } from 'playwright';
import type { LinkInfo } from '../types/index.js';
import { SECTION_IDS } from '../config.js';

export async function collectAllLinks(page: Page): Promise<LinkInfo[]> {
  const hostname = new URL(page.url()).hostname;

  return page.$$eval(
    'a[href]',
    (anchors, args) => {
      const { hostname, sectionIds } = args;

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
      }

      return (anchors as HTMLAnchorElement[]).map((a) => ({
        text: a.textContent?.trim() || '',
        href: a.href,
        target: (a.target || '_self') as '_blank' | '_self' | '',
        httpStatus: null,
        isExternal: !a.href.includes(hostname),
        location: findSection(a),
        elementSelector: buildSelector(a),
      }));
    },
    { hostname, sectionIds: [...SECTION_IDS] as string[] }
  );
}
