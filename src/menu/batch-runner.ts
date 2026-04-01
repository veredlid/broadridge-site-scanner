import { createReadStream, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { checkMenu } from './menu-checker.js';
import { generateMenuHtmlReport } from './menu-report.js';
import type { MenuCheckResult } from './menu-checker.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SiteEntry {
  original: string;   // e.g. www.armourtrust.com
  migrated: string;   // e.g. https://armourtrust-31030806.brprodaccount.com/
}

export interface BatchResult {
  site: SiteEntry;
  result?: MenuCheckResult;
  reportPath?: string;
  error?: string;
  skipped?: boolean;
  durationMs: number;
}

// ─── Vanilla Bean exclusion list ─────────────────────────────────────────────

const VANILLA_BEAN_DOMAINS = new Set([
  'www.bestinvestsa.com',
  'bestinvestsa.com',
  'www.rbfcapitalmanagement.com',
  'rbfcapitalmanagement.com',
  'www.reganfinancialgroup.com',
  'reganfinancialgroup.com',
  'www.neprivatewealth.com',
  'neprivatewealth.com',
  'www.rwmpartners.com',
  'rwmpartners.com',
  'www.bigelowadvisors.com',
  'bigelowadvisors.com',
  'www.indtrust.com',
  'indtrust.com',
  'www.kmiwealthadvisors.com',
  'kmiwealthadvisors.com',
]);

// ─── CSV reader ───────────────────────────────────────────────────────────────

