/**
 * Fetch-based fallback crawler for original BR sites.
 *
 * When Playwright fails (e.g. ERR_NETWORK_CHANGED over VPN), this module
 * uses Node.js fetch + JSDOM to download and parse the page HTML.
 * It extracts both the navigation menu and identity markers (company name,
 * phones, emails, addresses, person names) from the raw HTML.
 */

import { JSDOM } from 'jsdom';
import type { MenuSnapshot } from '../types/index.js';
import type { SiteIdentity } from '../menu/content-checker.js';

const FETCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PHONE_RE = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}/g;
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
const ADDRESS_RE = /\d{1,5}\s+[\w\s]+(?:St(?:reet)?|Ave(?:nue)?|Blvd|Dr(?:ive)?|Ln|Lane|Rd|Road|Way|Ct|Court|Pl(?:ace)?|Cir(?:cle)?|Pkwy|Hwy)\.?\s*,?\s*(?:Suite|Ste|Apt|#)?\s*\d*\s*,?\s*[A-Z][a-z]+[\w\s]*,\s*[A-Z]{2}\s+\d{5}/g;

const CREDENTIAL_SUFFIXES = /\b(?:CFP|CFA|CPA|CLU|ChFC|RICP|AIF|AAMS|CRPC|LUTCF|MBA|JD|PhD|Esq|WMCP|BFA|MSFS|CEBS)\b/;
const PERSON_NAME_RE = /\b[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]{2,}(?:\s+(?:Jr|Sr|III?|IV)\.?)?\b/g;

export interface FetchFallbackResult {
  menu: MenuSnapshot;
  identity: SiteIdentity;
  html: string;
}

/**
 * Fetch a page via Node.js HTTP and parse it with JSDOM.
 * Tries HTTPS first, then HTTP. Sets NODE_TLS_REJECT_UNAUTHORIZED=0
 * temporarily to handle the mismatched Broadridge SSL certificates.
 */
export async function fetchAndParse(
  url: string,
  timeout = 30_000,
): Promise<FetchFallbackResult> {
  const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  try {
    const baseUrl = url.startsWith('http') ? url : `https://${url}`;
    const urls = [baseUrl];
    if (baseUrl.startsWith('https://')) {
      urls.push(baseUrl.replace('https://', 'http://'));
    }

    let html = '';
    let lastErr: unknown;
    for (const u of urls) {
      try {
        const res = await fetch(u, {
          headers: { 'User-Agent': FETCH_UA },
          signal: AbortSignal.timeout(timeout),
          redirect: 'follow',
        });
        html = await res.text();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;

    const dom = new JSDOM(html, { url: baseUrl });
    const doc = dom.window.document;

    const menu = extractMenuFromDOM(doc, baseUrl);
    const identity = extractIdentityFromDOM(doc);

    return { menu, identity, html };
  } finally {
    if (originalTlsSetting === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsSetting;
    }
  }
}

function extractMenuFromDOM(doc: Document, baseUrl: string): MenuSnapshot {
  const NAV_SELECTORS = ['#navigationContainer', 'header nav', 'nav', '[role="navigation"]'];

  let navEl: Element | null = null;
  for (const sel of NAV_SELECTORS) {
    navEl = doc.querySelector(sel);
    if (navEl) break;
  }

  if (!navEl) return { items: [] };

  const listItems = Array.from(navEl.querySelectorAll('li'));
  const topLevelItems = listItems.filter((li) => {
    const parentUl = li.parentElement;
    if (!parentUl || parentUl.tagName !== 'UL') return false;
    const grandParent = parentUl.parentElement;
    return (
      grandParent === navEl ||
      grandParent?.id === 'navigationContainer' ||
      grandParent?.tagName === 'NAV' ||
      !grandParent?.closest('li')
    );
  });

  if (topLevelItems.length === 0) {
    const directAnchors = Array.from(navEl.querySelectorAll('a[href]'));
    return {
      items: directAnchors
        .map((a) => ({
          text: a.textContent?.trim() ?? '',
          href: resolveHref(a.getAttribute('href') ?? '', baseUrl),
          hasDropdown: false,
          hasDropdownArrow: false,
          subItems: [],
        }))
        .filter((i) => i.text.length > 0),
    };
  }

  const items = topLevelItems.map((li) => {
    const anchor = li.querySelector('a');
    const text =
      anchor?.textContent?.trim() ??
      li.textContent?.trim()?.split('\n')[0]?.trim() ??
      '';
    const href = resolveHref(anchor?.getAttribute('href') ?? '', baseUrl);

    const subMenu = li.querySelector('ul');
    const subItems = subMenu
      ? Array.from(subMenu.querySelectorAll('li a')).map((subA) => ({
          text: subA.textContent?.trim() ?? '',
          href: resolveHref(subA.getAttribute('href') ?? '', baseUrl),
        }))
      : [];

    return {
      text,
      href,
      hasDropdown: subItems.length > 0,
      hasDropdownArrow:
        li.querySelector('.caret, .arrow, [class*="dropdown"], [class*="sub-arrow"]') !== null,
      subItems,
    };
  });

  return { items: items.filter((i) => i.text.length > 0) };
}

function resolveHref(href: string, baseUrl: string): string {
  if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return href;
  }
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function extractIdentityFromDOM(doc: Document): SiteIdentity {
  const companyNames: string[] = [];

  const ogSiteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim();
  if (ogSiteName) companyNames.push(ogSiteName);

  const firstH1 = doc.querySelector('h1');
  if (firstH1) {
    const t = firstH1.textContent?.trim();
    if (t && t.length > 5 && t.length < 80 && t.split(' ').length >= 2) {
      companyNames.push(t);
    }
  }

  const urlLike = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}$/i;
  const templateLike = /^template\d/i;
  const titleParts = (doc.title || '').split(/\s*[|–—]\s*/);
  for (const part of titleParts) {
    const t = part.trim();
    if (
      t &&
      t.length > 5 &&
      t.length < 80 &&
      t.split(' ').length >= 2 &&
      !urlLike.test(t) &&
      !templateLike.test(t)
    ) {
      companyNames.push(t);
    }
  }

  const bodyText = doc.body?.textContent ?? '';

  const rawPhones = bodyText.match(PHONE_RE) ?? [];
  const phoneNumbers = [...new Set(rawPhones.map((p) => p.replace(/\D/g, '')))].map((digits) =>
    digits.length === 10
      ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
      : digits,
  );

  const rawEmails = bodyText.match(EMAIL_RE) ?? [];
  const emailAddresses = [...new Set(rawEmails.map((e) => e.toLowerCase()))];

  const rawAddresses = bodyText.match(ADDRESS_RE) ?? [];
  const physicalAddresses = [...new Set(rawAddresses.map((a) => a.trim()))];

  const rawNames = bodyText.match(PERSON_NAME_RE) ?? [];
  const personNames = [
    ...new Set(
      rawNames.filter(
        (n) =>
          CREDENTIAL_SUFFIXES.test(bodyText.slice(bodyText.indexOf(n), bodyText.indexOf(n) + n.length + 20)) ||
          bodyText.includes(n) && n.split(' ').length >= 2,
      ),
    ),
  ];

  const footer = doc.querySelector('footer');
  const footerText = footer?.textContent?.trim()?.substring(0, 500) ?? '';

  return {
    pageTitle: doc.title ?? '',
    companyNames: [...new Set(companyNames)],
    phoneNumbers,
    emailAddresses,
    physicalAddresses,
    personNames,
    footerText,
  };
}
