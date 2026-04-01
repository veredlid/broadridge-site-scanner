import chalk from 'chalk';
import type {
  SiteSnapshot,
  PageSnapshot,
  ScanOptions,
  ScanResult,
  ViewportName,
  LinkValidationResult,
  ValidationReport,
} from './types/index.js';
import { VIEWPORTS } from './config.js';
import { fetchSiteData, detectSiteType, extractBrContentByPage } from './api/site-fetcher.js';
import { comparePageContent, matchBrPagesToWixPages } from './utils/content-comparator.js';
import { discoverPages } from './crawler/page-discovery.js';
import { collectAllLinks } from './crawler/link-collector.js';
import { collectAllCTAs, detectPrintButton, detectBackToTopButton } from './crawler/cta-collector.js';
import { detectPlaceholderTexts, detectInvalidCTAs, detectInvalidContactLinks } from './crawler/page-health-checker.js';
import { detectSliderControls, detectMapEmbeds } from './crawler/widget-inspector.js';
import { inspectAllSections } from './crawler/section-inspector.js';
import { detectForms } from './crawler/form-detector.js';
import { auditImages } from './crawler/image-auditor.js';
import { analyzeMenu } from './crawler/menu-analyzer.js';
import { extractContactInfo } from './crawler/contact-extractor.js';
import { extractAccessibilityData } from './crawler/accessibility-extractor.js';
import { measureLayout } from './crawler/layout-measurer.js';
import { validateLinks } from './validators/link-validator.js';
import { validateCTAs } from './validators/cta-validator.js';
import { runAllRules } from './validators/rules-engine.js';
import { openPage, waitForFullLoad, closeBrowser, closeHeadedBrowser } from './utils/playwright-helpers.js';
import { saveSnapshot, ensureDir } from './utils/fs-helpers.js';
import { generateHtmlReport } from './reporters/html-reporter.js';
import { generateCsvReport } from './reporters/csv-reporter.js';

const DEFAULT_PAGE_CONCURRENCY = 2;

