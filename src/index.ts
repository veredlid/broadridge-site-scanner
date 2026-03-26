#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { scanSite } from './scanner.js';
import { compareSites } from './comparison/site-comparer.js';
import { compareSnapshots } from './comparison/snapshot-differ.js';
import { loadSnapshot } from './utils/fs-helpers.js';
import { generateHtmlReport } from './reporters/html-reporter.js';
import { generateCsvReport } from './reporters/csv-reporter.js';
import { closeBrowser } from './utils/playwright-helpers.js';
import { ensureDir } from './utils/fs-helpers.js';
import type { ViewportName } from './types/index.js';

const program = new Command();

program
  .name('br-scanner')
  .description('DOM-first live site scanner for Broadridge FA sites')
  .version('0.1.0');

// ═══════════════════════════════════════
//  scan — single site audit
// ═══════════════════════════════════════

program
  .command('scan <domain>')
  .description('Scan a single Broadridge site and generate a report')
  .option('-l, --label <label>', 'Scan label (e.g. "before", "after")', 'scan')
  .option('-v, --viewports <viewports>', 'Comma-separated viewports', 'desktop,tablet,mobile')
  .option('-s, --screenshots', 'Capture per-section screenshots', false)
  .option('-c, --concurrency <n>', 'Parallel link validation threads', '10')
  .option('-t, --timeout <ms>', 'Page load timeout', '30000')
  .option('--auth <token>', 'Authorization token for BR Source API')
  .option('-o, --output <dir>', 'Output directory', './scans')
  .option('--csv', 'Also export CSV', false)
  .action(async (domain: string, opts) => {
    try {
      const viewports = opts.viewports.split(',') as ViewportName[];
      const outputDir = `${opts.output}/${domain}/${new Date().toISOString().replace(/[:.]/g, '-')}`;

      await scanSite({
        domain,
        label: opts.label,
        viewports,
        screenshots: opts.screenshots,
        concurrency: parseInt(opts.concurrency),
        timeout: parseInt(opts.timeout),
        auth: opts.auth,
        output: outputDir,
        csv: opts.csv,
      });

      console.log(chalk.green('\nScan complete!'));
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
      process.exitCode = 1;
    } finally {
      await closeBrowser();
    }
  });

// ═══════════════════════════════════════
//  compare — before/after snapshots
// ═══════════════════════════════════════

program
  .command('compare')
  .description('Compare two snapshots (before/after) of the same site')
  .requiredOption('-b, --before <path>', 'Path to "before" snapshot JSON')
  .requiredOption('-a, --after <path>', 'Path to "after" snapshot JSON')
  .option('-o, --output <dir>', 'Output directory', './scans/comparison')
  .option('--csv', 'Also export CSV', false)
  .action(async (opts) => {
    try {
      console.log(chalk.cyan('Loading snapshots...\n'));
      const before = await loadSnapshot(opts.before);
      const after = await loadSnapshot(opts.after);

      console.log(chalk.cyan('Comparing...\n'));
      const diff = compareSnapshots(before, after, 'before-after');

      await ensureDir(opts.output);
      await generateHtmlReport(diff, before, after, `${opts.output}/report.html`);
      console.log(chalk.green(`Report: ${opts.output}/report.html`));

      if (opts.csv) {
        await generateCsvReport(diff, `${opts.output}/report.csv`);
        console.log(chalk.green(`CSV:    ${opts.output}/report.csv`));
      }

      const { summary } = diff;
      console.log(chalk.bold(`\nResults: ${summary.passed} matches, ${summary.failed} mismatches, ${summary.newIssues} new`));
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// ═══════════════════════════════════════
//  compare-sites — original vs migrated
// ═══════════════════════════════════════

program
  .command('compare-sites')
  .description('Compare an original Broadridge site against its migrated version')
  .requiredOption('--original <domain>', 'Original site domain')
  .requiredOption('--migrated <domain>', 'Migrated site domain')
  .option('-v, --viewports <viewports>', 'Comma-separated viewports', 'desktop,tablet,mobile')
  .option('-s, --screenshots', 'Capture per-section screenshots', false)
  .option('-c, --concurrency <n>', 'Parallel link validation threads', '10')
  .option('-t, --timeout <ms>', 'Page load timeout', '30000')
  .option('--auth <token>', 'Authorization token for BR Source API')
  .option('-o, --output <dir>', 'Output directory', './scans')
  .option('--csv', 'Also export CSV', false)
  .action(async (opts) => {
    try {
      const viewports = opts.viewports.split(',') as ViewportName[];
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputDir = `${opts.output}/compare-${timestamp}`;

      await compareSites({
        original: opts.original,
        migrated: opts.migrated,
        viewports,
        screenshots: opts.screenshots,
        concurrency: parseInt(opts.concurrency),
        timeout: parseInt(opts.timeout),
        auth: opts.auth,
        output: outputDir,
        csv: opts.csv,
      });

      console.log(chalk.green(`\nDone! Reports at: ${outputDir}/comparison/`));
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
      process.exitCode = 1;
    } finally {
      await closeBrowser();
    }
  });

program.parse();
