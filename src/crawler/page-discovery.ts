import type { Page } from 'playwright';
import type { BRSiteData } from '../types/index.js';
import { getPageUrls } from '../api/site-fetcher.js';

export interface DiscoveredPage {
  id: string;
  url: string;
  title: string;
  source: 'api' | 'menu-crawl';
}

export async function discoverPages(
  domain: string,
  siteData: BRSiteData | null,
  page?: Page
): Promise<DiscoveredPage[]> {
  const pages: DiscoveredPage[] = [];
  const seenUrls = new Set<string>();

  if (siteData) {
    const apiPages = getPageUrls(siteData);
    for (const p of apiPages) {
      if (!seenUrls.has(p.url)) {
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

  if (pages.length === 0) {
    pages.push({
      id: 'homepage',
      url: '/',
      title: 'Home',
      source: 'menu-crawl',
    });
  }

  return pages;
}

async function crawlMenuLinks(page: Page, domain: string): Promise<DiscoveredPage[]> {
  const baseHost = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const links = await page.$$eval(
    '#navigationContainer a[href]',
    (anchors, host) => {
      return (anchors as HTMLAnchorElement[])
        .map((a) => ({
          href: a.href,
          text: a.textContent?.trim() || '',
        }))
        .filter((l) => {
          try {
            const url = new URL(l.href);
            return url.hostname === host || url.hostname === `www.${host}`;
          } catch {
            return l.href.startsWith('/');
          }
        });
    },
    baseHost
  );

  return links.map((link, i) => {
    let url: string;
    try {
      url = new URL(link.href).pathname;
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
