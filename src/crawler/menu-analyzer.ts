import type { Page } from 'playwright';
import type { MenuSnapshot } from '../types/index.js';

export async function analyzeMenu(page: Page): Promise<MenuSnapshot> {
  const navExists = await page.$('#navigationContainer');
  if (!navExists) {
    return { items: [] };
  }

  const items = await page.$eval('#navigationContainer', (nav) => {
    const listItems = Array.from(nav.querySelectorAll('li'));

    if (listItems.length > 0) {
      const topLevelItems = listItems.filter((li) => {
        const parentUl = li.parentElement;
        if (!parentUl || parentUl.tagName !== 'UL') return false;
        const grandParent = parentUl.parentElement;
        return grandParent === nav ||
          grandParent?.id === 'navigationContainer' ||
          grandParent?.tagName === 'NAV' ||
          !grandParent?.closest('li');
      });

      return topLevelItems.map((li) => {
        const anchor = li.querySelector('a');
        const text = anchor?.textContent?.trim() || li.textContent?.trim()?.split('\n')[0]?.trim() || '';
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

    const directAnchors = Array.from(nav.querySelectorAll('a[href]'));
    return directAnchors.map((a) => ({
      text: a.textContent?.trim() || '',
      href: (a as HTMLAnchorElement).href || '',
      hasDropdown: false,
      hasDropdownArrow: false,
      subItems: [],
    }));
  });

  return {
    items: items.filter((item) => item.text.length > 0 && item.href.length > 0),
  };
}
