import chalk from 'chalk';
import type { SiteSnapshot, SnapshotDiff, CompareSitesOptions, ViewportName, PageSnapshot } from '../types/index.js';
import { scanSite } from '../scanner.js';
import { compareSnapshots } from './snapshot-differ.js';
import { generateHtmlReport } from '../reporters/html-reporter.js';
import { generateCsvReport } from '../reporters/csv-reporter.js';
import { saveSnapshot, ensureDir } from '../utils/fs-helpers.js';
import { fetchSiteData, getPageUrls, detectSiteType } from '../api/site-fetcher.js';

export async function compareSites(options: CompareSitesOptions): Promise<SnapshotDiff> {
  console.log(chalk.bold('\n═══ Cross-Site Comparison ═══\n'));
  console.log(chalk.cyan(`Original: ${options.original}`));
  console.log(chalk.cyan(`Migrated: ${options.migrated}\n`));

  let originalSnapshot: SiteSnapshot;

  if (options.skipOriginalCrawl) {
    console.log(chalk.yellow('Step 1/4: Building original snapshot from BR API (no live crawl)...'));
    options.onProgress?.('Step 1/4: Building original snapshot from BR API...');
    originalSnapshot = await buildApiOnlySnapshot(options.original, options.auth);
    console.log(chalk.green(`  ✓ API snapshot: ${originalSnapshot.pages.length} page(s) from BR source`));
  } else {
    console.log(chalk.yellow('Step 1/4: Scanning original site...'));
    options.onProgress?.('Step 1/4: Scanning original site...');
    const result = await scanSite({
      domain: options.original,
      label: 'original',
      viewports: options.viewports,
      screenshots: options.screenshots,
      concurrency: options.concurrency,
      timeout: options.timeout,
      auth: options.auth,
      output: `${options.output}/original`,
      csv: false,
      onProgress: options.onProgress,
    });
    originalSnapshot = result.snapshot;
  }

  console.log(chalk.yellow('Step 2/4: Scanning migrated site...'));
  options.onProgress?.('Step 2/4: Scanning migrated site...');
  const { snapshot: migratedSnapshot } = await scanSite({
    domain: options.migrated,
    label: 'migrated',
    viewports: options.viewports,
    screenshots: options.screenshots,
    concurrency: options.concurrency,
    timeout: options.timeout,
    auth: options.auth,
    output: `${options.output}/migrated`,
    csv: false,
    onProgress: options.onProgress,
  });

  console.log(chalk.yellow('Step 3/4: Comparing snapshots...'));
  const diff = compareSnapshots(originalSnapshot, migratedSnapshot, 'cross-site');

  console.log(chalk.yellow('Step 4/4: Generating reports...'));
  const reportDir = `${options.output}/comparison`;
  await ensureDir(reportDir);

  await saveSnapshot(originalSnapshot, `${options.output}/original/snapshot.json`);
  await saveSnapshot(migratedSnapshot, `${options.output}/migrated/snapshot.json`);

  const htmlPath = `${reportDir}/report.html`;
  await generateHtmlReport(diff, originalSnapshot, migratedSnapshot, htmlPath);

  if (options.csv) {
    await generateCsvReport(diff, `${reportDir}/report.csv`);
  }

  printSummary(diff);

  return diff;
}

/**
 * Builds a minimal SiteSnapshot from the BR Source API without any Playwright crawl.
 * Used when the original site is Cloudflare-blocked. Provides:
 *   - page list (from user-custom-pages)
 *   - menu items (derived from navigation pages)
 *   - empty links/sections/ctas (comparison will only flag issues on migrated side)
 */
async function buildApiOnlySnapshot(domain: string, auth?: string): Promise<SiteSnapshot> {
  let siteData = null;
  try {
    siteData = await fetchSiteData(domain, auth);
  } catch {
    // API unavailable — return a minimal empty snapshot so comparison can still run
  }

  const siteType = siteData ? detectSiteType(siteData) : 'flex';
  const apiPages = siteData ? getPageUrls(siteData) : [];

  // Always include home page
  const allPages = [{ id: 'homepage', url: '/', title: 'Home' }, ...apiPages];

  // Build empty page snapshots — the comparison will check the migrated site against these
  const emptyViewport = {
    viewport: { width: 1280, height: 800 },
    hasHorizontalScroll: false,
    smallestFontSize: 0,
    smallestFontElement: '',
    textOverflows: [],
    paddingIssues: [],
  };

  const pages: PageSnapshot[] = allPages.map((p) => ({
    url: p.url,
    title: p.title,
    pageId: p.id,
    links: [],
    ctas: [],
    sections: [],
    forms: [],
    // Leave menu empty — flat API pages don't reflect real nav hierarchy (dropdown structure),
    // so comparing them against the migrated site's actual menu causes false positives.
    menu: { items: [] },
    contactInfo: [],
    images: [],
    viewports: { desktop: emptyViewport, tablet: emptyViewport, mobile: emptyViewport },
    accessibilityAudit: null,
    hasPrintButton: false,
    hasBackToTopButton: false,
    jsConsoleErrors: [],
    placeholderTexts: [],
    invalidCTAs: [],
    invalidContactLinks: [],
    sliderControls: [],
    mapEmbeds: [],
  }));

  return {
    domain,
    capturedAt: new Date().toISOString(),
    scanLabel: 'original (api-only)',
    siteType,
    pages,
    metadata: {
      liveStatus: siteData?.['Live-Site-Status'] ?? 'unknown',
      flexXmlFound: siteData != null,
      pageCount: pages.length,
      scanDurationMs: 0,
    },
  };
}

function printSummary(diff: SnapshotDiff): void {
  const { summary } = diff;
  console.log(chalk.bold('\n═══ Comparison Summary ═══\n'));
  console.log(`  Original:  ${diff.originalDomain}`);
  console.log(`  Migrated:  ${diff.migratedDomain}`);
  console.log(`  Mode:      ${diff.mode}\n`);
  console.log(`  Total diffs:    ${summary.totalChecks}`);
  console.log(chalk.green(`  Matches:        ${summary.passed}`));
  console.log(chalk.red(`  Mismatches:     ${summary.failed}`));
  console.log(chalk.blue(`  New in migrated: ${summary.newIssues}`));

  if (summary.failed > 0) {
    console.log(chalk.red('\n  Critical issues:'));
    const critical = diff.items.filter((i) => i.severity === 'critical');
    for (const item of critical.slice(0, 10)) {
      console.log(chalk.red(`    ✗ ${item.description}`));
    }
    if (critical.length > 10) {
      console.log(chalk.red(`    ... and ${critical.length - 10} more`));
    }
  }

  console.log('');
}
