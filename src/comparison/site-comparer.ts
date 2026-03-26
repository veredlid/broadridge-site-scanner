import chalk from 'chalk';
import type { SiteSnapshot, SnapshotDiff, CompareSitesOptions, ViewportName } from '../types/index.js';
import { scanSite } from '../scanner.js';
import { compareSnapshots } from './snapshot-differ.js';
import { generateHtmlReport } from '../reporters/html-reporter.js';
import { generateCsvReport } from '../reporters/csv-reporter.js';
import { saveSnapshot, ensureDir } from '../utils/fs-helpers.js';

export async function compareSites(options: CompareSitesOptions): Promise<SnapshotDiff> {
  console.log(chalk.bold('\n═══ Cross-Site Comparison ═══\n'));
  console.log(chalk.cyan(`Original: ${options.original}`));
  console.log(chalk.cyan(`Migrated: ${options.migrated}\n`));

  console.log(chalk.yellow('Step 1/4: Scanning original site...'));
  const originalSnapshot = await scanSite({
    domain: options.original,
    label: 'original',
    viewports: options.viewports,
    screenshots: options.screenshots,
    concurrency: options.concurrency,
    timeout: options.timeout,
    auth: options.auth,
    output: `${options.output}/original`,
    csv: false,
  });

  console.log(chalk.yellow('Step 2/4: Scanning migrated site...'));
  const migratedSnapshot = await scanSite({
    domain: options.migrated,
    label: 'migrated',
    viewports: options.viewports,
    screenshots: options.screenshots,
    concurrency: options.concurrency,
    timeout: options.timeout,
    auth: options.auth,
    output: `${options.output}/migrated`,
    csv: false,
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
