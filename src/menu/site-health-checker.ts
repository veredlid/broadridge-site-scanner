/**
 * Site Health Checks — Parts 4-5 of the QA report.
 *
 * Part 4: BrokerCheck banner detection (SVG vs non-SVG)
 * Part 5: Domain connection check (custom domain vs brprodaccount.com)
 */

import type { Page } from 'playwright';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrokerCheckResult {
  found: boolean;
  type: 'svg' | 'non-svg' | 'none';
  position: 'top-and-bottom' | 'side-floater' | 'bottom-floater' | 'unknown' | 'none';
  details: string;
  severity: 'ok' | 'warning' | 'critical';
}

export interface DomainCheckResult {
  migratedUrl: string;
  hasCustomDomain: boolean;
  hostname: string;
  details: string;
  severity: 'ok' | 'warning';
}

export interface SiteHealthResult {
  brokerCheck: BrokerCheckResult;
  domainCheck: DomainCheckResult;
}

// ─── BrokerCheck Detection ────────────────────────────────────────────────────

/**
 * Detects BrokerCheck FINRA banner on the migrated page and classifies
 * whether it uses the SVG version or the older text/image version.
 *
 * The correct embed should be "Top and Bottom (SVG)". The bug (96 sites)
 * is that "Top and Bottom" (non-SVG) was set instead.
 */
export async function detectBrokerCheck(page: Page): Promise<BrokerCheckResult> {
  return page.evaluate(() => {
    const result = {
      found: false,
      type: 'none' as 'svg' | 'non-svg' | 'none',
      position: 'none' as 'top-and-bottom' | 'side-floater' | 'bottom-floater' | 'unknown' | 'none',
      details: '',
      severity: 'ok' as 'ok' | 'warning' | 'critical',
    };

    // Look for BrokerCheck links/elements
    const brokerCheckLinks = document.querySelectorAll(
      'a[href*="brokercheck.finra.org"], a[href*="FINRA"], a[href*="finra.org"]'
    );
    const brokerCheckIframes = document.querySelectorAll(
      'iframe[src*="brokercheck"], iframe[src*="finra"]'
    );

    // Also check for site embeds (Wix embeds) containing BrokerCheck
    const allEmbeds = document.querySelectorAll(
      '[data-testid*="brokercheck"], [id*="brokercheck"], [class*="brokercheck"], ' +
      '[data-testid*="BrokerCheck"], [id*="BrokerCheck"], [class*="BrokerCheck"]'
    );

    // Check for text mentions
    const bodyText = document.body?.innerText ?? '';
    const hasBrokerCheckText = /broker\s*check/i.test(bodyText) || /finra/i.test(bodyText);
    const hasBrokerCheckLink = brokerCheckLinks.length > 0;
    const hasBrokerCheckIframe = brokerCheckIframes.length > 0;
    const hasBrokerCheckEmbed = allEmbeds.length > 0;

    if (!hasBrokerCheckLink && !hasBrokerCheckIframe && !hasBrokerCheckEmbed && !hasBrokerCheckText) {
      result.details = 'No BrokerCheck banner found on page';
      return result;
    }

    result.found = true;

    // Determine position by checking where the elements are
    let topBanner = false;
    let bottomBanner = false;
    let sideFloat = false;

    const viewportHeight = window.innerHeight;
    const pageHeight = document.body.scrollHeight;

    for (const link of brokerCheckLinks) {
      const rect = link.getBoundingClientRect();
      const absoluteTop = rect.top + window.scrollY;

      if (absoluteTop < 100) topBanner = true;
      else if (absoluteTop > pageHeight - 200) bottomBanner = true;

      const style = window.getComputedStyle(link.closest('[style*="position"]') ?? link);
      if (style.position === 'fixed' || style.position === 'sticky') {
        const right = parseFloat(style.right);
        if (right < 100 && rect.top > viewportHeight / 3) sideFloat = true;
        if (rect.bottom > viewportHeight - 100) bottomBanner = true;
      }
    }

    if (topBanner && bottomBanner) result.position = 'top-and-bottom';
    else if (sideFloat) result.position = 'side-floater';
    else if (bottomBanner) result.position = 'bottom-floater';
    else if (topBanner) result.position = 'top-and-bottom';
    else result.position = 'unknown';

    // Determine if SVG or non-SVG
    let hasSvg = false;
    let hasNonSvg = false;

    for (const link of brokerCheckLinks) {
      const container = link.closest('div, section, header, footer') ?? link;
      const svgElements = container.querySelectorAll('svg, img[src*=".svg"]');
      const imgElements = container.querySelectorAll('img:not([src*=".svg"])');
      const textContent = link.textContent?.trim() ?? '';

      if (svgElements.length > 0) hasSvg = true;
      if (imgElements.length > 0 || (textContent.length > 10 && svgElements.length === 0)) {
        hasNonSvg = true;
      }
    }

    // Also check iframes/embeds for SVG
    for (const embed of allEmbeds) {
      if (embed.querySelector('svg, img[src*=".svg"]')) hasSvg = true;
      else hasNonSvg = true;
    }

    if (hasSvg && !hasNonSvg) {
      result.type = 'svg';
      result.details = 'BrokerCheck banner uses SVG (correct)';
      result.severity = 'ok';
    } else if (hasNonSvg) {
      result.type = 'non-svg';
      result.details = 'BrokerCheck banner uses non-SVG (should be "Top and Bottom (SVG)")';
      result.severity = 'critical';
    } else {
      result.type = 'non-svg';
      result.details = 'BrokerCheck banner detected but could not confirm SVG type';
      result.severity = 'warning';
    }

    return result;
  });
}

// ─── Domain Connection Check ──────────────────────────────────────────────────

/**
 * Checks whether the migrated site has a proper custom domain
 * or is still on the default *.brprodaccount.com domain.
 */
export function checkDomainConnection(migratedUrl: string): DomainCheckResult {
  let hostname: string;
  try {
    hostname = new URL(migratedUrl.startsWith('http') ? migratedUrl : `https://${migratedUrl}`).hostname;
  } catch {
    hostname = migratedUrl;
  }

  const isBrProd = hostname.includes('brprodaccount.com');
  const isWixStudio = hostname.includes('wixstudio.com') || hostname.includes('wixsite.com');
  const hasCustomDomain = !isBrProd && !isWixStudio;

  return {
    migratedUrl,
    hostname,
    hasCustomDomain,
    details: hasCustomDomain
      ? `Custom domain connected: ${hostname}`
      : `No custom domain — still on ${hostname}`,
    severity: hasCustomDomain ? 'ok' : 'warning',
  };
}

// ─── Combined Check ───────────────────────────────────────────────────────────

export async function runSiteHealthChecks(
  page: Page | null,
  migratedUrl: string,
): Promise<SiteHealthResult> {
  const brokerCheck: BrokerCheckResult = page
    ? await detectBrokerCheck(page)
    : { found: false, type: 'none', position: 'none', details: 'Page not available', severity: 'warning' };

  const domainCheck = checkDomainConnection(migratedUrl);

  return { brokerCheck, domainCheck };
}
