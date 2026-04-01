import { BR_SOURCE_API, FLEXXML_FIELD_IDS } from '../config.js';
import type { BRSourceResponse, BRSiteData } from '../types/index.js';
import type { ContentFieldSource } from '../utils/content-comparator.js';
import { XMLParser } from 'fast-xml-parser';

export async function fetchSiteData(
  domain: string,
  authToken?: string
): Promise<BRSiteData> {
  // Normalize: strip protocol/trailing slash, lowercase
  const normalized = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();

  // The BR Source API requires the exact registered domain (always lowercase, usually with www.)
  // Try: as-entered, then with www. prefix, then without www. prefix
  const candidates = [normalized];
  if (!normalized.startsWith('www.')) candidates.push(`www.${normalized}`);
  else candidates.push(normalized.replace(/^www\./, ''));

  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = authToken;

  let lastError = '';
  for (const candidate of candidates) {
    const res = await fetch(`${BR_SOURCE_API}/${candidate}`, { headers });
    if (res.ok) {
      const data = (await res.json()) as BRSourceResponse;
      return JSON.parse(data.site.json);
    }
    lastError = `BR Source API returned ${res.status} for ${candidate}`;
  }

  throw new Error(lastError);
}

export function extractFlexXml(siteData: BRSiteData): Record<string, unknown> | null {
  const fields = siteData['user-content-fields'] ?? [];
  for (const fieldId of FLEXXML_FIELD_IDS) {
    const field = fields.find((f) => f.id === fieldId);
    if (field?.content) {
      try {
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '@_',
        });
        return parser.parse(field.content);
      } catch {
        continue;
      }
    }
  }
  return null;
}

export interface FlexXmlContainer {
  name: string;
  visible: boolean;
  bgColor: string;
  txtColor: string;
  subitems: Array<{ name: string; value: string }>;
}

export function parseFlexXmlContainers(
  flexXml: Record<string, unknown>
): FlexXmlContainer[] {
  const containers: FlexXmlContainer[] = [];

  try {
    const root = flexXml as any;
    const containerArray =
      root?.FlexXML?.containers?.container ??
      root?.containers?.container ??
      [];

    const arr = Array.isArray(containerArray) ? containerArray : [containerArray];

    for (const c of arr) {
      containers.push({
        name: c?.name ?? c?.['@_name'] ?? '',
        visible: c?.visible !== 'false' && c?.visible !== false,
        bgColor: c?.bgColor ?? c?.['@_bgColor'] ?? '',
        txtColor: c?.txtColor ?? c?.['@_txtColor'] ?? '',
        subitems: Array.isArray(c?.subitem)
          ? c.subitem.map((s: any) => ({ name: s?.name ?? '', value: s?.value ?? '' }))
          : [],
      });
    }
  } catch {
    // FlexXML parsing is best-effort
  }

  return containers;
}

/**
 * Detect the site type from the BR Source API's Target-Theme-Name field.
 *
 * Mapping (based on observed theme names):
 *  - "Flexible Theme X"      → flex
 *  - "Deprecated Theme X"    → deprecated
 *  - "Vanilla Bean X"        → vanilla
 *  - Everything else         → flex (safe default)
 */
export function detectSiteType(siteData: BRSiteData): 'vanilla' | 'flex' | 'deprecated' {
  const theme = (siteData['Target-Theme-Name'] ?? '').toLowerCase();
  if (theme.includes('vanilla')) return 'vanilla';
  if (theme.includes('deprecated')) return 'deprecated';
  if (theme.includes('flexible') || theme.includes('flex')) return 'flex';
  // Fallback: if we have no theme info default to flex
  return 'flex';
}

/**
 * Extract content fields from BR source data, organized by page.
 *
 * Mirrors how site-immigrator-wml-ctoo's richContentService picks content:
 *  - Home page: content from user-content-fields (OurFirm, OurQualifications, Disclosure, etc.)
 *  - Custom pages: content from user-custom-pages (each page's HTML block)
 *
 * Only fields with actual HTML content are included.
 * Non-HTML fields (CSV lists of calc IDs, theme codes, etc.) are skipped.
 */
export function extractBrContentByPage(
  siteData: BRSiteData
): Array<{ pageTitle: string; pageHref: string; fields: ContentFieldSource[] }> {
  const pages: Array<{ pageTitle: string; pageHref: string; fields: ContentFieldSource[] }> = [];

  // ── Home page: key user-content-fields ──────────────────────────────────
  const HOME_FIELD_NAMES = new Set([
    'OurFirm', 'OurQualifications', 'OurServices', 'OurCalendar', 'OurStaff',
    'Disclosure', 'SiteDisc2', 'Site_Description', 'OurPhilosophy', 'OurHistory',
    'Content1', 'Content2', 'Content3', 'Content4',
  ]);

  const contentFields = siteData['user-content-fields'] ?? [];
  const homeFields: ContentFieldSource[] = contentFields
    .filter((f) => {
      // Skip fields that are clearly not HTML (CSV lists, theme codes, etc.)
      if (!f.content || !f.name) return false;
      if (!HOME_FIELD_NAMES.has(f.name)) return false;
      const c = f.content.trim();
      // Must look like HTML or have substantial text
      return c.startsWith('<') || c.length > 100;
    })
    .map((f) => ({ fieldName: f.name, html: f.styledContent ?? f.content }));

  if (homeFields.length > 0) {
    pages.push({ pageTitle: 'Home', pageHref: '/', fields: homeFields });
  }

  // ── Custom pages: each page has its own HTML block ────────────────────────
  const customPages = siteData['user-custom-pages'] ?? [];
  for (const page of customPages) {
    if (!page.navigationStatus || !page.Href) continue;
    const html = (page as any).styledContent ?? (page as any).content;
    if (!html || html.trim().length < 50) continue;

    pages.push({
      pageTitle: page['Stripped Title'] ?? page.PageTitle,
      pageHref: `/${page.Href}`,
      fields: [{ fieldName: page.PageTitle, html }],
    });
  }

  return pages;
}

export function getPageUrls(siteData: BRSiteData): Array<{ id: string; url: string; title: string }> {
  // Prefer user-custom-pages (actual API shape) over the legacy pages map
  const customPages = siteData['user-custom-pages'];
  if (customPages && customPages.length > 0) {
    return customPages
      .filter((p) => p.navigationStatus && p.Href)
      .map((p) => ({
        id: String(p.FieldID),
        url: `/${p.Href}`,
        title: p['Stripped Title'] ?? p.PageTitle,
      }));
  }

  // Legacy fallback: pages map (may be absent)
  const pages = siteData.pages ?? {};
  return Object.entries(pages).map(([id, page]) => ({
    id,
    url: page.url,
    title: page.title,
  }));
}