export async function readSitesFromCsv(csvPath: string): Promise<SiteEntry[]> {
  return new Promise((resolve, reject) => {
    const sites: SiteEntry[] = [];
    const rl = createInterface({
      input: createReadStream(csvPath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let isHeader = true;
    rl.on('line', (line) => {
      // Strip BOM
      const clean = line.replace(/^\uFEFF/, '').trim();
      if (!clean) return;

      if (isHeader) {
        isHeader = false;
        return;
      }

      // CSV: Name,URL,...
      const cols = clean.split(',');
      const original = cols[0]?.trim();
      const migrated = cols[1]?.trim();
      if (original && migrated) {
        sites.push({ original, migrated });
      }
    });

    rl.on('close', () => resolve(sites));
    rl.on('error', reject);
  });
}

// ─── Concurrency helper ───────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
      completed++;
      onProgress?.(completed, tasks.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main batch function ──────────────────────────────────────────────────────

export interface BatchOptions {
  csvPath: string;
  outputDir: string;
  auth?: string;
  timeout?: number;
  concurrency?: number;
}

export async function runBatch(options: BatchOptions): Promise<BatchResult[]> {
  const { csvPath, outputDir, auth, timeout = 30_000, concurrency = 2 } = options;

  console.log(chalk.bold('\n═══ Batch Menu Check ═══\n'));
  console.log(chalk.cyan(`CSV:        ${csvPath}`));
  console.log(chalk.cyan(`Output:     ${outputDir}`));
  console.log(chalk.cyan(`Concurrency: ${concurrency}\n`));

  // Read sites
  const allSites = await readSitesFromCsv(csvPath);
  const sites = allSites.filter((s) => !VANILLA_BEAN_DOMAINS.has(s.original.toLowerCase()));
  const skipped = allSites.length - sites.length;

  console.log(chalk.green(`Sites loaded: ${sites.length} (skipped ${skipped} Vanilla Bean sites)\n`));

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Build tasks
  const tasks = sites.map((site) => async (): Promise<BatchResult> => {
    const siteDirName = site.original.replace(/[^a-z0-9.-]/gi, '_');
    const siteDir = path.join(outputDir, siteDirName);
    const reportPath = path.join(siteDir, 'menu-report.html');

    const startMs = Date.now();
    await mkdir(siteDir, { recursive: true });

    // Retry once on transient failures
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await checkMenu({ original: site.original, migrated: site.migrated, auth, timeout });
        generateMenuHtmlReport(result, reportPath);
        writeFileSync(path.join(siteDir, 'result.json'), JSON.stringify({ site, result }, null, 2), 'utf-8');
        return { site, result, reportPath, durationMs: Date.now() - startMs };
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt === 1) {
          console.log(chalk.yellow(`\n  ↻ Retry ${site.original}: ${msg}`));
          await new Promise((r) => setTimeout(r, 5_000));
        } else {
          return { site, error: msg, durationMs: Date.now() - startMs };
        }
      }
    }

    return { site, error: 'Unknown error', durationMs: Date.now() - startMs };
  });

  console.log(chalk.yellow(`Running ${tasks.length} sites (concurrency: ${concurrency})...\n`));
  const startAll = Date.now();

  const results = await runWithConcurrency(tasks, concurrency, (done, total) => {
    const pct = Math.round((done / total) * 100);
    const elapsed = Math.round((Date.now() - startAll) / 1000);
    process.stdout.write(`\r  Progress: ${done}/${total} (${pct}%) — ${elapsed}s elapsed`);
  });

  console.log('\n');

  // Print summary
  const succeeded = results.filter((r) => r.result);
  const failed = results.filter((r) => r.error);
  const withBugsP1 = succeeded.filter((r) => (r.result!.summary.missing + r.result!.summary.brokenLinks) > 0);
  const withBugsP2 = succeeded.filter((r) => !r.result!.originalCrawlFailed && (r.result!.liveSummary.missing + r.result!.liveSummary.brokenLinks) > 0);

  console.log(chalk.bold('═══ Batch Summary ═══\n'));
  console.log(`  Total sites:      ${results.length}`);
  console.log(chalk.green(`  Succeeded:        ${succeeded.length}`));
  console.log(chalk.red(`  Failed:           ${failed.length}`));
  console.log(chalk.red(`  P1 bugs (BR JSON): ${withBugsP1.length} sites`));
  console.log(chalk.red(`  P2 bugs (vs Live): ${withBugsP2.length} sites`));

  if (failed.length > 0) {
    console.log(chalk.red('\n  Failed sites:'));
    for (const f of failed) {
      console.log(chalk.red(`    ✗ ${f.site.original}: ${f.error}`));
    }
  }

  return results;
}

/**
 * Extract summary data from a menu-report.html when no result.json is present.
 * Parses the two summary grids and bug rows to reconstruct the key numbers and
 * bug list needed for the index report.
 */
function extractSummaryFromHtml(htmlPath: string, dirName: string): {
  site: SiteEntry;
  menuResult: import('./menu-checker.js').MenuCheckResult;
} {
  const html = readFileSync(htmlPath, 'utf-8');

  // Site metadata
  const domainMatch = html.match(/Menu Check Report &mdash; ([^<]+)<|Menu Check Report — ([^<]+)</);
  const migratedMatch = html.match(/Migrated:\s*([^\s&·<]+)/);
  const original = (domainMatch?.[1] ?? domainMatch?.[2] ?? dirName).trim();
  const migrated = (migratedMatch?.[1] ?? '').trim();

  // Extract summary grids — there are 2 per report (P1 and P2)
  const gridMatches = [...html.matchAll(/<div class="summary-grid">([\s\S]*?)<\/div>\s*\n\s*\n/g)];

  const parseGrid = (idx: number) => {
    const g = gridMatches[idx]?.[1] ?? '';
    const pairs = [...g.matchAll(/<div class="num[^"]*">(\d+)<\/div><div class="lbl">([^<]+)<\/div>/g)];
    const map: Record<string, number> = {};
    for (const [, n, lbl] of pairs) map[lbl.trim()] = parseInt(n);
    return map;
  };

  const g1 = parseGrid(0);
  const g2 = parseGrid(1);

  // Extract bug items per part by splitting on PART 1 / PART 2 markers
  const partSplit = html.split(/PART [12]<\/span>/);
  const extractBugs = (section: string): import('./menu-checker.js').MenuItemIssue[] => {
    const bugs: import('./menu-checker.js').MenuItemIssue[] = [];
    const re = /badge badge-(missing|broken)">[^<]+<\/span><\/td>\s*<td[^>]*>\s*(?:<span[^>]*>[^<]*<\/span>\s*)?<code>([^<]+)<\/code>[\s\S]*?(?:<div class="note">([^<]+)<\/div>)?/g;
    for (const m of section.matchAll(re)) {
      bugs.push({
        kind: m[1] === 'missing' ? 'missing' : 'broken-link',
        brTitle: m[2].trim(),
        note: m[3]?.trim() ?? '',
      });
    }
    return bugs;
  };

  const p1Bugs = partSplit[1] ? extractBugs(partSplit[1]) : [];
  const p2Bugs = partSplit[2] ? extractBugs(partSplit[2]) : [];

  const makeSum = (g: Record<string, number>, sourceKey: string): import('./menu-checker.js').MenuSectionSummary & { totalBrItems?: number } => ({
    totalSourceItems: g[sourceKey] ?? 0,
    totalMigratedItems: g['Migrated Items'] ?? 0,
    missing: g['Missing'] ?? 0,
    extra: g['Extra Items'] ?? 0,
    brokenLinks: g['Broken Links'] ?? 0,
    duplicates: g['Duplicates'] ?? 0,
    hrefMismatches: g['Href Mismatches'] ?? 0,
    structureChanges: g['Structure Changes'] ?? 0,
    ok: 0,
  });

  const s1 = makeSum(g1, 'BR JSON Items');
  const s2 = makeSum(g2, 'Original Items');

  return {
    site: { original, migrated },
    menuResult: {
      originalDomain: original,
      migratedDomain: migrated,
      capturedAt: '',
      brNavItems: [],
      originalItems: [],
      migratedItems: [],
      issues: p1Bugs,
      summary: { ...s1, totalBrItems: s1.totalSourceItems },
      liveIssues: p2Bugs,
      liveSummary: s2,
      originalCrawlFailed: s2.totalSourceItems === 0,
    } as import('./menu-checker.js').MenuCheckResult,
  };
}

/**
 * Load all previously-saved result.json files from a batch output directory.
 * For site directories that have menu-report.html but no result.json (first
 * run before JSON-saving was added), creates a stub entry so they still appear
 * in the index with a link to their report.
 */
export function loadResultsFromDisk(outputDir: string): BatchResult[] {
  const results: BatchResult[] = [];

  for (const entry of readdirSync(outputDir)) {
    const dir = path.join(outputDir, entry);
    if (!statSync(dir).isDirectory()) continue;

    const jsonPath = path.join(dir, 'result.json');
    const htmlPath = path.join(dir, 'menu-report.html');

    if (existsSync(jsonPath)) {
      // Full structured data available
      try {
        const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
        results.push({
          site: data.site,
          result: data.result,
          reportPath: htmlPath,
          durationMs: 0,
        });
      } catch {
        console.log(chalk.red(`  ✗ Failed to parse ${jsonPath}`));
      }
    } else if (existsSync(htmlPath)) {
      // HTML report exists but no JSON — reconstruct summary data from HTML
      const result = extractSummaryFromHtml(htmlPath, entry);
      results.push({ site: result.site, result: result.menuResult, reportPath: htmlPath, durationMs: 0 });
    }
  }

  const withData = results.filter((r) => r.result).length;
  const htmlOnly = results.filter((r) => !r.result && !r.error).length;
  console.log(chalk.green(`Loaded ${results.length} results from ${outputDir} (${withData} with full data, ${htmlOnly} HTML-only)`));
  return results;
}
