import { getDb } from './schema.js';

export interface ScanRow {
  id: string;
  domain: string;
  label: string;
  status: string;
  viewports: string;
  site_type: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  snapshot_json: string | null;
  report_json: string | null;
  page_count: number;
  passed: number;
  failed: number;
  duration_ms: number;
}

export interface ComparisonRow {
  id: string;
  original_domain: string;
  migrated_domain: string;
  label: string;
  status: string;
  viewports: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  original_snapshot_json: string | null;
  migrated_snapshot_json: string | null;
  diff_json: string | null;
  total_checks: number;
  passed: number;
  failed: number;
}

// ── Scans ──

export function insertScan(scan: Pick<ScanRow, 'id' | 'domain' | 'label' | 'viewports' | 'site_type'>): void {
  getDb().prepare(`
    INSERT INTO scans (id, domain, label, viewports, site_type) VALUES (?, ?, ?, ?, ?)
  `).run(scan.id, scan.domain, scan.label, scan.viewports, scan.site_type);
}

export function listScans(limit = 50, offset = 0): ScanRow[] {
  return getDb().prepare(`
    SELECT id, domain, label, status, viewports, site_type, created_at, started_at, completed_at,
           error, page_count, passed, failed, duration_ms
    FROM scans ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as ScanRow[];
}

export function getScan(id: string): ScanRow | undefined {
  return getDb().prepare(`SELECT * FROM scans WHERE id = ?`).get(id) as ScanRow | undefined;
}

export function updateScanStatus(id: string, status: string): void {
  const now = new Date().toISOString();
  if (status === 'running') {
    getDb().prepare(`UPDATE scans SET status = ?, started_at = ? WHERE id = ?`).run(status, now, id);
  } else {
    getDb().prepare(`UPDATE scans SET status = ?, completed_at = ? WHERE id = ?`).run(status, now, id);
  }
}

export function updateScanResult(
  id: string,
  snapshotJson: string,
  reportJson: string,
  pageCount: number,
  passed: number,
  failed: number,
  durationMs: number
): void {
  getDb().prepare(`
    UPDATE scans SET
      status = 'done', completed_at = datetime('now'),
      snapshot_json = ?, report_json = ?,
      page_count = ?, passed = ?, failed = ?, duration_ms = ?
    WHERE id = ?
  `).run(snapshotJson, reportJson, pageCount, passed, failed, durationMs, id);
}

export function updateScanError(id: string, error: string): void {
  getDb().prepare(`
    UPDATE scans SET status = 'failed', completed_at = datetime('now'), error = ? WHERE id = ?
  `).run(error, id);
}

export function deleteScan(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM scans WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getSnapshotJson(id: string): { snapshot_json: string | null; domain: string } | undefined {
  return getDb().prepare(`SELECT snapshot_json, domain FROM scans WHERE id = ?`).get(id) as
    | { snapshot_json: string | null; domain: string }
    | undefined;
}

// ── Comparisons ──

export function insertComparison(comp: Pick<ComparisonRow, 'id' | 'original_domain' | 'migrated_domain' | 'viewports' | 'label'>): void {
  getDb().prepare(`
    INSERT INTO comparisons (id, original_domain, migrated_domain, viewports, label) VALUES (?, ?, ?, ?, ?)
  `).run(comp.id, comp.original_domain, comp.migrated_domain, comp.viewports, comp.label);
}

export function listComparisons(limit = 50, offset = 0): ComparisonRow[] {
  return getDb().prepare(`
    SELECT id, original_domain, migrated_domain, label, status, viewports, created_at, started_at, completed_at,
           error, total_checks, passed, failed,
           -- Count items whose verdict = 'bug' directly from the stored diff JSON.
           -- This works for ALL comparisons regardless of age, and is immune to
           -- summary.bugs being 0 (COALESCE would swallow a legitimate zero).
           (
             SELECT COUNT(*)
             FROM json_each(json_extract(diff_json, '$.items'))
             WHERE json_extract(value, '$.verdict') = 'bug'
           ) AS bugs_count
    FROM comparisons ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as ComparisonRow[];
}

export function getComparison(id: string): ComparisonRow | undefined {
  return getDb().prepare(`SELECT * FROM comparisons WHERE id = ?`).get(id) as ComparisonRow | undefined;
}

export function updateComparisonStatus(id: string, status: string): void {
  const now = new Date().toISOString();
  if (status === 'running') {
    getDb().prepare(`UPDATE comparisons SET status = ?, started_at = ? WHERE id = ?`).run(status, now, id);
  } else {
    getDb().prepare(`UPDATE comparisons SET status = ?, completed_at = ? WHERE id = ?`).run(status, now, id);
  }
}

export function updateComparisonResult(
  id: string,
  originalJson: string,
  migratedJson: string,
  diffJson: string,
  totalChecks: number,
  passed: number,
  failed: number
): void {
  getDb().prepare(`
    UPDATE comparisons SET
      status = 'done', completed_at = datetime('now'),
      original_snapshot_json = ?, migrated_snapshot_json = ?, diff_json = ?,
      total_checks = ?, passed = ?, failed = ?
    WHERE id = ?
  `).run(originalJson, migratedJson, diffJson, totalChecks, passed, failed, id);
}

export function updateComparisonError(id: string, error: string): void {
  getDb().prepare(`
    UPDATE comparisons SET status = 'failed', completed_at = datetime('now'), error = ? WHERE id = ?
  `).run(error, id);
}

export function deleteComparison(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM comparisons WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── Deliveries ──────────────────────────────────────────────────────────────

export interface DeliveryRow {
  id: string;
  filename: string;
  label: string;
  delivery_date: string | null;
  uploaded_at: string;
  site_count: number;
  status: string;
  error: string | null;
  stats_json: string | null;
}

export interface SiteVersionRow {
  id: string;
  delivery_id: string;
  domain: string;
  site_id: string | null;
  json_data: string;
  delivery_date: string;
  is_latest: number;
  phase: number | null;
  wave: number | null;
}

export function insertDelivery(d: Pick<DeliveryRow, 'id' | 'filename' | 'label' | 'delivery_date'>): void {
  getDb().prepare(`
    INSERT INTO deliveries (id, filename, label, delivery_date, status) VALUES (?, ?, ?, ?, 'processing')
  `).run(d.id, d.filename, d.label ?? '', d.delivery_date);
}

export function updateDeliveryLabel(id: string, label: string): void {
  getDb().prepare(`UPDATE deliveries SET label = ? WHERE id = ?`).run(label, id);
}

export function updateDeliveryDone(id: string, siteCount: number): void {
  getDb().prepare(`
    UPDATE deliveries SET status = 'done', site_count = ? WHERE id = ?
  `).run(siteCount, id);
}

export function updateDeliveryError(id: string, error: string): void {
  getDb().prepare(`
    UPDATE deliveries SET status = 'failed', error = ? WHERE id = ?
  `).run(error, id);
}

export function listDeliveries(): DeliveryRow[] {
  return getDb().prepare(`
    SELECT * FROM deliveries ORDER BY delivery_date DESC, uploaded_at DESC
  `).all() as DeliveryRow[];
}

export function getDelivery(id: string): DeliveryRow | undefined {
  return getDb().prepare(`SELECT * FROM deliveries WHERE id = ?`).get(id) as DeliveryRow | undefined;
}

export function insertSiteVersion(v: Omit<SiteVersionRow, 'is_latest'>): void {
  getDb().prepare(`
    INSERT INTO site_versions (id, delivery_id, domain, site_id, json_data, delivery_date, is_latest, phase, wave)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(v.id, v.delivery_id, v.domain, v.site_id, v.json_data, v.delivery_date, v.phase ?? null, v.wave ?? null);
}

export function updateDeliveryStats(id: string, statsJson: string): void {
  getDb().prepare(`UPDATE deliveries SET stats_json = ? WHERE id = ?`).run(statsJson, id);
}

/** After inserting all versions for a delivery, recalculate is_latest for affected domains. */
export function recalcLatest(domains: string[]): void {
  const db = getDb();
  // Reset latest flag for all affected domains
  const reset = db.prepare(`UPDATE site_versions SET is_latest = 0 WHERE domain = ?`);
  // Find the newest version per domain and mark it
  const markLatest = db.prepare(`
    UPDATE site_versions SET is_latest = 1
    WHERE id = (
      SELECT id FROM site_versions
      WHERE domain = ?
      ORDER BY delivery_date DESC, id DESC
      LIMIT 1
    )
  `);
  const tx = db.transaction((doms: string[]) => {
    for (const d of doms) { reset.run(d); markLatest.run(d); }
  });
  tx(domains);
}

/** All unique domains with their version count and latest delivery date. */
export function listSiteSummaries(): Array<{
  domain: string; version_count: number; latest_date: string; latest_id: string;
  phase: number | null; wave: number | null;
}> {
  return getDb().prepare(`
    SELECT
      domain,
      COUNT(*) as version_count,
      MAX(delivery_date) as latest_date,
      MAX(CASE WHEN is_latest = 1 THEN id ELSE '' END) as latest_id,
      MAX(CASE WHEN is_latest = 1 THEN phase ELSE NULL END) as phase,
      MAX(CASE WHEN is_latest = 1 THEN wave  ELSE NULL END) as wave
    FROM site_versions
    GROUP BY domain
    ORDER BY domain ASC
  `).all() as Array<{ domain: string; version_count: number; latest_date: string; latest_id: string; phase: number | null; wave: number | null }>;
}

/** All versions of a specific domain, newest first. */
export function getSiteHistory(domain: string): SiteVersionRow[] {
  return getDb().prepare(`
    SELECT * FROM site_versions WHERE domain = ? ORDER BY delivery_date DESC, id DESC
  `).all(domain) as SiteVersionRow[];
}

export function getSiteVersion(id: string): SiteVersionRow | undefined {
  return getDb().prepare(`SELECT * FROM site_versions WHERE id = ?`).get(id) as SiteVersionRow | undefined;
}

export function getLatestSiteVersion(domain: string): SiteVersionRow | undefined {
  return getDb().prepare(`
    SELECT * FROM site_versions WHERE domain = ? AND is_latest = 1
  `).get(domain) as SiteVersionRow | undefined;
}

export function getSiteVersionsByDelivery(deliveryId: string): SiteVersionRow[] {
  return getDb().prepare(`
    SELECT * FROM site_versions WHERE delivery_id = ?
  `).all(deliveryId) as SiteVersionRow[];
}

export function updateSiteVersionPhaseWave(id: string, phase: number | null, wave: number | null): void {
  getDb().prepare(`UPDATE site_versions SET phase = ?, wave = ? WHERE id = ?`).run(phase ?? null, wave ?? null, id);
}
