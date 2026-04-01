import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emitProgress, emitDone } from './queue.js';
import {
  updateScanStatus,
  updateScanResult,
  updateScanError,
  updateComparisonStatus,
  updateComparisonResult,
  updateComparisonError,
} from '../db/queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * True when THIS module is being executed as TypeScript source (i.e. via `tsx`).
 * When the server runs from compiled JS (node server/dist/index.js), this file
 * loads as scan-worker.js and IS_TSX is false — we must import from dist/.
 * When the server runs via `tsx watch src/index.ts`, this file loads as
 * scan-worker.ts and IS_TSX is true — we can safely import .ts source files.
 *
 * This is more reliable than existsSync(srcPath): the .ts file always exists on
 * disk, but that does NOT mean the tsx loader is active in the current process.
 */
const IS_TSX = fileURLToPath(import.meta.url).endsWith('.ts');

/**
 * Build an import() URL for a scanner module.
 * - tsx mode  → resolves to src/*.ts  (no ?v= — tsx loader matches by extension)
 * - prod mode → resolves to dist/*.js (adds ?v= cache-bust so Node re-evaluates)
 */
function importUrl(...parts: string[]): string {
  if (IS_TSX) {
    const srcPath = resolve(PROJECT_ROOT, 'src', ...parts).replace(/\.js$/, '.ts');
    return pathToFileURL(srcPath).href;
  }
  const distPath = resolve(PROJECT_ROOT, 'dist', ...parts);
  return `${pathToFileURL(distPath).href}?v=${Date.now()}`;
}

export async function executeScan(
  jobId: string,
  domain: string,
  label: string,
  viewports: string,
  headed = false,
  siteType: 'vanilla' | 'flex' | 'deprecated' = 'flex'
): Promise<void> {
  updateScanStatus(jobId, 'running');
  emitProgress(jobId, { type: 'status', status: 'running' });
  console.log(`[scan-worker] executeScan jobId=${jobId} domain=${domain} headed=${headed} siteType=${siteType}`);
  if (headed) emitProgress(jobId, { type: 'progress', message: '👁 Headed mode — Chrome window will open on the server machine' });

  try {
    const { scanSite } = await import(importUrl('scanner.js'));
    // NOTE: Do NOT call closeBrowser() here for headless scans — the browser is a
    // long-lived singleton shared across concurrent scan jobs. The scanner itself
    // closes the headed browser when done.

    const outputDir = resolve(PROJECT_ROOT, 'scans', domain, new Date().toISOString().replace(/[:.]/g, '-'));

    const { snapshot, report } = await scanSite({
      domain,
      label,
      viewports: viewports.split(','),
      screenshots: false,
      concurrency: 10,
      timeout: 60000,
      output: outputDir,
      csv: false,
      headed,
      siteType,
      onProgress: (message: string, step?: number, total?: number) => {
        emitProgress(jobId, { type: 'progress', message, step, total });
      },
    });

    updateScanResult(
      jobId,
      JSON.stringify(snapshot),
      JSON.stringify(report),
      snapshot.metadata?.pageCount ?? snapshot.pages.length,
      report.passed,
      report.failed,
      snapshot.metadata?.scanDurationMs ?? 0
    );
    emitProgress(jobId, { type: 'status', status: 'done' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateScanError(jobId, message);
    emitProgress(jobId, { type: 'error', error: message });
  } finally {
    // Always close the headed browser (no-op if already closed or headless)
    try {
      const { closeHeadedBrowser } = await import(importUrl('utils', 'playwright-helpers.js'));
      await closeHeadedBrowser();
    } catch { /* ignore cleanup errors */ }
    emitDone(jobId);
  }
}

export async function executeComparison(
  jobId: string,
  originalDomain: string,
  migratedDomain: string,
  viewports: string,
  headed = false
): Promise<void> {
  updateComparisonStatus(jobId, 'running');
  emitProgress(jobId, { type: 'status', status: 'running' });
  if (headed) emitProgress(jobId, { type: 'progress', message: '👁 Headed mode — Chrome windows will open on the server machine' });

  try {
    const { scanSite } = await import(importUrl('scanner.js'));
    const { compareSnapshots } = await import(importUrl('comparison', 'snapshot-differ.js'));

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const baseDir = resolve(PROJECT_ROOT, 'scans', `compare-${ts}`);

    emitProgress(jobId, { type: 'progress', message: 'Scanning original site...', step: 1, total: 3 });
    const { snapshot: originalSnapshot } = await scanSite({
      domain: originalDomain,
      label: 'original',
      viewports: viewports.split(','),
      screenshots: true,
      concurrency: 10,
      timeout: 60000,
      output: `${baseDir}/original`,
      csv: false,
      headed,
    });

    emitProgress(jobId, { type: 'progress', message: 'Scanning migrated site...', step: 2, total: 3 });
    const { snapshot: migratedSnapshot } = await scanSite({
      domain: migratedDomain,
      label: 'migrated',
      viewports: viewports.split(','),
      screenshots: true,
      concurrency: 10,
      timeout: 60000,
      output: `${baseDir}/migrated`,
      csv: false,
      headed,
    });

    emitProgress(jobId, { type: 'progress', message: 'Comparing snapshots...', step: 3, total: 3 });
    const diff = compareSnapshots(originalSnapshot, migratedSnapshot, 'cross-site');

    updateComparisonResult(
      jobId,
      JSON.stringify(originalSnapshot),
      JSON.stringify(migratedSnapshot),
      JSON.stringify(diff),
      diff.summary.totalChecks,
      diff.summary.bugs ?? 0,      // passed col repurposed → real bug count
      diff.summary.totalChecks     // failed col repurposed → total items scanned
    );
    emitProgress(jobId, { type: 'status', status: 'done' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateComparisonError(jobId, message);
    emitProgress(jobId, { type: 'error', error: message });
  } finally {
    // Always close the headed browser (no-op if already closed or headless)
    try {
      const { closeHeadedBrowser } = await import(importUrl('utils', 'playwright-helpers.js'));
      await closeHeadedBrowser();
    } catch { /* ignore cleanup errors */ }
    emitDone(jobId);
  }
}
