/**
 * Site Health Checks — Parts 4-8 of the QA report.
 *
 * Part 4: BrokerCheck banner detection (SVG vs non-SVG)
 * Part 5: Domain connection check (custom domain vs brprodaccount.com)
 * Part 6: Template social media link detection
 * Part 7: BR JSON image URL validation
 * Part 8: Subtitle/tagline template artifact check
 */

import type { Page } from 'playwright';
import type { BRSiteData } from '../types/index.js';

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

export interface TemplateSocialLink {
  platform: string;
  href: string;
  isTemplate: boolean;
  details: string;
}

export interface TemplateSocialResult {
  links: TemplateSocialLink[];
  templateCount: number;
  totalCount: number;
  severity: 'ok' | 'warning' | 'critical';
}

export interface ImageUrlIssue {
  fieldName: string;
  src: string;
  issue: 'double-slash' | 'missing-prefix' | 'broken-path' | 'empty-src';
  details: string;
}

export interface ImageValidationResult {
  issues: ImageUrlIssue[];
  totalImages: number;
  severity: 'ok' | 'warning' | 'critical';
}

export interface TemplateSubtitleResult {
  found: boolean;
  migratedSubtitle: string;
  isTemplate: boolean;
  details: string;
  severity: 'ok' | 'warning' | 'critical';
}

