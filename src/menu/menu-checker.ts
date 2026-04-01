/**
 * Menu-focused QA check for Broadridge → Wix migrations.
 *
 * Generates TWO comparison reports:
 *
 * Part 1 — BR JSON vs Migrated (spec compliance)
 *   Source of truth: BR Source API `user-navigation` + `user-custom-pages`
 *   Answers: "Was everything in the migration spec actually migrated?"
 *
 * Part 2 — Original Live Site vs Migrated (visual parity)
 *   Source of truth: crawled menu of original live site
 *   Answers: "Does the migrated site look the same as the original?"
 *
 * NOT checked: URL path format — .htm → clean slug is an expected migration
 * artifact. As long as the link works (HTTP 200), paths are irrelevant.
 */

import chalk from 'chalk';
import { fetchSiteData } from '../api/site-fetcher.js';
import { analyzeMenu } from '../crawler/menu-analyzer.js';
import { fetchAndParse } from '../crawler/fetch-fallback.js';
import { openPage } from '../utils/playwright-helpers.js';
import { extractIdentity, compareIdentities, checkForKnownTemplateArtifacts } from './content-checker.js';
import { runSiteHealthChecks, checkDomainConnection } from './site-health-checker.js';
import type { BRSiteData } from '../types/index.js';
import type { SiteIdentity, ContentMismatch, ContentCheckResult } from './content-checker.js';
import type { SiteHealthResult } from './site-health-checker.js';

// ─── Input / Output types ────────────────────────────────────────────────────

export interface MenuCheckOptions {
  original: string;   // e.g. "www.americanfundsandtrusts.com"
  migrated: string;   // e.g. "https://americanfundsandtrusts-31030806.brprodaccount.com"
  auth?: string;
  timeout?: number;
}

export interface BRNavItem {
  title: string;
  href: string;
  children: Array<{ title: string; href: string }>;
}

export interface WixMenuItem {
  text: string;
  href: string;        // absolute URL as crawled
  path: string;        // normalized relative path (site-prefix stripped)
  subItems: Array<{ text: string; href: string; path: string }>;
  hasDropdown: boolean;
}

export type IssueKind =
  | 'missing'          // item in source but not found in migrated menu
  | 'extra'            // item in migrated but not in source
  | 'broken-link'      // migrated href returns non-200
  | 'duplicate'        // same item appears multiple times in migrated menu
  | 'href-mismatch'    // dropdown parent (/#) now links to a real page
  | 'structure-change' // flat→nested or nested→flat
  | 'ok';

export interface MenuItemIssue {
  kind: IssueKind;
  brTitle?: string;
  brHref?: string;
  migratedText?: string;
  migratedHref?: string;
  migratedPath?: string;
  httpStatus?: number | null;
  httpError?: string;
  note?: string;
  subIssues?: MenuItemIssue[];
}

export interface MenuSectionSummary {
  totalSourceItems: number;
  totalMigratedItems: number;
  missing: number;
  extra: number;
  brokenLinks: number;
  duplicates: number;
  hrefMismatches: number;
  structureChanges: number;
  ok: number;
}

export interface MenuCheckResult {
  originalDomain: string;
  migratedDomain: string;
  capturedAt: string;

  // Raw source data
  brNavItems: BRNavItem[];           // Part 1 source (from BR API)
  originalItems: WixMenuItem[];      // Part 2 source (crawled from original live site)
  migratedItems: WixMenuItem[];      // Target for both parts

  // Part 1: BR JSON vs Migrated
  issues: MenuItemIssue[];
  summary: MenuSectionSummary & { totalBrItems: number; totalMigratedItems: number };

  // Part 2: Original live site vs Migrated
  liveIssues: MenuItemIssue[];
  liveSummary: MenuSectionSummary;
  originalCrawlFailed?: boolean;
  originalCrawlError?: string;

  // Part 3: Content identity mismatch check
  contentCheck?: ContentCheckResult;

  // Parts 4-5: Site health checks (BrokerCheck, domain)
  siteHealth?: SiteHealthResult;
}

// ─── Normalize helpers ───────────────────────────────────────────────────────

