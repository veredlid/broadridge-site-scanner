import type { Page } from 'playwright';
import type { ContactInfo } from '../types/index.js';

const PHONE_REGEX = /(\+?\d[\d\s\-().]{7,}\d)/;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.]+/;

export async function extractContactInfo(page: Page): Promise<ContactInfo[]> {
  const contacts: ContactInfo[] = [];

  const locations: Array<{ location: string; selector: string }> = [
    { location: 'homepage-header', selector: '#headerContainer' },
    { location: 'homepage-contact-box', selector: '#contentContainer' },
    { location: 'footer', selector: '#footerContainer' },
    { location: 'map-section', selector: '#mapContainer' },
  ];

  for (const { location, selector } of locations) {
    const el = await page.$(selector);
    if (!el) continue;

    const info = await page.$eval(selector, (section) => {
      const text = section.textContent || '';
      const allLinks = Array.from(section.querySelectorAll('a'));

      const emailLinks = allLinks
        .filter((a: HTMLAnchorElement) => a.href.startsWith('mailto:'))
        .map((a: HTMLAnchorElement) => a.href.replace('mailto:', '').split('?')[0]);

      const phoneLinks = allLinks
        .filter((a: HTMLAnchorElement) => a.href.startsWith('tel:'))
        .map((a: HTMLAnchorElement) => a.href.replace('tel:', ''));

      return { text, emailLinks, phoneLinks };
    });

    const phoneMatch = info.text.match(PHONE_REGEX);
    const emailMatch = info.text.match(EMAIL_REGEX);

    contacts.push({
      location,
      name: null,
      phone: info.phoneLinks[0] || phoneMatch?.[1]?.trim() || null,
      email: info.emailLinks[0] || emailMatch?.[0] || null,
      address: extractAddress(info.text),
      fax: extractFax(info.text),
    });
  }

  const contactPageLink = await page.$('a[href*="contact"]');
  if (contactPageLink) {
    const href = await contactPageLink.getAttribute('href');
    if (href) {
      contacts.push({
        location: 'contact-page-link',
        name: null,
        phone: null,
        email: null,
        address: null,
        fax: null,
      });
    }
  }

  return contacts.filter(
    (c) => c.phone || c.email || c.address || c.fax
  );
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
