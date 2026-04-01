import type { Page } from 'playwright';
import type { MenuSnapshot } from '../types/index.js';

/**
 * Priority-ordered selectors to locate the navigation container.
 * BR original sites use #navigationContainer; Wix and other sites
 * use standard HTML5 <nav> or ARIA roles.
 */
const NAV_CONTAINER_SELECTORS = [
  '#navigationContainer',
  'header nav',
  'nav',
  '[role="navigation"]',
];

export async function analyzeMenu(page: Page): Promise<MenuSnapshot> {
  // Find the first nav container that exists on the page
  let navSelector: string | null = null;
  for (const sel of NAV_CONTAINER_SELECTORS) {
    const el = await page.$(sel);
    if (el) {
      navSelector = sel;
      break;
    }
  }

  if (!navSelector) {
    return { items: [] };
  }

  // Detect whether this is a Wix horizontal menu (uses data-part attributes)
  const isWixMenu = await page.$(`${navSelector} [class*="wixui-horizontal-menu"], ${navSelector} a[data-part="dropdown-item"]`) !== null;

  let items: MenuSnapshot['items'];

  if (isWixMenu) {
    items = await extractWixMenu(page, navSelector);
  } else {
    items = await extractBrMenu(page, navSelector);
  }

  return {
    items: items.filter((item) => item.text.length > 0),
  };
}

/**
 * Extract menu from Wix's wixui-horizontal-menu component.
 *
 * Wix uses:
 *  - Top-level items: <li> with a button[aria-label="More X pages"] for dropdowns,
 *    or a direct <a data-testid="linkElement"> for simple pages.
 *  - Sub-items: <a data-part="dropdown-item"> inside the same <li>.
 *
 * The parent item's text is NOT from querySelector('a') (which picks up the first
 * sub-item), but from the button's aria-label: "More Client Access pages" → "Client Access".
 */
async function extractWixMenu(page: Page, navSelector: string): Promise<MenuSnapshot['items']> {
  // NOTE: Use page.evaluate() + document.querySelectorAll() — NOT page.$$eval() — to avoid
  // a tsx/esbuild serialisation bug where named functions get __name-wrapped and the browser
  // context throws "ReferenceError: __name is not defined".
  return page.evaluate(({ sel }: { sel: string }) => {
    const listItems = Array.from(document.querySelectorAll(sel)) as HTMLLIElement[];
    return listItems.map((li) => {
      const dropdownBtn = li.querySelector('button[aria-label]');
      const isDropdown = !!dropdownBtn;

      let text = '';
      let href = '';

      if (isDropdown) {
        // Extract name from "More Client Access pages" → "Client Access"
        const ariaLabel = dropdownBtn!.getAttribute('aria-label') ?? '';
        text = ariaLabel.replace(/^More\s+/i, '').replace(/\s+pages$/i, '').trim();
        // The parent item may or may not have its own page — use '#' if not
        const parentLink = li.querySelector<HTMLAnchorElement>(
          '[data-part="menu-item"] a, [data-part="menu-item-content"] a[href]:not([href="#"])'
        );
        href = parentLink?.href ?? '#';
      } else {
        // Simple item — direct link
        const link = li.querySelector<HTMLAnchorElement>('a[href]');
        text = link?.textContent?.trim() ?? '';
        href = link?.href ?? '';
      }

      // Sub-items: deduplicate by href
      const seen = new Set<string>();
      const subItems = Array.from(li.querySelectorAll<HTMLAnchorElement>('a[data-part="dropdown-item"]'))
        .filter((a) => {
          const h = a.href;
          if (!h || seen.has(h)) return false;
          seen.add(h);
          return true;
        })
        .map((a) => ({
          text: a.textContent?.trim() ?? '',
          href: a.href,
        }));

      return {
        text,
        href,
        hasDropdown: subItems.length > 0,
        hasDropdownArrow: isDropdown,
        subItems,
      };
    });
  }, { sel: `${navSelector} > ul > li` });
}

/**
 * Extract menu from a standard BR-style nav (ul > li structure).
 * This is the original logic, preserved for BR original sites.
 */
async function extractBrMenu(page: Page, navSelector: string): Promise<MenuSnapshot['items']> {
  // NOTE: Use page.evaluate() + document.querySelector() — NOT page.$eval() — to avoid
  // a tsx/esbuild serialisation bug where named functions get __name-wrapped and the browser
  // context throws "ReferenceError: __name is not defined".
  const items = await page.evaluate(({ sel }: { sel: string }) => {
    const nav = document.querySelector(sel);
    if (!nav) return [];

    const listItems = Array.from(nav.querySelectorAll('li'));

    if (listItems.length > 0) {
      const topLevelItems = listItems.filter((li) => {
        const parentUl = li.parentElement;
        if (!parentUl || parentUl.tagName !== 'UL') return false;
        const grandParent = parentUl.parentElement;
        return (
          grandParent === nav ||
          grandParent?.id === 'navigationContainer' ||
          grandParent?.tagName === 'NAV' ||
          !grandParent?.closest('li')
        );
      });

      return topLevelItems.map((li) => {
        const anchor = li.querySelector('a');
        const text =
          anchor?.textContent?.trim() ||
          li.textContent?.trim()?.split('\n')[0]?.trim() ||
          '';
        const href = anchor?.href || '';

        const subMenu = li.querySelector('ul');
        const subItems = subMenu
          ? Array.from(subMenu.querySelectorAll('li a')).map((subA) => ({
              text: subA.textContent?.trim() || '',
              href: (subA as HTMLAnchorElement).href || '',
            }))
          : [];

        const hasDropdown = subItems.length > 0;
        const hasDropdownArrow =
          li.querySelector('.caret, .arrow, [class*="dropdown"], [class*="sub-arrow"]') !== null;

        return { text, href, hasDropdown, hasDropdownArrow, subItems };
      });
    }

    // Fallback: no <li> structure — collect direct anchors
    const directAnchors = Array.from(nav.querySelectorAll('a[href]'));
    return directAnchors.map((a) => ({
      text: a.textContent?.trim() || '',
      href: (a as HTMLAnchorElement).href || '',
      hasDropdown: false,
      hasDropdownArrow: false,
      subItems: [],
    }));
  }, { sel: navSelector });

  return items.filter((item) => item.text.length > 0 && item.href.length > 0);
}
