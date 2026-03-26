import chalk from 'chalk';
import type {
  SiteSnapshot,
  PageSnapshot,
  ScanOptions,
  ViewportName,
  LinkValidationResult,
  ValidationReport,
} from './types/index.js';
import { VIEWPORTS } from './config.js';
import { fetchSiteData } from './api/site-fetcher.js';
import { discoverPages } from './crawler/page-discovery.js';
import { collectAllLinks } from './crawler/link-collector.js';
import { collectAllCTAs } from './crawler/cta-collector.js';
import { inspectAllSections } from './crawler/section-inspector.js';
import { detectForms } from './crawler/form-detector.js';
import { auditImages } from './crawler/image-auditor.js';
import { analyzeMenu } from './crawler/menu-analyzer.js';
import { extractContactInfo } from './crawler/contact-extractor.js';
import { measureLayout } from './crawler/layout-measurer.js';
import { validateLinks } from './validators/link-validator.js';
import { validateCTAs } from './validators/cta-validator.js';
import { runAllRules } from './validators/rules-engine.js';
import { openPage, waitForFullLoad, closeBrowser } from './utils/playwright-helpers.js';
import { saveSnapshot, ensureDir } from './utils/fs-helpers.js';
import { generateHtmlReport } from './reporters/html-reporter.js';
import { generateCsvReport } from './reporters/csv-reporter.js';

export async function scanSite(options: ScanOptions): Promise<SiteSnapshot> {
  const startTime = Date.now();
  const { domain, label, viewports, screenshots, timeout, auth, output } = options;

  console.log(chalk.cyan(`\nScanning ${domain} (label: ${label})...\n`));

  let siteData = null;
  try {
    siteData = await fetchSiteData(domain, auth);
    console.log(chalk.green('  ✓ Fetched site data from BR Source API'));
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Could not fetch BR Source API (will crawl menu): ${(err as Error).message}`));
  }

  const { page: homePage, context } = await openPage(domain, '/', 'desktop', timeout);
  await waitForFullLoad(homePage);
  console.log(chalk.green('  ✓ Opened homepage'));

  const discoveredPages = await discoverPages(domain, siteData, homePage);
  console.log(chalk.green(`  ✓ Discovered ${discoveredPages.length} page(s)`));

  await context.close();

  const pageSnapshots: PageSnapshot[] = [];
  const allLinkResults = new Map<string, LinkValidationResult[]>();

  for (const discoveredPage of discoveredPages) {
    console.log(chalk.cyan(`\n  Scanning page: ${discoveredPage.title} (${discoveredPage.url})`));
    const pageSnapshot = await scanPage(domain, discoveredPage.url, discoveredPage, viewports, screenshots, output, timeout);
    pageSnapshots.push(pageSnapshot);

    console.log(chalk.yellow(`    Validating ${pageSnapshot.links.length} links...`));
    const linkResults = await validateLinks(pageSnapshot.links);
    allLinkResults.set(pageSnapshot.url, linkResults);

    const broken = linkResults.filter((l) => l.isFlagged);
    if (broken.length > 0) {
      console.log(chalk.red(`    ✗ ${broken.length} broken link(s) found`));
    } else {
      console.log(chalk.green(`    ✓ All links OK`));
    }
  }

  const snapshot: SiteSnapshot = {
    domain,
    capturedAt: new Date().toISOString(),
    scanLabel: label,
    siteType: 'vanilla',
    pages: pageSnapshots,
    metadata: {
      liveStatus: siteData?.['Live-Site-Status'] ?? 'unknown',
      flexXmlFound: siteData != null,
      pageCount: pageSnapshots.length,
      scanDurationMs: Date.now() - startTime,
    },
  };

  await ensureDir(output);
  await saveSnapshot(snapshot, `${output}/snapshot.json`);
  console.log(chalk.green(`\n  ✓ Snapshot saved to ${output}/snapshot.json`));

  const report = runAllRules(snapshot, allLinkResults);
  console.log(chalk.green(`  ✓ Ran ${report.totalChecks} rule checks (${report.passed} passed, ${report.failed} failed)`));

  return snapshot;
}

async function scanPage(
  domain: string,
  path: string,
  pageInfo: { id: string; url: string; title: string },
  viewports: ViewportName[],
  screenshots: boolean,
  outputDir: string,
  timeout: number
): Promise<PageSnapshot> {
  const viewportMetrics: PageSnapshot['viewports'] = {
    desktop: emptyViewportMetrics('desktop'),
    tablet: emptyViewportMetrics('tablet'),
    mobile: emptyViewportMetrics('mobile'),
  };

  let links: PageSnapshot['links'] = [];
  let ctas: PageSnapshot['ctas'] = [];
  let sections: PageSnapshot['sections'] = [];
  let forms: PageSnapshot['forms'] = [];
  let images: PageSnapshot['images'] = [];
  let menu: PageSnapshot['menu'] = { items: [] };
  let contactInfo: PageSnapshot['contactInfo'] = [];

  for (const vpName of viewports) {
    const { context, page } = await openPage(domain, path, vpName, timeout);

    try {
      await waitForFullLoad(page);

      if (vpName === 'desktop') {
        links = await collectAllLinks(page);
        ctas = await collectAllCTAs(page);
        const screenshotDir = screenshots ? `${outputDir}/screenshots/${pageInfo.id}` : undefined;
        sections = await inspectAllSections(page, screenshots, screenshotDir);
        forms = await detectForms(page);
        images = await auditImages(page);
        menu = await analyzeMenu(page);
        contactInfo = await extractContactInfo(page);
        console.log(chalk.gray(`    [desktop] ${links.length} links, ${ctas.length} CTAs, ${sections.filter(s => s.isPresent).length} sections, ${forms.length} forms`));
      }

      viewportMetrics[vpName] = await measureLayout(page);
    } finally {
      await context.close();
    }
  }

  return {
    url: path,
    title: pageInfo.title,
    pageId: pageInfo.id,
    links,
    ctas,
    sections,
    forms,
    menu,
    contactInfo,
    images,
    viewports: viewportMetrics,
  };
}

function emptyViewportMetrics(vpName: ViewportName): PageSnapshot['viewports']['desktop'] {
  return {
    viewport: VIEWPORTS[vpName],
    hasHorizontalScroll: false,
    smallestFontSize: 0,
    smallestFontElement: '',
    textOverflows: [],
    paddingIssues: [],
  };
}
