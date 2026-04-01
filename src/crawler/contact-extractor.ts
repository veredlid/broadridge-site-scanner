import type { Page } from 'playwright';
import type { ContactInfo } from '../types/index.js';

const PHONE_REGEX = /(\+?[\d][\d\s\-().]{7,}\d)/;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.]+/;

// Ordered list of selectors to try per section — VB-specific IDs first, then generic HTML5
const SECTION_SELECTORS: Array<{ location: string; selectors: string[] }> = [
  {
    location: 'header',
    selectors: ['#headerContainer', 'header', '[class*="header"]'],
  },
  {
    location: 'footer',
    selectors: ['#footerContainer', 'footer', '[class*="footer"]'],
  },
  {
    location: 'main',
    selectors: ['#contentContainer', 'main', '[class*="content"]'],
  },
  {
    location: 'map',
    selectors: ['#mapContainer', '[class*="map"]', '[class*="location"]'],
  },
];

export async function extractContactInfo(page: Page): Promise<ContactInfo[]> {
  // Gather all tel: and mailto: links from the full page first.
  // NOTE: Use page.evaluate() + document.querySelectorAll() — NOT page.$$eval() — to avoid
  // a tsx/esbuild serialisation bug where named functions get __name-wrapped and the browser
  // context throws "ReferenceError: __name is not defined".
  const allContactLinks = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]')) as HTMLAnchorElement[];
    return anchors.map((a) => ({
      href: a.href,
      section: (() => {
        let el: Element | null = a;
        while (el) {
          const tag = el.tagName;
          if (tag === 'HEADER' || tag === 'FOOTER' || tag === 'MAIN' || tag === 'NAV') {
            return tag.toLowerCase();
          }
          el = el.parentElement;
        }
        return 'page';
      })(),
    }));
  }).catch(() => [] as { href: string; section: string }[]);

  const phoneLinks = allContactLinks
    .filter((l) => l.href.startsWith('tel:'))
    .map((l) => l.href.replace('tel:', '').replace(/\s+/g, '').trim());
  const emailLinks = allContactLinks
    .filter((l) => l.href.startsWith('mailto:'))
    .map((l) => l.href.replace('mailto:', '').split('?')[0].trim());

  const contacts: ContactInfo[] = [];

  // Try each section — first selector that exists wins
  for (const { location, selectors } of SECTION_SELECTORS) {
    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (!el) continue;

        const text = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el ? (el.textContent || '') : '';
        }, selector).catch(() => '');
        const phoneMatch = text.match(PHONE_REGEX);
        const emailMatch = text.match(EMAIL_REGEX);
        const address = extractAddress(text);
        const fax = extractFax(text);

        const phone = phoneLinks[0] || phoneMatch?.[1]?.trim() || null;
        const email = emailLinks[0] || emailMatch?.[0] || null;

        if (phone || email || address || fax) {
          contacts.push({ location, name: null, phone, email, address, fax });
          break; // found match for this section — move to next section
        }
        break; // selector matched but no data — skip remaining selectors for this section
      } catch {
        continue;
      }
    }
  }

  // Fallback: if no section matched but we have tel:/mailto: links, emit one "page" entry
  if (contacts.length === 0 && (phoneLinks.length > 0 || emailLinks.length > 0)) {
    contacts.push({
      location: 'page',
      name: null,
      phone: phoneLinks[0] || null,
      email: emailLinks[0] || null,
      address: null,
      fax: null,
    });
  }

  return contacts;
}

function extractAddress(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/\d{5}/.test(line) && /[A-Z]{2}/.test(line)) {
      return line;
    }
  }
  return null;
}

function extractFax(text: string): string | null {
  const match = text.match(/[Ff]ax[:\s]*(\+?\d[\d\s\-().]{7,}\d)/);
  return match?.[1]?.trim() ?? null;
}
