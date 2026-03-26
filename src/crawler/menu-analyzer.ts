import type { Page } from 'playwright';
import type { MenuSnapshot, MenuItemInfo } from '../types/index.js';

export async function analyzeMenu(page: Page): Promise<MenuSnapshot> {
  const items = await page.$$eval(
    '#navigationContainer .nav-1st-level > ul > li, #navigationContainer nav > ul > li, #navigationContainer ul[role="menu"] > li',
    (menuItems) => {
      return menuItems.map((li) => {
        const anchor = li.querySelector('a');
        const text = anchor?.textContent?.trim() || li.textContent?.trim()?.split('\n')[0] || '';
        const href = anchor?.href || '';

        const subMenu = li.querySelector('ul');
        const subItems = subMenu
          ? Array.from(subMenu.querySelectorAll('li a')).map((subA: Element) => ({
              text: subA.textContent?.trim() || '',
              href: (subA as HTMLAnchorElement).href || '',
            }))
          : [];

        const hasDropdown = subItems.length > 0;
        const hasDropdownArrow =
          li.querySelector('.caret, .arrow, [class*="dropdown-arrow"], [class*="sub-arrow"]') !== null ||
          (anchor?.querySelector('svg, .icon') !== null && hasDropdown);

        return {
          text,
          href,
          hasDropdown,
          hasDropdownArrow,
          subItems,
        };
      });
    }
  );

  return { items: items.filter((item) => item.text.length > 0) };
}
