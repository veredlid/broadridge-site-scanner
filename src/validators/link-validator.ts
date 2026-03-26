import type { LinkInfo, LinkValidationResult } from '../types/index.js';
import { THRESHOLDS } from '../config.js';

export async function validateLinks(
  links: LinkInfo[],
  originalLinks?: LinkInfo[]
): Promise<LinkValidationResult[]> {
  const originalBrokenHrefs = new Set(
    originalLinks
      ?.filter((l) => l.httpStatus !== null && l.httpStatus >= 400)
      .map((l) => l.href) ?? []
  );

  const uniqueHrefs = [...new Set(links.map((l) => l.href))];
  const statusMap = new Map<string, number>();

  for (let i = 0; i < uniqueHrefs.length; i += THRESHOLDS.linkBatchSize) {
    const batch = uniqueHrefs.slice(i, i + THRESHOLDS.linkBatchSize);
    const results = await Promise.allSettled(
      batch.map((href) => checkLink(href))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        statusMap.set(result.value.href, result.value.status);
      }
    }
  }

  return links.map((link) => {
    const status = statusMap.get(link.href) ?? -1;
    const isBroken = status >= 400 || status === -1;
    const wasBrokenOnOriginal = originalBrokenHrefs.has(link.href);

    return {
      ...link,
      httpStatus: status,
      isBroken,
      wasBrokenOnOriginal,
      isFlagged: isBroken && !wasBrokenOnOriginal,
    };
  });
}

async function checkLink(href: string): Promise<{ href: string; status: number }> {
  if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return { href, status: 0 };
  }

  try {
    const res = await fetch(href, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(THRESHOLDS.linkTimeout),
    });
    return { href, status: res.status };
  } catch {
    try {
      const res = await fetch(href, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(THRESHOLDS.linkTimeout),
      });
      return { href, status: res.status };
    } catch {
      return { href, status: -1 };
    }
  }
}

export function summarizeLinks(results: LinkValidationResult[]): {
  total: number;
  ok: number;
  broken: number;
  flagged: number;
  skipped: number;
} {
  return {
    total: results.length,
    ok: results.filter((r) => !r.isBroken && r.httpStatus !== null && r.httpStatus > 0).length,
    broken: results.filter((r) => r.isBroken).length,
    flagged: results.filter((r) => r.isFlagged).length,
    skipped: results.filter((r) => r.httpStatus === 0).length,
  };
}
