import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  insertComparison,
  listComparisons,
  getComparison,
  deleteComparison,
  getSnapshotJson,
  updateComparisonStatus,
  updateComparisonResult,
  updateComparisonError,
} from '../db/queries.js';
import { enqueue, subscribe } from '../jobs/queue.js';
import { executeComparison } from '../jobs/scan-worker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

/** True when this file is running as TypeScript source via tsx (not compiled JS). */
const IS_TSX = fileURLToPath(import.meta.url).endsWith('.ts');

/**
 * Build an import() URL for a scanner module.
 * tsx mode  → src/*.ts  (no ?v= — tsx loader matches by file extension)
 * prod mode → dist/*.js (with ?v= cache-bust)
 */
function resolveSourceModule(_base: string, ...parts: string[]): string {
  if (IS_TSX) {
    return pathToFileURL(resolve(PROJECT_ROOT, 'src', ...parts).replace(/\.js$/, '.ts')).href;
  }
  return `${pathToFileURL(resolve(PROJECT_ROOT, 'dist', ...parts)).href}?v=${Date.now()}`;
}

// Absolute path prefix for screenshots on disk → replaced with web-accessible URL
const SCANS_DIR_PREFIX = resolve(PROJECT_ROOT, 'scans') + '/';
const SCANS_URL_PREFIX = '/scans-files/';

/** Replace all absolute screenshot paths in a JSON string with web-accessible URLs */
function normalizeScreenshotPaths(json: string): string {
  // Escape backslashes for Windows paths in regex
  const escaped = SCANS_DIR_PREFIX.replace(/\\/g, '\\\\').replace(/\//g, '\\/');
  return json.replace(new RegExp(escaped, 'g'), SCANS_URL_PREFIX);
}

export const comparisonRoutes = Router();

comparisonRoutes.post('/', (req, res) => {
  const { original, migrated, viewports = 'desktop', headed = false, label = '' } = req.body;
  if (!original || !migrated) {
    res.status(400).json({ error: 'original and migrated domains are required' });
    return;
  }

  const id = uuid();
  insertComparison({
    id,
    original_domain: original.trim(),
    migrated_domain: migrated.trim(),
    viewports,
    label: (label as string).trim(),
  });

  enqueue({
    id,
    type: 'comparison',
    execute: () => executeComparison(id, original.trim(), migrated.trim(), viewports, Boolean(headed)),
  });

  res.status(201).json({ id, status: 'queued' });
});

// Compare two already-scanned snapshots without re-scanning
comparisonRoutes.post('/from-scans', async (req, res) => {
  const { originalScanId, migratedScanId } = req.body;
  if (!originalScanId || !migratedScanId) {
    res.status(400).json({ error: 'originalScanId and migratedScanId are required' });
    return;
  }

  const originalRow = getSnapshotJson(originalScanId);
  const migratedRow = getSnapshotJson(migratedScanId);

  if (!originalRow || !originalRow.snapshot_json) {
    res.status(404).json({ error: `Scan ${originalScanId} not found or has no snapshot` });
    return;
  }
  if (!migratedRow || !migratedRow.snapshot_json) {
    res.status(404).json({ error: `Scan ${migratedScanId} not found or has no snapshot` });
    return;
  }

  const { label = '' } = req.body;
  const id = uuid();
  insertComparison({
    id,
    original_domain: originalRow.domain,
    migrated_domain: migratedRow.domain,
    viewports: 'desktop',
    label: (label as string).trim(),
  });

  // Run synchronously in background — it's just an in-memory diff, very fast
  setImmediate(async () => {
    try {
      // Guard: if either scan is still running (hot-reload mid-scan, race condition),
      // wait up to 30 s for it to finish before giving up.
      const MAX_WAIT_MS = 30_000;
      const POLL_INTERVAL_MS = 500;
      let waited = 0;
      const waitForSnapshot = async (scanId: string): Promise<string> => {
        while (waited < MAX_WAIT_MS) {
          const row = getSnapshotJson(scanId);
          if (row?.snapshot_json) return row.snapshot_json;
          if (!row) throw new Error(`Scan ${scanId} not found`);
          // Scan exists but no snapshot yet — still running
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          waited += POLL_INTERVAL_MS;
        }
        throw new Error(`Scan ${scanId} did not complete within ${MAX_WAIT_MS / 1000}s`);
      };

      const [origJson, migJson] = await Promise.all([
        waitForSnapshot(originalScanId),
        waitForSnapshot(migratedScanId),
      ]);

      const { compareSnapshots } = await import(
        resolveSourceModule(__dirname, 'comparison', 'snapshot-differ.js')
      );
      updateComparisonStatus(id, 'running');
      const originalSnapshot = JSON.parse(origJson);
      const migratedSnapshot = JSON.parse(migJson);
      const diff = compareSnapshots(originalSnapshot, migratedSnapshot, 'cross-site');
      updateComparisonResult(
        id,
        originalRow.snapshot_json!,
        migratedRow.snapshot_json!,
        JSON.stringify(diff),
        diff.summary.totalChecks,
        diff.summary.passed,
        diff.summary.failed
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateComparisonError(id, message);
    }
  });

  res.status(201).json({ id, status: 'running' });
});

comparisonRoutes.get('/', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const comparisons = listComparisons(limit, offset);
  res.json(comparisons);
});

comparisonRoutes.get('/:id', (req, res) => {
  const comp = getComparison(req.params.id);
  if (!comp) {
    res.status(404).json({ error: 'Comparison not found' });
    return;
  }
  // Normalize absolute screenshot paths to web-accessible URLs before sending to client
  const diffJson = comp.diff_json ? normalizeScreenshotPaths(comp.diff_json) : null;
  const originalSnapshotJson = comp.original_snapshot_json ? normalizeScreenshotPaths(comp.original_snapshot_json) : null;
  const migratedSnapshotJson = comp.migrated_snapshot_json ? normalizeScreenshotPaths(comp.migrated_snapshot_json) : null;

  // Re-apply current verdict rules at read time so classification changes take effect
  // without requiring a re-run (verdicts are stored in diff_json but rules evolve over time)
  let diff = diffJson ? JSON.parse(diffJson) : null;
  if (diff?.items) {
    for (const item of diff.items) {
      if (item.checkId === 'section-missing') item.verdict = 'info';
    }
    // Recompute summary bugs count from live verdicts
    if (diff.summary) {
      diff.summary.bugs = diff.items.filter((i: { verdict?: string }) => i.verdict === 'bug').length;
    }
  }

  res.json({
    ...comp,
    original_snapshot: originalSnapshotJson ? JSON.parse(originalSnapshotJson) : null,
    migrated_snapshot: migratedSnapshotJson ? JSON.parse(migratedSnapshotJson) : null,
    diff,
  });
});

comparisonRoutes.delete('/:id', (req, res) => {
  const deleted = deleteComparison(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Comparison not found' });
    return;
  }
  res.json({ ok: true });
});

comparisonRoutes.get('/:id/progress', (req, res) => {
  const comp = getComparison(req.params.id);
  if (!comp) {
    res.status(404).json({ error: 'Comparison not found' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  if (comp.status === 'done') {
    res.write(`data: ${JSON.stringify({ type: 'status', status: 'done' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    return;
  }

  if (comp.status === 'failed') {
    res.write(`data: ${JSON.stringify({ type: 'error', error: comp.error || 'Comparison failed' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    return;
  }

  res.write(`data: ${JSON.stringify({ type: 'status', status: comp.status })}\n\n`);

  subscribe(req.params.id, res);
});
