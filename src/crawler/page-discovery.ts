import type { Page } from 'playwright';
import type { BRSiteData } from '../types/index.js';
import { getPageUrls } from '../api/site-fetcher.js';

export interface DiscoveredPage {
  id: string;
  url: string;
  title: string;
  source: 'api' | 'menu-crawl';
}

/**
 * Priority-ordered selectors for finding navigation links.
 * Tries BR-specific IDs first, then semantic HTML5/ARIA fallbacks so the
 * scanner works on BOTH original Broadridge sites AND Wix-hosted migrations.
 */
const NAV_LINK_SELECTORS = [
  '#navigationContainer a[href]',    // BR original sites
  'header nav a[href]',              // Nav nested inside <header>
  'nav a[href]',                     // HTML5 semantic <nav>
  '[role="navigation"] a[href]',     // ARIA navigation landmark
  'header a[href]',                  // Fallback: any link in header
];

export async function discoverPages(
  domain: string,
  siteData: BRSiteData | null,
  page?: Page
): Promise<DiscoveredPage[]> {
  const pages: DiscoveredPage[] = [];
  const seenUrls = new Set<string>();

  // Always include home page as the first entry
  pages.push({ id: 'homepage', url: '/', title: 'Home', source: 'menu-crawl' });
  seenUrls.add('/');

  // Skip file-extension pages from both API and menu crawl — these are legacy
  // BR server-side routes (.htm, .asp, .cfm, etc.) that time out and have no
  // equivalent on Wix (they're replaced by clean slugs).
  const SKIP_ANY = /\.(htm|html|cfm|asp|aspx|php|pdf|doc|docx|xls|xlsx|csv|zip|xml)(\?|$)/i;

  if (siteData) {
    const apiPages = getPageUrls(siteData);
    for (const p of apiPages) {
      if (!seenUrls.has(p.url) && !SKIP_ANY.test(p.url)) {
        seenUrls.add(p.url);
        pages.push({ ...p, source: 'api' });
      }
    }
  }

  if (page) {
    const menuLinks = await crawlMenuLinks(page, domain);
    for (const link of menuLinks) {
      if (!seenUrls.has(link.url)) {
        seenUrls.add(link.url);
        pages.push(link);
      }
    }
  }

  return pages;
}

async function crawlMenuLinks(page: Page, domain: string): Promise<DiscoveredPage[]> {
  // Parse domain into hostname + base path separately.
  // Wix studio URLs like https://broadridgeprod.wixstudio.com/0kd7tbawnwo0uuirpac5
  // have a path prefix that must NOT be included in the hostname comparison.
  let baseHost: string;
  let basePath: string; // e.g. '/0kd7tbawnwo0uuirpac5' or '' for plain domains
  try {
    const parsed = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
    baseHost = parsed.hostname.toLowerCase();
    basePath = parsed.pathname.replace(/\/$/, ''); // '/0kd7tbawnwo0uuirpac5' or ''
  } catch {
    baseHost = domain.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    basePath = '';
  }

  let rawLinks: { href: string; text: string }[] = [];

  // Try each selector in priority order — use the first one that yields nav links.
  // NOTE: We use page.evaluate() with document.querySelectorAll() rather than page.$$eval()
  // to avoid a tsx/esbuild serialisation issue where named functions get wrapped with __name()
  // which is a module-level variable not available inside the browser sandbox.
  for (const selector of NAV_LINK_SELECTORS) {
    try {
      const links = await page.evaluate(({ sel, host, basePath: bp }: { sel: string; host: string; basePath: string }) => {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(sel));
        return anchors
          .map((a) => ({
            href: a.href,
            text: (a.textContent?.trim() || a.getAttribute('aria-label') || ''),
          }))
          .filter((l) => {
            if (!l.href || l.href === '#' || l.href.startsWith('javascript:')) return false;
            try {
              const url = new URL(l.href);
              const hostnameMatch = (
                url.hostname === host ||
                url.hostname === 'www.' + host ||
                'www.' + url.hostname === host
              );
              if (!hostnameMatch) return false;
              // If this domain has a path prefix (Wix studio), only keep links under that prefix
              if (bp) {
                return url.pathname === bp ||
                       url.pathname.startsWith(bp + '/');
              }
              return true;
            } catch {
              return l.href.startsWith('/');
            }
          });
      }, { sel: selector, host: baseHost, basePath });

      if (links.length > 0) {
        rawLinks = links;
        break; // Found nav links — stop trying other selectors
      }
    } catch {
      // Selector error or empty result — try the next one
    }
  }

  // Deduplicate by pathname (home page is added separately by discoverPages).
  // Strip basePath prefix before deduping so pages are stored as relative paths
  // (e.g. '/0kd7tbawnwo0uuirpac5/about-us' → '/about-us') — this ensures openPage()
  // can append them to the domain without creating a double-prefix URL.
  const seenPaths = new Set<string>();
  seenPaths.add('/'); // skip home — already added as first entry

  const SKIP_EXTENSIONS = /\.(htm|html|cfm|asp|aspx|php|pdf|doc|docx|xls|xlsx|csv|zip|xml)(\?|$)/i;

  const stripBase = (pathname: string): string => {
    if (basePath && pathname.startsWith(basePath)) {
      return pathname.slice(basePath.length) || '/';
    }
    return pathname;
  };

  const uniqueLinks = rawLinks.filter((l) => {
    try {
      const rawPath = new URL(l.href).pathname.replace(/\/$/, '') || '/';
      const path = stripBase(rawPath);
      if (seenPaths.has(path)) return false;
      if (SKIP_EXTENSIONS.test(path)) return false;
      seenPaths.add(path);
      return true;
    } catch {
      return false;
    }
  });

  return uniqueLinks.map((link, i) => {
    let url: string;
    try {
      url = stripBase(new URL(link.href).pathname);
    } catch {
      url = link.href;
    }
    return {
      id: `page-${i}`,
      url,
      title: link.text,
      source: 'menu-crawl' as const,
    };
  });
}