export interface SiteHealthResult {
  brokerCheck: BrokerCheckResult;
  domainCheck: DomainCheckResult;
  templateSocial?: TemplateSocialResult;
  imageValidation?: ImageValidationResult;
  templateSubtitle?: TemplateSubtitleResult;
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

// ─── Part 6: Template Social Media Link Detection ────────────────────────────

const TEMPLATE_SOCIAL_PATTERNS: Array<{ platform: string; patterns: RegExp[] }> = [
  { platform: 'Facebook',  patterns: [/facebook\.com\/(profile\.php\?id=|pages\/template|example|yourpage|#$)/i, /^https?:\/\/(?:www\.)?facebook\.com\/?$/i] },
  { platform: 'Twitter/X', patterns: [/(?:twitter|x)\.com\/(example|template|yourpage|#$)/i, /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/?$/i] },
  { platform: 'LinkedIn',  patterns: [/linkedin\.com\/(in\/example|company\/template|#$)/i, /^https?:\/\/(?:www\.)?linkedin\.com\/?$/i] },
  { platform: 'Instagram', patterns: [/instagram\.com\/(example|template|yourpage|#$)/i, /^https?:\/\/(?:www\.)?instagram\.com\/?$/i] },
  { platform: 'YouTube',   patterns: [/youtube\.com\/(example|template|channel\/UC$|#$)/i, /^https?:\/\/(?:www\.)?youtube\.com\/?$/i] },
  { platform: 'Pinterest', patterns: [/pinterest\.com\/(example|template|#$)/i, /^https?:\/\/(?:www\.)?pinterest\.com\/?$/i] },
  { platform: 'TikTok',    patterns: [/tiktok\.com\/(@example|@template|#$)/i, /^https?:\/\/(?:www\.)?tiktok\.com\/?$/i] },
];

const SOCIAL_DOMAINS = ['facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'instagram.com', 'youtube.com', 'pinterest.com', 'tiktok.com'];

/**
 * Detects social media links on the migrated page and flags any that point
 * to template/default URLs (e.g. bare facebook.com with no actual page).
 */
export async function detectTemplateSocialLinks(page: Page): Promise<TemplateSocialResult> {
  const rawLinks = await page.evaluate((socialDomains: string[]) => {
    const results: Array<{ platform: string; href: string }> = [];
    const links = document.querySelectorAll('a[href]');

    for (const link of links) {
      const href = (link.getAttribute('href') ?? '').trim();
      if (!href) continue;
      try {
        const url = new URL(href, window.location.href);
        const hostname = url.hostname.toLowerCase();
        for (const domain of socialDomains) {
          if (hostname === domain || hostname === `www.${domain}` || hostname.endsWith(`.${domain}`)) {
            const platformMap: Record<string, string> = {
              'facebook.com': 'Facebook', 'twitter.com': 'Twitter/X', 'x.com': 'Twitter/X',
              'linkedin.com': 'LinkedIn', 'instagram.com': 'Instagram', 'youtube.com': 'YouTube',
              'pinterest.com': 'Pinterest', 'tiktok.com': 'TikTok',
            };
            results.push({ platform: platformMap[domain] ?? domain, href });
            break;
          }
        }
      } catch { /* skip malformed URLs */ }
    }
    return results;
  }, SOCIAL_DOMAINS);

  const links: TemplateSocialLink[] = rawLinks.map(({ platform, href }) => {
    const entry = TEMPLATE_SOCIAL_PATTERNS.find((p) => p.platform === platform);
    const isTemplate = entry?.patterns.some((re) => re.test(href)) ?? false;
    return {
      platform,
      href,
      isTemplate,
      details: isTemplate ? `Template/default ${platform} link: ${href}` : `${platform}: ${href}`,
    };
  });

  // Deduplicate by href
  const seen = new Set<string>();
  const unique = links.filter((l) => { if (seen.has(l.href)) return false; seen.add(l.href); return true; });

  const templateCount = unique.filter((l) => l.isTemplate).length;
  return {
    links: unique,
    templateCount,
    totalCount: unique.length,
    severity: templateCount > 0 ? 'critical' : 'ok',
  };
}

// ─── Part 7: BR JSON Image URL Validation ─────────────────────────────────────

/**
 * Validates image URLs in the BR source JSON for common issues that cause
 * broken images after migration: double slashes, missing /files/ prefix,
 * empty src attributes.
 */
export function validateBrJsonImages(siteData: BRSiteData | null): ImageValidationResult {
  if (!siteData) return { issues: [], totalImages: 0, severity: 'ok' };

  const issues: ImageUrlIssue[] = [];
  let totalImages = 0;

  const IMG_SRC_RE = /(?:src|SRC)\s*=\s*["']([^"']+)["']/g;

  const checkHtml = (fieldName: string, html: string) => {
    for (const match of html.matchAll(IMG_SRC_RE)) {
      totalImages++;
      const src = match[1].trim();

      if (!src || src === '#') {
        issues.push({ fieldName, src, issue: 'empty-src', details: `Empty or placeholder image src in ${fieldName}` });
        continue;
      }
      if (/\/\/files\//.test(src) || /^\/\/[^/]/.test(src) && !src.startsWith('//www.')) {
        issues.push({ fieldName, src, issue: 'double-slash', details: `Double slash in image path: "${src.substring(0, 80)}"` });
      }
      if (/^files\//.test(src)) {
        issues.push({ fieldName, src, issue: 'missing-prefix', details: `Missing leading slash: "${src.substring(0, 80)}" (should be /files/...)` });
      }
      if (/\s/.test(src.trim())) {
        issues.push({ fieldName, src, issue: 'broken-path', details: `Whitespace in image path: "${src.substring(0, 80)}"` });
      }
    }
  };

  for (const field of siteData['user-content-fields'] ?? []) {
    if (field.content) checkHtml(field.name, field.content);
    if (field.styledContent) checkHtml(field.name, field.styledContent);
  }

  for (const page of siteData['user-custom-pages'] ?? []) {
    const html = (page as any).styledContent ?? (page as any).content;
    if (html) checkHtml(page.PageTitle ?? page.FieldName, html);
  }

  return {
    issues,
    totalImages,
    severity: issues.length > 0 ? (issues.length > 5 ? 'critical' : 'warning') : 'ok',
  };
}

// ─── Part 8: Subtitle/Tagline Template Check ──────────────────────────────────

const KNOWN_TEMPLATE_SUBTITLES = [
  'your trusted financial partner',
  'comprehensive financial planning',
  'personalized financial solutions',
  'building wealth together',
  'your financial future starts here',
  'wealth management & financial planning',
  'securing your financial future',
  'custom financial solutions',
  'add a subheading',
  'add paragraph text',
  'click here to add your own text',
  'lorem ipsum dolor sit amet',
  'this is a paragraph',
  'tell your visitors about your services',
  'describe your service here',
  'describe what you offer',
];

/**
 * Checks the hero section subtitle/tagline on the migrated page to detect
 * if it's still showing a template default instead of the actual company text.
 */
export async function detectTemplateSubtitle(page: Page): Promise<TemplateSubtitleResult> {
  const subtitle = await page.evaluate(() => {
    // Look for hero subtitle patterns — typically h2/h3/p right after h1
    const hero = document.querySelector(
      '[data-testid*="hero"], [class*="hero"], [id*="hero"], ' +
      'section:first-of-type, header + section, main > section:first-child'
    );

    const searchRoot = hero ?? document.body;
    const candidates: string[] = [];

    // H2s and H3s in the hero area
    for (const el of searchRoot.querySelectorAll('h2, h3')) {
      const text = el.textContent?.trim() ?? '';
      if (text.length > 5 && text.length < 200) candidates.push(text);
    }

    // Paragraph right after an H1
    const h1 = searchRoot.querySelector('h1');
    if (h1) {
      let sibling = h1.nextElementSibling;
      for (let i = 0; i < 3 && sibling; i++) {
        if (sibling.tagName === 'P' || sibling.tagName === 'H2' || sibling.tagName === 'H3') {
          const text = sibling.textContent?.trim() ?? '';
          if (text.length > 5 && text.length < 200) candidates.push(text);
        }
        sibling = sibling.nextElementSibling;
      }
    }

    // Elements with subtitle-ish attributes
    for (const el of document.querySelectorAll('[class*="subtitle"], [class*="tagline"], [class*="slogan"], [data-testid*="subtitle"]')) {
      const text = el.textContent?.trim() ?? '';
      if (text.length > 5 && text.length < 200) candidates.push(text);
    }

    return candidates;
  });

  if (subtitle.length === 0) {
    return { found: false, migratedSubtitle: '', isTemplate: false, details: 'No hero subtitle found', severity: 'ok' };
  }

  const templateNorms = KNOWN_TEMPLATE_SUBTITLES.map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const firstSubtitle = subtitle[0];
  const norm = firstSubtitle.toLowerCase().replace(/[^a-z0-9]/g, '');

  const isTemplate = templateNorms.some((t) => norm.includes(t) || t.includes(norm));

  return {
    found: true,
    migratedSubtitle: firstSubtitle,
    isTemplate,
    details: isTemplate
      ? `Template subtitle detected: "${firstSubtitle}"`
      : `Subtitle: "${firstSubtitle.substring(0, 80)}"`,
    severity: isTemplate ? 'critical' : 'ok',
  };
}

// ─── Combined Check ───────────────────────────────────────────────────────────

export async function runSiteHealthChecks(
  page: Page | null,
  migratedUrl: string,
  siteData?: BRSiteData | null,
): Promise<SiteHealthResult> {
  const brokerCheck: BrokerCheckResult = page
    ? await detectBrokerCheck(page)
    : { found: false, type: 'none', position: 'none', details: 'Page not available', severity: 'warning' };

  const domainCheck = checkDomainConnection(migratedUrl);

  const templateSocial = page ? await detectTemplateSocialLinks(page) : undefined;
  const imageValidation = siteData ? validateBrJsonImages(siteData) : undefined;
  const templateSubtitle = page ? await detectTemplateSubtitle(page) : undefined;

  return { brokerCheck, domainCheck, templateSocial, imageValidation, templateSubtitle };
}