export async function scanSite(options: ScanOptions): Promise<ScanResult> {
  const startTime = Date.now();
  const { domain, label, viewports, screenshots, timeout, auth, output, onProgress } = options;
  const headed = options.headed ?? false;
  const slowMo = options.slowMo ?? (headed ? 400 : 0);

  const log = (msg: string, step?: number, total?: number) => {
    console.log(msg);
    onProgress?.(msg.replace(/\u001b\[[0-9;]*m/g, ''), step, total);
  };

  log(chalk.cyan(`\nScanning ${domain} (label: ${label})...\n`));

  let siteData = null;
  // Skip BR Source API for Wix preview/staging domains — they're never indexed there
  const isPreviewDomain = domain.includes('brprodaccount.com') || domain.includes('wixsite.com');
  if (isPreviewDomain) {
    log(chalk.cyan('  ↩ Preview domain — skipping BR Source API, crawling menu directly'), 1);
  } else {
    try {
      siteData = await fetchSiteData(domain, auth);
      log(chalk.green('  ✓ Fetched site data from BR Source API'), 1);
    } catch (err) {
      log(chalk.yellow(`  ⚠ Could not fetch BR Source API (will crawl menu): ${(err as Error).message}`), 1);
    }
  }

  // Determine site type: explicit option wins, then API auto-detect, then default
  const siteType: SiteSnapshot['siteType'] =
    options.siteType ??
    (siteData ? detectSiteType(siteData) : 'flex');
  log(chalk.cyan(`  Site type: ${siteType}${options.siteType ? '' : ' (auto-detected)'}`), 1);

  if (headed) log(chalk.magenta('  👁  Headed mode — Chrome window will open'), 1);

  const { page: homePage, context } = await openPage(domain, '/', 'desktop', timeout, headed, slowMo);
  await waitForFullLoad(homePage);
  log(chalk.green('  ✓ Opened homepage'), 2);

  const discoveredPages = await discoverPages(domain, siteData, homePage);
  log(chalk.green(`  ✓ Discovered ${discoveredPages.length} page(s)`), 3, discoveredPages.length);

  await context.close();

  const allLinkResults = new Map<string, LinkValidationResult[]>();
  let scannedCount = 0;

  const rawSnapshots = await runWithConcurrency(
    discoveredPages,
    DEFAULT_PAGE_CONCURRENCY,
    async (discoveredPage) => {
      const pageNum = ++scannedCount;
      log(chalk.cyan(`\n  Scanning page: ${discoveredPage.title} (${discoveredPage.url})`), pageNum, discoveredPages.length);

      let pageSnapshot: Awaited<ReturnType<typeof scanPage>>;
      try {
        pageSnapshot = await scanPage(domain, discoveredPage.url, discoveredPage, viewports, screenshots, output, timeout, headed, slowMo);
      } catch (pageErr: unknown) {
        const msg = pageErr instanceof Error ? pageErr.message : String(pageErr);
        log(chalk.yellow(`    ⚠ Skipping page (error): ${msg.split('\n')[0]}`), pageNum, discoveredPages.length);
        // Return null — filtered out below
        return null;
      }

      log(chalk.yellow(`    Validating ${pageSnapshot.links.length} links...`), pageNum, discoveredPages.length);
      const linkResults = await validateLinks(pageSnapshot.links);
      allLinkResults.set(pageSnapshot.url, linkResults);

      for (const lr of linkResults) {
        const matchingLink = pageSnapshot.links.find((l) => l.href === lr.href);
        if (matchingLink) matchingLink.httpStatus = lr.httpStatus;
      }

      const broken = linkResults.filter((l) => l.isFlagged);
      const antiBot = linkResults.filter((l) => l.isAntiBotBlocked);
      if (broken.length > 0) {
        log(chalk.red(`    ✗ ${broken.length} broken link(s) found:`));
        for (const b of broken) {
          log(chalk.red(`      [${b.httpStatus}] ${b.href}`));
        }
      } else {
        log(chalk.green(`    ✓ All links OK`));
      }
      if (antiBot.length > 0) {
        log(chalk.yellow(`    ⚠ ${antiBot.length} link(s) blocked by anti-bot (social media — likely OK in browser)`));
      }

      return pageSnapshot;
    }
  );

  // Filter out pages that were skipped due to errors (returned null)
  const pageSnapshots = rawSnapshots.filter((p): p is NonNullable<typeof p> => p !== null);

  // ── Content fidelity comparison (BR source text vs Wix page text) ────────
  // Mirrors the approach of site-immigrator-wml-ctoo: clean BR HTML using the
  // same whitelist, extract plain text, compare via Jaccard similarity.
  let contentComparisons: import('./types/index.js').ContentComparisonSummary[] | undefined = undefined;
  if (siteData) {
    try {
      const brContentPages = extractBrContentByPage(siteData);
      if (brContentPages.length > 0) {
        // Build a text corpus from each scanned Wix page (combine all section text)
        const wixPages = pageSnapshots.map((p) => ({
          url: p.url,
          title: p.title,
          textContent: p.sections.map((s) => s.textContent).join(' '),
        }));

        const matched = matchBrPagesToWixPages(brContentPages, wixPages);
        contentComparisons = matched.map(({ brTitle, fields, wixUrl, wixTitle, wixText }) => {
          const comparison = comparePageContent(fields, wixText, wixUrl, brTitle);
          return {
            pageUrl: wixUrl,
            pageTitle: wixTitle || brTitle,
            overallSimilarity: comparison.overallSimilarity,
            allHigh: comparison.allHigh,
            fields: comparison.fields.map((f) => ({
              fieldName: f.fieldName,
              similarity: f.similarity,
              similarityPct: f.similarityPct,
              rating: f.rating,
              missingKeyTerms: f.missingKeyTerms,
              meaningful: f.meaningful,
            })),
          };
        });
        log(chalk.green(`  ✓ Content fidelity: ${matched.length} page(s) compared against BR source`));
      }
    } catch (err) {
      log(chalk.yellow(`  ⚠ Content comparison skipped: ${(err as Error).message}`));
    }
  }

  const snapshot: SiteSnapshot = {
    domain,
    capturedAt: new Date().toISOString(),
    scanLabel: label,
    siteType,
    pages: pageSnapshots,
    metadata: {
      liveStatus: siteData?.['Live-Site-Status'] ?? 'unknown',
      flexXmlFound: siteData != null,
      pageCount: pageSnapshots.length,
      scanDurationMs: Date.now() - startTime,
      contentComparisons,
    },
  };

  await ensureDir(output);
  await saveSnapshot(snapshot, `${output}/snapshot.json`);
  log(chalk.green(`\n  ✓ Snapshot saved to ${output}/snapshot.json`));

  const report = runAllRules(snapshot, allLinkResults, siteType);
  log(chalk.green(`  ✓ Ran ${report.totalChecks} rule checks (${report.passed} passed, ${report.failed} failed)`));

  // Close the headed browser after the scan so the Chrome window disappears cleanly.
  if (headed) {
    await closeHeadedBrowser();
    log(chalk.magenta('  👁  Headed browser closed'));
  }

  return { snapshot, report };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  staggerMs = 1200
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (workerIndex: number) => {
    // Stagger worker start times so pages don't all hit the server at the same instant
    if (workerIndex > 0) await new Promise(r => setTimeout(r, workerIndex * staggerMs));
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  };

  const numWorkers = Math.min(concurrency, items.length);
  const workers = Array.from({ length: numWorkers }, (_, i) => worker(i));
  await Promise.all(workers);
  return results;
}

async function scanPage(
  domain: string,
  path: string,
  pageInfo: { id: string; url: string; title: string },
  viewports: ViewportName[],
  screenshots: boolean,
  outputDir: string,
  timeout: number,
  headed = false,
  slowMo = 0
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
  let accessibilityAudit: PageSnapshot['accessibilityAudit'] = null;
  let hasPrintButton = false;
  let hasBackToTopButton = false;
  let jsConsoleErrors: string[] = [];
  let placeholderTexts: PageSnapshot['placeholderTexts'] = [];
  let invalidCTAs: PageSnapshot['invalidCTAs'] = [];
  let invalidContactLinks: PageSnapshot['invalidContactLinks'] = [];
  let sliderControls: PageSnapshot['sliderControls'] = [];
  let mapEmbeds: PageSnapshot['mapEmbeds'] = [];

  for (const vpName of viewports) {
    const { context, page } = await openPage(domain, path, vpName, timeout, headed, slowMo);

    // Capture JS console errors (desktop only — only need them once)
    const pageErrors: string[] = [];
    if (vpName === 'desktop') {
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Filter out noisy browser-internal messages
          if (!text.includes('favicon') && !text.includes('net::ERR_')) {
            pageErrors.push(text.substring(0, 200));
          }
        }
      });
      page.on('pageerror', (err) => {
        pageErrors.push(`JS Error: ${err.message.substring(0, 200)}`);
      });
    }

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
        accessibilityAudit = await extractAccessibilityData(page);
        hasPrintButton = await detectPrintButton(page);
        hasBackToTopButton = await detectBackToTopButton(page);
        placeholderTexts = await detectPlaceholderTexts(page);
        invalidCTAs = await detectInvalidCTAs(page);
        invalidContactLinks = await detectInvalidContactLinks(page);
        sliderControls = await detectSliderControls(page);
        mapEmbeds = await detectMapEmbeds(page);
        jsConsoleErrors = pageErrors;
        console.log(chalk.gray(
          `    [desktop] ${links.length} links, ${ctas.length} CTAs, ${sections.filter(s => s.isPresent).length} sections, ${forms.length} forms` +
          (hasPrintButton ? ', 🖨 print' : '') +
          (hasBackToTopButton ? ', ↑ back-to-top' : '') +
          (placeholderTexts.length ? `, ⚠ ${placeholderTexts.length} placeholder(s)` : '') +
          (invalidCTAs.length ? `, 🔴 ${invalidCTAs.length} dead CTA(s)` : '') +
          (invalidContactLinks.length ? `, 📞 ${invalidContactLinks.length} bad contact link(s)` : '') +
          (jsConsoleErrors.length ? `, 🐞 ${jsConsoleErrors.length} JS error(s)` : '')
        ));
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
    accessibilityAudit,
    hasPrintButton,
    hasBackToTopButton,
    jsConsoleErrors,
    placeholderTexts,
    invalidCTAs,
    invalidContactLinks,
    sliderControls,
    mapEmbeds,
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