function normText(s: string | undefined | null): string {
  return (s ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a readable name from a BR href like `/Wealth-Management-Approach.1.htm`.
 * Used as a fallback when the BR title is a generic "Custom Section N".
 */
function normHrefAsTitle(href: string | undefined | null): string {
  if (!href) return '';
  let s = href.replace(/^\//, '').replace(/\.\d+\.htm$/i, '').replace(/\.htm$/i, '');
  return normText(s.replace(/[-_,]/g, ' '));
}

const CUSTOM_SECTION_RE = /^custom\s+section\s+\d+$/i;

const NON_NAVIGATING_HREFS = new Set(['/#', '#', 'javascript:void(0)', 'javascript:void(0);', 'javascript:;', '']);

function isDropdownOnlyHref(href: string): boolean {
  return NON_NAVIGATING_HREFS.has((href ?? '').trim());
}

function isRealPageHref(href: string): boolean {
  const h = (href ?? '').trim();
  if (!h || h === '/' || isDropdownOnlyHref(h)) return false;
  return true;
}

function extractPath(href: string, migratedBase: string): string {
  try {
    const url = new URL(href);
    const base = new URL(migratedBase.startsWith('http') ? migratedBase : `https://${migratedBase}`);
    const sitePrefixPath = base.pathname.replace(/\/$/, '');
    let path = url.pathname.replace(/\/$/, '') || '/';
    if (sitePrefixPath && path.startsWith(sitePrefixPath)) {
      path = path.slice(sitePrefixPath.length) || '/';
    }
    return path || '/';
  } catch {
    return href.startsWith('/') ? href : '/' + href;
  }
}

// ─── BR nav extraction ───────────────────────────────────────────────────────

function extractBRNav(siteData: BRSiteData): BRNavItem[] {
  const rawNav = siteData['user-navigation'];
  const customPages = siteData['user-custom-pages'] ?? [];

  let navItems: BRNavItem[];

  if (!rawNav || rawNav.length === 0) {
    // No user-navigation at all — build entirely from user-custom-pages
    const navPages = customPages.filter((p) => p.navigationStatus && p.Href);
    navItems = [
      { title: 'Home', href: '/', children: [] },
      ...navPages.map((p) => ({
        title: p['Stripped Title'] ?? p.PageTitle ?? '',
        href: p.Href!.startsWith('/') ? p.Href! : `/${p.Href}`,
        children: [],
      })),
    ];
  } else {
    // Build from user-navigation (preserves hierarchy)
    navItems = rawNav
      .filter((item) => item.Title != null)
      .map((item) => ({
        title: item.Title,
        href: (item.Href ?? '/').startsWith('/') ? (item.Href ?? '/') : `/${item.Href}`,
        children: (item.Children ?? [])
          .filter((c) => c.Title != null)
          .map((c) => ({
            title: c.Title,
            href: (c.Href ?? '/').startsWith('/') ? (c.Href ?? '/') : `/${c.Href}`,
          })),
      }));

    // Supplement: add any user-custom-pages with navigationStatus that aren't
    // already represented in user-navigation (by normalized title OR href).
    const navTitles = new Set<string>();
    const navHrefs = new Set<string>();
    for (const item of navItems) {
      navTitles.add(normText(item.title));
      navHrefs.add(item.href);
      for (const child of item.children) {
        navTitles.add(normText(child.title));
        navHrefs.add(child.href);
      }
    }

    const supplemental = customPages
      .filter((p) => p.navigationStatus && p.Href)
      .filter((p) => {
        const title = p['Stripped Title'] ?? p.PageTitle ?? '';
        const href = p.Href!.startsWith('/') ? p.Href! : `/${p.Href}`;
        return !navTitles.has(normText(title)) && !navHrefs.has(href);
      })
      .map((p) => ({
        title: p['Stripped Title'] ?? p.PageTitle ?? '',
        href: p.Href!.startsWith('/') ? p.Href! : `/${p.Href}`,
        children: [],
      }));

    if (supplemental.length > 0) {
      console.log(chalk.yellow(`  ⚠ Supplementing with ${supplemental.length} item(s) from user-custom-pages not in user-navigation:`));
      for (const s of supplemental) {
        console.log(chalk.gray(`    + ${s.title} → ${s.href}`));
      }
      navItems = [...navItems, ...supplemental];
    }
  }

  return navItems;
}

// ─── Unified nav item type for comparison ────────────────────────────────────

interface NormNavItem {
  text: string;
  href: string;
  children: Array<{ text: string; href: string }>;
}

function brNavToNorm(items: BRNavItem[]): NormNavItem[] {
  return items.map((i) => ({
    text: i.title,
    href: i.href,
    children: i.children.map((c) => ({ text: c.title, href: c.href })),
  }));
}

function wixNavToNorm(items: WixMenuItem[]): NormNavItem[] {
  return items.map((i) => ({
    text: i.text,
    href: i.path,
    children: i.subItems.map((s) => ({ text: s.text, href: s.path })),
  }));
}

// ─── Link validation ─────────────────────────────────────────────────────────

const SKIP_DOMAINS = [
  'facebook.com', 'twitter.com', 'x.com', 'linkedin.com',
  'instagram.com', 'youtube.com', 'tiktok.com', 'pinterest.com',
  'finra.org', 'sec.gov', 'sipc.org',
];

function shouldSkipValidation(href: string): boolean {
  if (!href || href === '#' || href.startsWith('javascript:') ||
      href.startsWith('mailto:') || href.startsWith('tel:')) return true;
  try {
    const hostname = new URL(href).hostname;
    return SKIP_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return true;
  }
}

async function validateLink(href: string, timeout = 15_000): Promise<{ status: number | null; error?: string }> {
  if (shouldSkipValidation(href)) return { status: null, error: 'skipped' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(href, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BR-Menu-Checker/1.0)' },
    }).finally(() => clearTimeout(timer));
    if (res.status === 405) throw new Error('HEAD not allowed');
    return { status: res.status };
  } catch {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(href, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BR-Menu-Checker/1.0)' },
      }).finally(() => clearTimeout(timer));
      return { status: res.status };
    } catch (err2) {
      return { status: null, error: (err2 as Error).message };
    }
  }
}

