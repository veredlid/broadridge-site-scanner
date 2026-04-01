#!/usr/bin/env node
/**
 * Wave 1 Phase 1 QA batch runner — Node.js, 4 parallel workers
 * Reads sites from wave1-sites.csv (Name, URL columns)
 * Outputs per-site HTML + CSV reports to scans/wave1/<domain>/
 * Writes progress to scans/wave1/batch-summary.log
 * Resumes automatically — skips sites that already have a comparison report
 */
import { spawn } from 'child_process';
import { createReadStream, appendFileSync, existsSync, mkdirSync, createWriteStream, readdirSync } from 'fs';
import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARALLEL = parseInt(process.env.PARALLEL ?? '4');
const TIMEOUT = process.env.TIMEOUT ?? '30000';
const CONCURRENCY = process.env.CONCURRENCY ?? '4';
const SKIP_ORIGINAL_CRAWL = process.env.SKIP_ORIGINAL_CRAWL === '1';
const CSV_PATH = resolve(__dirname, process.argv[2] ?? 'wave1-sites.csv');
const OUTPUT_BASE = resolve(__dirname, 'scans/wave1');
const SUMMARY_LOG = resolve(OUTPUT_BASE, 'batch-summary.log');
const INDEX_JS = resolve(__dirname, 'dist/index.js');

mkdirSync(resolve(OUTPUT_BASE, 'logs'), { recursive: true });

function log(msg) {
  const line = `[${new Date().toTimeString().slice(0,8)}] ${msg}`;
  console.log(line);
  appendFileSync(SUMMARY_LOG, line + '\n');
}

async function readPairs() {
  const pairs = [];
  const rl = createInterface({ input: createReadStream(CSV_PATH) });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    const [name, url] = line.split(',');
    if (name && url) pairs.push({ original: name.trim(), migrated: url.trim().replace(/\/$/, '') });
  }
  return pairs;
}

function runSite(original, migrated) {
  return new Promise((resolve_) => {
    const dirName = original.replace(/^www\./, '').replace(/^trust\./, '').replace(/\.pfyfn\.com$/, '');
    const outDir = resolve(OUTPUT_BASE, dirName);
    const logFile = resolve(OUTPUT_BASE, 'logs', `${dirName}.log`);

    // Resume: skip if any compare-* subdirectory has a completed report.html
    const hasReport = existsSync(outDir) && readdirSync(outDir).some(
      f => f.startsWith('compare-') && existsSync(resolve(outDir, f, 'comparison', 'report.html'))
    );
    if (hasReport) {
      log(`↷ SKIP (already done): ${original}`);
      resolve_({ original, status: 'skipped' });
      return;
    }

    log(`▶ START: ${original}`);

    const args = [
      INDEX_JS, 'compare-sites',
      '--original', `https://${original}`,
      '--migrated', migrated,
      '--concurrency', CONCURRENCY,
      '--timeout', TIMEOUT,
      '--csv',
      '--output', outDir,
    ];
    if (SKIP_ORIGINAL_CRAWL) args.push('--skip-original-crawl');

    const child = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const logStream = createWriteStream(logFile, { flags: 'a' });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    let output = '';
    child.stdout.on('data', (d) => output += d.toString());

    child.on('close', (code) => {
      logStream.end();
      if (code === 0) {
        const bugsMatch = output.match(/bugs:\s*(\d+)/);
        const totalMatch = output.match(/Total diffs:\s*(\d+)/);
        const bugs = bugsMatch ? bugsMatch[1] : '?';
        const total = totalMatch ? totalMatch[1] : '?';
        log(`✓ DONE: ${original} — bugs: ${bugs}, total diffs: ${total}`);
        resolve_({ original, status: 'ok', bugs, total });
      } else {
        log(`✗ FAIL: ${original} — exit code ${code}`);
        resolve_({ original, status: 'error', code });
      }
    });
  });
}

// Pool runner: process items with max PARALLEL concurrent workers
async function runPool(items, fn, parallelism) {
  const results = [];
  let i = 0;

  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      results.push(await fn(item));
    }
  }

  await Promise.all(Array.from({ length: parallelism }, worker));
  return results;
}

(async () => {
  const pairs = await readPairs();
  log(`═══════════════════════════════════════════════`);
  log(`Wave 1 Phase 1 QA — ${pairs.length} sites, ${PARALLEL} parallel workers`);
  log(`═══════════════════════════════════════════════`);

  const results = await runPool(
    pairs,
    ({ original, migrated }) => runSite(original, migrated),
    PARALLEL
  );

  const ok = results.filter(r => r.status === 'ok').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;

  log(`═══════════════════════════════════════════════`);
  log(`Completed: ${ok} done, ${skipped} skipped, ${errors} errors`);
  log(`Reports: ${OUTPUT_BASE}/<domain>/comparison/report.html`);
  log(`Summary: ${SUMMARY_LOG}`);
  log(`═══════════════════════════════════════════════`);
})();
