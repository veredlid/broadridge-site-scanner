import { BR_SOURCE_API, FLEXXML_FIELD_IDS } from '../config.js';
import type { BRSourceResponse, BRSiteData } from '../types/index.js';
import { XMLParser } from 'fast-xml-parser';

export async function fetchSiteData(
  domain: string,
  authToken?: string
): Promise<BRSiteData> {
  const url = `${BR_SOURCE_API}/${domain}`;
  const headers: Record<string, string> = {};
  if (authToken) {
    headers['Authorization'] = authToken;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`BR Source API returned ${res.status} for ${domain}`);
  }

  const data = (await res.json()) as BRSourceResponse;
  return JSON.parse(data.site.json);
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

export function getPageUrls(siteData: BRSiteData): Array<{ id: string; url: string; title: string }> {
  const pages = siteData.pages ?? {};
  return Object.entries(pages).map(([id, page]) => ({
    id,
    url: page.url,
    title: page.title,
  }));
}