// ─── Core comparison logic (source-agnostic) ─────────────────────────────────

function compareMenus(
  sourceItems: NormNavItem[],
  migratedItems: WixMenuItem[],
  sourceLabel: string,
): MenuItemIssue[] {
  const issues: MenuItemIssue[] = [];

  // Detect duplicate items in the migrated menu
  const migratedTextCounts = new Map<string, number>();
  for (const item of migratedItems) {
    const norm = normText(item.text);
    if (!norm) continue;
    migratedTextCounts.set(norm, (migratedTextCounts.get(norm) ?? 0) + 1);
  }
  for (const [norm, count] of migratedTextCounts) {
    if (count > 1) {
      const item = migratedItems.find((m) => normText(m.text) === norm)!;
      issues.push({
        kind: 'duplicate',
        migratedText: item.text,
        migratedHref: item.href,
        migratedPath: item.path,
        note: `"${item.text}" appears ${count} times in the migrated menu`,
      });
    }
  }

  const migratedByNorm = new Map<string, WixMenuItem>();
  for (const item of migratedItems) {
    migratedByNorm.set(normText(item.text), item);
  }

  const allSourceByNorm = new Set<string>();
  for (const item of sourceItems) {
    allSourceByNorm.add(normText(item.text));
    for (const child of item.children) allSourceByNorm.add(normText(child.text));
  }

  // Build a flat list of all migrated items (top-level + sub) for href-based fallback matching
  const allMigratedFlat = [
    ...migratedItems.map((m) => ({ ...m, parent: undefined as WixMenuItem | undefined })),
    ...migratedItems.flatMap((m) => m.subItems.map((s) => ({ ...s, subItems: [] as typeof m.subItems, hasDropdown: false, parent: m }))),
  ];

  for (const srcItem of sourceItems) {
    const norm = normText(srcItem.text);
    let wixMatch = migratedByNorm.get(norm);

    // Check if it appears as a sub-item in migrated (top-level → nested)
    let wixAsSubItem = !wixMatch
      ? migratedItems
          .flatMap((m) => m.subItems.map((s) => ({ ...s, parent: m })))
          .find((s) => normText(s.text) === norm)
      : null;

    // Fallback: if the BR title is generic ("Custom Section N"), try matching
    // by extracting the readable page name from the BR href
    if (!wixMatch && !wixAsSubItem && CUSTOM_SECTION_RE.test(srcItem.text)) {
      const hrefNorm = normHrefAsTitle(srcItem.href);
      if (hrefNorm) {
        const hrefTopMatch = migratedByNorm.get(hrefNorm);
        const hrefSubMatch = !hrefTopMatch
          ? allMigratedFlat.find((m) => normText(m.text) === hrefNorm)
          : null;
        if (hrefTopMatch) {
          wixMatch = hrefTopMatch;
        } else if (hrefSubMatch?.parent) {
          wixAsSubItem = { ...hrefSubMatch, parent: hrefSubMatch.parent };
        } else if (hrefSubMatch) {
          wixMatch = hrefSubMatch as WixMenuItem;
        }
      }
    }

    // Fuzzy fallback: "About Us" ↔ "About", "Contact Us" ↔ "Contact", etc.
    // Match if one normalized name contains the other (min 4 chars, unique match)
    if (!wixMatch && !wixAsSubItem && norm.length >= 4) {
      const fuzzyMatches = [...migratedByNorm.entries()].filter(([mNorm]) =>
        mNorm.length >= 4 && (mNorm.includes(norm) || norm.includes(mNorm))
      );
      if (fuzzyMatches.length === 1) {
        wixMatch = fuzzyMatches[0][1];
      }
      if (!wixMatch) {
        const fuzzySubMatches = migratedItems
          .flatMap((m) => m.subItems.map((s) => ({ ...s, parent: m })))
          .filter((s) => {
            const sNorm = normText(s.text);
            return sNorm.length >= 4 && (sNorm.includes(norm) || norm.includes(sNorm));
          });
        if (fuzzySubMatches.length === 1) {
          wixAsSubItem = fuzzySubMatches[0];
        }
      }
    }

    if (!wixMatch && !wixAsSubItem) {
      issues.push({
        kind: 'missing',
        brTitle: srcItem.text,
        brHref: srcItem.href,
        note: `"${srcItem.text}" is in ${sourceLabel} but not found in the migrated site menu`,
      });
      continue;
    }

    if (wixAsSubItem) {
      issues.push({
        kind: 'structure-change',
        brTitle: srcItem.text,
        brHref: srcItem.href,
        migratedText: wixAsSubItem.text,
        migratedHref: wixAsSubItem.href,
        migratedPath: wixAsSubItem.path,
        note: `"${srcItem.text}" is top-level in ${sourceLabel} but nested under "${wixAsSubItem.parent.text}" in migrated`,
      });
      continue;
    }

    // Detect href-mismatch: dropdown-only parent now links to a real page
    const srcIsDropdown = isDropdownOnlyHref(srcItem.href) && srcItem.children.length > 0;
    const wixLinksToPage = isRealPageHref(wixMatch!.path ?? '');
    const hrefMismatch = srcIsDropdown && wixLinksToPage;

    // Item found — check children
    const subIssues: MenuItemIssue[] = [];
    const wixSubByNorm = new Map<string, { text: string; href: string; path: string }>();
    for (const sub of wixMatch!.subItems) {
      wixSubByNorm.set(normText(sub.text), sub);
    }

    for (const srcChild of srcItem.children) {
      const childNorm = normText(srcChild.text);
      let wixChild = wixSubByNorm.get(childNorm);
      let wixChildAsTopLevel = !wixChild ? migratedByNorm.get(childNorm) : null;

      // Fallback: generic "Custom Section N" sub-item → match by href page name
      if (!wixChild && !wixChildAsTopLevel && CUSTOM_SECTION_RE.test(srcChild.text)) {
        const hrefNorm = normHrefAsTitle(srcChild.href);
        if (hrefNorm) {
          wixChild = wixSubByNorm.get(hrefNorm) ?? undefined;
          if (!wixChild) wixChildAsTopLevel = migratedByNorm.get(hrefNorm) ?? null;
          if (!wixChild && !wixChildAsTopLevel) {
            const flat = allMigratedFlat.find((m) => normText(m.text) === hrefNorm);
            if (flat) wixChild = { text: flat.text, href: flat.href, path: flat.path ?? '' };
          }
        }
      }

      // Fuzzy fallback for sub-items
      if (!wixChild && !wixChildAsTopLevel && childNorm.length >= 4) {
        const fuzzySubMatches = [...wixSubByNorm.entries()].filter(([mNorm]) =>
          mNorm.length >= 4 && (mNorm.includes(childNorm) || childNorm.includes(mNorm))
        );
        if (fuzzySubMatches.length === 1) wixChild = fuzzySubMatches[0][1];
        if (!wixChild) {
          const fuzzyTopMatches = [...migratedByNorm.entries()].filter(([mNorm]) =>
            mNorm.length >= 4 && (mNorm.includes(childNorm) || childNorm.includes(mNorm))
          );
          if (fuzzyTopMatches.length === 1) wixChildAsTopLevel = fuzzyTopMatches[0][1];
        }
      }

      if (!wixChild && !wixChildAsTopLevel) {
        subIssues.push({
          kind: 'missing',
          brTitle: srcChild.text,
          brHref: srcChild.href,
          note: `Sub-item "${srcChild.text}" under "${srcItem.text}" is missing in migrated`,
        });
      } else if (wixChildAsTopLevel) {
        subIssues.push({
          kind: 'structure-change',
          brTitle: srcChild.text,
          brHref: srcChild.href,
          migratedText: wixChildAsTopLevel.text,
          migratedHref: wixChildAsTopLevel.href,
          migratedPath: wixChildAsTopLevel.path,
          note: `"${srcChild.text}" is a sub-item in ${sourceLabel} but top-level in migrated`,
        });
      } else if (wixChild) {
        subIssues.push({
          kind: 'ok',
          brTitle: srcChild.text,
          brHref: srcChild.href,
          migratedText: wixChild.text,
          migratedHref: wixChild.href,
          migratedPath: wixChild.path,
        });
      }
    }

    const structureNote = (srcItem.children.length === 0 && wixMatch!.subItems.length > 0)
      ? `"${srcItem.text}" has no sub-items in ${sourceLabel} but has ${wixMatch!.subItems.length} sub-items in migrated`
      : undefined;

    const hrefNote = hrefMismatch
      ? `"${srcItem.text}" should be a dropdown (${srcItem.href}) but migrated links to ${wixMatch!.path}`
      : undefined;

    const issueKind: IssueKind = hrefMismatch ? 'href-mismatch'
      : structureNote ? 'structure-change'
      : 'ok';

    issues.push({
      kind: issueKind,
      brTitle: srcItem.text,
      brHref: srcItem.href,
      migratedText: wixMatch!.text,
      migratedHref: wixMatch!.href,
      migratedPath: wixMatch!.path,
      note: hrefNote ?? structureNote,
      subIssues: subIssues.length > 0 ? subIssues : undefined,
    });
  }

  // Flag extra items in migrated (not in source) — both top-level AND sub-items
  const allMigratedEntries: Array<{ text: string; href: string; path: string; parent?: string }> = [];
  for (const wixItem of migratedItems) {
    allMigratedEntries.push({ text: wixItem.text, href: wixItem.href, path: wixItem.path });
    for (const sub of wixItem.subItems) {
      allMigratedEntries.push({ text: sub.text, href: sub.href, path: sub.path, parent: wixItem.text });
    }
  }
  for (const entry of allMigratedEntries) {
    const wNorm = normText(entry.text);
    if (!wNorm) continue;
    const exactMatch = allSourceByNorm.has(wNorm);
    const fuzzyMatch = !exactMatch && wNorm.length >= 4
      ? [...allSourceByNorm].some((s) => s.length >= 4 && (s.includes(wNorm) || wNorm.includes(s)))
      : false;
    if (!exactMatch && !fuzzyMatch) {
      const parentNote = entry.parent ? ` (under "${entry.parent}")` : '';
      issues.push({
        kind: 'extra',
        migratedText: entry.text,
        migratedHref: entry.href,
        migratedPath: entry.path,
        note: `"${entry.text}"${parentNote} appears in the migrated menu but is not in ${sourceLabel}`,
      });
    }
  }

  return issues;
}

function buildSummary(
  issues: MenuItemIssue[],
  totalSourceItems: number,
  totalMigratedItems: number,
): MenuSectionSummary {
  const countKind = (k: IssueKind): number =>
    issues.filter((i) => i.kind === k).length +
    issues.flatMap((i) => i.subIssues ?? []).filter((i) => i.kind === k).length;

  return {
    totalSourceItems,
    totalMigratedItems,
    missing: countKind('missing'),
    extra: countKind('extra'),
    brokenLinks: countKind('broken-link'),
    duplicates: countKind('duplicate'),
    hrefMismatches: countKind('href-mismatch'),
    structureChanges: countKind('structure-change'),
    ok: countKind('ok'),
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function checkMenu(options: MenuCheckOptions): Promise<MenuCheckResult> {
  const { original, migrated, auth, timeout = 30_000 } = options;

  console.log(chalk.bold('\n═══ Menu Check ═══\n'));
  console.log(chalk.cyan(`Original (BR JSON): ${original}`));
  console.log(chalk.cyan(`Migrated (Wix):     ${migrated}\n`));

  // ── Step 1: Fetch BR Source API ───────────────────────────────────────────
  console.log(chalk.yellow('Step 1/4: Fetching BR nav from source API...'));
  let siteData: BRSiteData | null = null;
  try {
    siteData = await fetchSiteData(original, auth);
    console.log(chalk.green(`  ✓ BR API data fetched (${siteData['user-navigation']?.length ?? 0} nav items)`));
  } catch (err) {
    console.log(chalk.red(`  ✗ BR API failed: ${(err as Error).message}`));
  }

  const brNavItems = siteData ? extractBRNav(siteData) : [];
  console.log(chalk.green(`  ✓ BR nav: ${brNavItems.length} top-level items`));
  for (const item of brNavItems) {
    const childStr = item.children.length > 0 ? ` (${item.children.length} sub-items)` : '';
    console.log(chalk.gray(`    • ${item.title} → ${item.href}${childStr}`));
  }

  // ── Step 2: Crawl Wix migrated site menu ─────────────────────────────────
  console.log(chalk.yellow('\nStep 2/5: Crawling Wix migrated site menu...'));
  let migratedItems: WixMenuItem[] = [];
  let migratedIdentity: SiteIdentity | null = null;
  let siteHealth: SiteHealthResult | undefined;
  try {
    const { page, context } = await openPage(migrated, '/', 'desktop', timeout, false, 0);
    try {
      const menuSnapshot = await analyzeMenu(page);
      migratedItems = menuSnapshot.items.map((item) => ({
        text: item.text,
        href: item.href,
        path: extractPath(item.href, migrated),
        subItems: item.subItems.map((sub) => ({
          text: sub.text,
          href: sub.href,
          path: extractPath(sub.href, migrated),
        })),
        hasDropdown: item.hasDropdown,
      }));

      // Extract content identity while page is still open
      try {
        migratedIdentity = await extractIdentity(page);
        console.log(chalk.green(`  ✓ Migrated identity: ${migratedIdentity.companyNames.length} company names, ${migratedIdentity.phoneNumbers.length} phones, ${migratedIdentity.emailAddresses.length} emails`));
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Could not extract migrated identity: ${(err as Error).message}`));
      }

      // Run site health checks (BrokerCheck + domain) while page is open
      try {
        siteHealth = await runSiteHealthChecks(page, migrated);
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Site health checks failed: ${(err as Error).message}`));
      }
    } finally {
      await context.close();
    }
    console.log(chalk.green(`  ✓ Wix menu: ${migratedItems.length} top-level items`));
    for (const item of migratedItems) {
      const subStr = item.subItems.length > 0 ? ` (${item.subItems.length} sub-items)` : '';
      console.log(chalk.gray(`    • ${item.text} → ${item.path}${subStr}`));
    }
  } catch (err) {
    console.log(chalk.red(`  ✗ Failed to crawl Wix menu: ${(err as Error).message}`));
  }

  // ── Step 3: Crawl original live site menu ────────────────────────────────
  console.log(chalk.yellow('\nStep 3/5: Crawling original live site menu...'));
  let originalItems: WixMenuItem[] = [];
  let originalCrawlFailed = false;
  let originalCrawlError: string | undefined;
  let originalIdentity: SiteIdentity | null = null;
  const originalUrl = original.startsWith('http') ? original : `https://${original}`;
  try {
    const { page, context } = await openPage(originalUrl, '/', 'desktop', timeout, false, 0);
    try {
      const menuSnapshot = await analyzeMenu(page);
      originalItems = menuSnapshot.items.map((item) => ({
        text: item.text,
        href: item.href,
        path: extractPath(item.href, originalUrl),
        subItems: item.subItems.map((sub) => ({
          text: sub.text,
          href: sub.href,
          path: extractPath(sub.href, originalUrl),
        })),
        hasDropdown: item.hasDropdown,
      }));

      try {
        originalIdentity = await extractIdentity(page);
        console.log(chalk.green(`  ✓ Original identity: ${originalIdentity.companyNames.length} company names, ${originalIdentity.phoneNumbers.length} phones, ${originalIdentity.emailAddresses.length} emails`));
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Could not extract original identity: ${(err as Error).message}`));
      }
    } finally {
      await context.close();
    }
    console.log(chalk.green(`  ✓ Original menu: ${originalItems.length} top-level items`));
    for (const item of originalItems) {
      const subStr = item.subItems.length > 0 ? ` (${item.subItems.length} sub-items)` : '';
      console.log(chalk.gray(`    • ${item.text} → ${item.path}${subStr}`));
    }
  } catch (playwrightErr) {
    const playwrightMsg = (playwrightErr as Error).message;
    console.log(chalk.yellow(`  ⚠ Playwright failed: ${playwrightMsg.substring(0, 100)}`));
    console.log(chalk.yellow('  ↻ Retrying with fetch+JSDOM fallback...'));

    try {
      const fallback = await fetchAndParse(originalUrl, timeout);
      originalItems = fallback.menu.items.map((item) => ({
        text: item.text,
        href: item.href,
        path: extractPath(item.href, originalUrl),
        subItems: item.subItems.map((sub) => ({
          text: sub.text,
          href: sub.href,
          path: extractPath(sub.href, originalUrl),
        })),
        hasDropdown: item.hasDropdown,
      }));
      originalIdentity = fallback.identity;
      console.log(chalk.green(`  ✓ Fetch fallback OK — menu: ${originalItems.length} top-level items, identity: ${originalIdentity.companyNames.length} company names, ${originalIdentity.phoneNumbers.length} phones, ${originalIdentity.emailAddresses.length} emails`));
      for (const item of originalItems) {
        const subStr = item.subItems.length > 0 ? ` (${item.subItems.length} sub-items)` : '';
        console.log(chalk.gray(`    • ${item.text} → ${item.path}${subStr}`));
      }
    } catch (fetchErr) {
      originalCrawlFailed = true;
      originalCrawlError = `Playwright: ${playwrightMsg.substring(0, 100)} | Fetch: ${(fetchErr as Error).message.substring(0, 100)}`;
      console.log(chalk.red(`  ✗ Fetch fallback also failed: ${(fetchErr as Error).message.substring(0, 100)}`));
      console.log(chalk.gray('    Parts 2 and 3 of the report will be unavailable for this site.'));
    }
  }

  // ── Step 4: Compare and validate links ───────────────────────────────────
  console.log(chalk.yellow('\nStep 4/5: Comparing and validating links...'));

  // Part 1: BR JSON vs Migrated
  const issues = compareMenus(brNavToNorm(brNavItems), migratedItems, 'the BR navigation JSON');

  // Part 2: Original live site vs Migrated
  const liveIssues = originalCrawlFailed
    ? []
    : compareMenus(wixNavToNorm(originalItems), migratedItems, 'the original live site');

  // Validate all migrated links
  console.log(chalk.yellow('\n  Validating migrated menu links...'));
  const linksToValidate: Array<{ text: string; href: string }> = [];
  const seenHrefs = new Set<string>();
  for (const item of migratedItems) {
    if (item.href && !seenHrefs.has(item.href)) {
      seenHrefs.add(item.href);
      linksToValidate.push({ text: item.text, href: item.href });
    }
    for (const sub of item.subItems) {
      if (sub.href && !seenHrefs.has(sub.href)) {
        seenHrefs.add(sub.href);
        linksToValidate.push({ text: sub.text, href: sub.href });
      }
    }
  }

  const linkResults = new Map<string, { status: number | null; error?: string }>();
  for (const { text, href } of linksToValidate) {
    const result = await validateLink(href, timeout);
    linkResults.set(href, result);
    if (result.status === null) {
      console.log(chalk.gray(`    ⊘ ${text} → ${result.error ?? 'skipped'}`));
    } else if (result.status >= 200 && result.status < 400) {
      console.log(chalk.green(`    ✓ ${text} → HTTP ${result.status}`));
    } else {
      console.log(chalk.red(`    ✗ ${text} → HTTP ${result.status}`));
    }
  }

  // Add broken-link issues to BOTH sections
  const addBrokenLinks = (issueList: MenuItemIssue[]) => {
    for (const item of migratedItems) {
      const checkHref = (href: string, text: string) => {
        const result = linkResults.get(href);
        if (!result || result.status === null) return;
        if (result.status < 200 || result.status >= 400) {
          issueList.push({
            kind: 'broken-link',
            migratedText: text,
            migratedHref: href,
            migratedPath: extractPath(href, migrated),
            httpStatus: result.status,
            note: `"${text}" → HTTP ${result.status} (${href})`,
          });
        }
      };
      if (item.href) checkHref(item.href, item.text);
      for (const sub of item.subItems) {
        if (sub.href) checkHref(sub.href, sub.text);
      }
    }
  };

  addBrokenLinks(issues);
  addBrokenLinks(liveIssues);

  // ── Summaries ─────────────────────────────────────────────────────────────
  const allBrFlat = brNavItems.flatMap((i) => [i, ...i.children.map((c) => ({ ...c, children: [] }))]);
  const allWixFlat = migratedItems.flatMap((i) => [i, ...i.subItems]);
  const allOrigFlat = originalItems.flatMap((i) => [i, ...i.subItems]);

  const summaryBase = buildSummary(issues, allBrFlat.length, allWixFlat.length);
  const summary = { ...summaryBase, totalBrItems: allBrFlat.length };

  const liveSummary = buildSummary(liveIssues, allOrigFlat.length, allWixFlat.length);

  console.log(chalk.bold('\n═══ Summary — Part 1: BR JSON vs Migrated ═══\n'));
  console.log(`  BR JSON items:     ${summary.totalBrItems}`);
  console.log(`  Migrated items:    ${summary.totalMigratedItems}`);
  console.log(summary.missing > 0 ? chalk.red(`  Missing:           ${summary.missing}`) : chalk.green(`  Missing:           0`));
  console.log(summary.brokenLinks > 0 ? chalk.red(`  Broken links:      ${summary.brokenLinks}`) : chalk.green(`  Broken links:      0`));
  console.log(summary.duplicates > 0 ? chalk.red(`  Duplicates:        ${summary.duplicates}`) : chalk.green(`  Duplicates:        0`));
  console.log(summary.hrefMismatches > 0 ? chalk.red(`  Href mismatches:   ${summary.hrefMismatches}`) : chalk.green(`  Href mismatches:   0`));
  console.log(summary.structureChanges > 0 ? chalk.blue(`  Structure changes: ${summary.structureChanges}`) : chalk.green(`  Structure changes: 0`));
  console.log(summary.extra > 0 ? chalk.blue(`  Extra (new):       ${summary.extra}`) : chalk.green(`  Extra (new):       0`));

  if (!originalCrawlFailed) {
    console.log(chalk.bold('\n═══ Summary — Part 2: Original Live Site vs Migrated ═══\n'));
    console.log(`  Original items:    ${liveSummary.totalSourceItems}`);
    console.log(`  Migrated items:    ${liveSummary.totalMigratedItems}`);
    console.log(liveSummary.missing > 0 ? chalk.red(`  Missing:           ${liveSummary.missing}`) : chalk.green(`  Missing:           0`));
    console.log(liveSummary.brokenLinks > 0 ? chalk.red(`  Broken links:      ${liveSummary.brokenLinks}`) : chalk.green(`  Broken links:      0`));
    console.log(liveSummary.duplicates > 0 ? chalk.red(`  Duplicates:        ${liveSummary.duplicates}`) : chalk.green(`  Duplicates:        0`));
    console.log(liveSummary.hrefMismatches > 0 ? chalk.red(`  Href mismatches:   ${liveSummary.hrefMismatches}`) : chalk.green(`  Href mismatches:   0`));
    console.log(liveSummary.structureChanges > 0 ? chalk.blue(`  Structure changes: ${liveSummary.structureChanges}`) : chalk.green(`  Structure changes: 0`));
    console.log(liveSummary.extra > 0 ? chalk.blue(`  Extra (new):       ${liveSummary.extra}`) : chalk.green(`  Extra (new):       0`));
  } else {
    console.log(chalk.yellow('\n  Part 2 skipped — original site could not be crawled.'));
  }

  // ── Step 5: Content identity comparison ─────────────────────────────────
  console.log(chalk.yellow('\nStep 5/5: Comparing content identity markers...'));
  let contentCheck: ContentCheckResult | undefined;
  if (originalIdentity && migratedIdentity) {
    const mismatches = compareIdentities(originalIdentity, migratedIdentity, original);
    contentCheck = { originalIdentity, migratedIdentity, mismatches };
    const criticalCount = mismatches.filter((m) => m.severity === 'critical').length;
    const warningCount = mismatches.filter((m) => m.severity === 'warning').length;
    if (criticalCount > 0) {
      console.log(chalk.red(`  ✗ ${criticalCount} critical content mismatch(es) found!`));
    }
    if (warningCount > 0) {
      console.log(chalk.yellow(`  ⚠ ${warningCount} content warning(s)`));
    }
    if (mismatches.length === 0) {
      console.log(chalk.green('  ✓ Content identity markers match'));
    }
    for (const m of mismatches) {
      const icon = m.severity === 'critical' ? chalk.red('  ✗') : chalk.yellow('  ⚠');
      console.log(`${icon} [${m.field}] ${m.note}`);
    }
  } else if (originalCrawlFailed) {
    const templateMismatches = migratedIdentity
      ? checkForKnownTemplateArtifacts(migratedIdentity)
      : [];
    contentCheck = {
      originalIdentity: null,
      migratedIdentity,
      mismatches: templateMismatches,
      error: templateMismatches.length > 0 ? undefined : 'Original site could not be crawled',
    };
    if (templateMismatches.length > 0) {
      console.log(chalk.red(`  ✗ ${templateMismatches.length} known template artifact(s) found on migrated site (original unavailable):`));
      for (const m of templateMismatches) {
        console.log(chalk.red(`  ✗ [${m.field}] ${m.note}`));
      }
    } else {
      console.log(chalk.yellow('  Part 3 limited — original site could not be crawled (template artifacts checked, none found).'));
    }
  } else {
    contentCheck = { originalIdentity, migratedIdentity, mismatches: [], error: 'Identity extraction failed' };
    console.log(chalk.yellow('  Part 3 skipped — identity extraction failed for one or both sites.'));
  }

  // ── Log site health results ──────────────────────────────────────────────
  if (!siteHealth) {
    siteHealth = {
      brokerCheck: { found: false, type: 'none', position: 'none', details: 'Migrated page not crawled', severity: 'warning' },
      domainCheck: checkDomainConnection(migrated),
    };
  }

  console.log(chalk.bold('\n═══ Part 4: BrokerCheck Banner ═══\n'));
  if (siteHealth.brokerCheck.found) {
    const icon = siteHealth.brokerCheck.severity === 'ok' ? chalk.green('  ✓') :
                 siteHealth.brokerCheck.severity === 'critical' ? chalk.red('  ✗') : chalk.yellow('  ⚠');
    console.log(`${icon} ${siteHealth.brokerCheck.details}`);
    console.log(chalk.gray(`    Type: ${siteHealth.brokerCheck.type} | Position: ${siteHealth.brokerCheck.position}`));
  } else {
    console.log(chalk.gray('  No BrokerCheck banner detected'));
  }

  console.log(chalk.bold('\n═══ Part 5: Domain Connection ═══\n'));
  const domIcon = siteHealth.domainCheck.hasCustomDomain ? chalk.green('  ✓') : chalk.yellow('  ⚠');
  console.log(`${domIcon} ${siteHealth.domainCheck.details}`);

  return {
    originalDomain: original,
    migratedDomain: migrated,
    capturedAt: new Date().toISOString(),
    brNavItems,
    originalItems,
    migratedItems,
    issues,
    summary,
    liveIssues,
    liveSummary,
    originalCrawlFailed,
    originalCrawlError,
    contentCheck,
    siteHealth,
  };
}
