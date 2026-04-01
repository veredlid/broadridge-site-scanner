import { Router } from 'express';
import { getDb } from '../db/schema.js';

export const dashboardRoutes = Router();

/**
 * GET /api/dashboard
 * Aggregated stats across scans, comparisons, and deliveries.
 */
dashboardRoutes.get('/', (_req, res) => {
  const db = getDb();

  // ── Scans ──────────────────────────────────────────────────────────────────
  const scanTotals = db.prepare(`
    SELECT
      COUNT(*)                                          AS total,
      SUM(CASE WHEN status = 'done'       THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'failed'     THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'running'    THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'queued'     THEN 1 ELSE 0 END) AS queued,
      SUM(passed)                                       AS total_passed,
      SUM(failed)                                       AS total_failed_checks,
      MAX(created_at)                                   AS last_activity
    FROM scans
  `).get() as {
    total: number; done: number; failed: number; running: number; queued: number;
    total_passed: number; total_failed_checks: number; last_activity: string | null;
  };

  const recentScans = db.prepare(`
    SELECT id, domain, label, status, created_at, passed, failed, page_count
    FROM scans ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{
    id: string; domain: string; label: string; status: string;
    created_at: string; passed: number; failed: number; page_count: number;
  }>;

  // ── Comparisons ────────────────────────────────────────────────────────────
  const compTotals = db.prepare(`
    SELECT
      COUNT(*)                                          AS total,
      SUM(CASE WHEN status = 'done'    THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'queued'  THEN 1 ELSE 0 END) AS queued,
      MAX(created_at)                                   AS last_activity
    FROM comparisons
  `).get() as {
    total: number; done: number; failed: number; running: number; queued: number;
    last_activity: string | null;
  };

  const recentComparisons = db.prepare(`
    SELECT id, original_domain, migrated_domain, label, status, created_at, passed, failed
    FROM comparisons ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{
    id: string; original_domain: string; migrated_domain: string; label: string;
    status: string; created_at: string; passed: number; failed: number;
  }>;

  // ── Deliveries ─────────────────────────────────────────────────────────────
  const deliveryTotals = db.prepare(`
    SELECT
      COUNT(*) AS total_deliveries,
      SUM(site_count) AS total_sites,
      MAX(delivery_date) AS latest_delivery_date
    FROM deliveries WHERE status = 'done'
  `).get() as {
    total_deliveries: number; total_sites: number; latest_delivery_date: string | null;
  };

  // Phase and wave breakdown from the latest delivery's site_versions
  const latestDelivery = db.prepare(`
    SELECT id, filename, stats_json FROM deliveries
    WHERE status = 'done' ORDER BY delivery_date DESC, uploaded_at DESC LIMIT 1
  `).get() as { id: string; filename: string; stats_json: string | null } | undefined;

  const latestStats = latestDelivery?.stats_json
    ? JSON.parse(latestDelivery.stats_json)
    : null;

  // ── Recent activity: merge scans + comparisons, newest first ────────────────
  const recent = [
    ...recentScans.map((s) => ({
      type: 'scan' as const,
      id: s.id,
      title: s.label || s.domain,
      subtitle: s.domain,
      status: s.status,
      created_at: s.created_at,
      meta: s.status === 'done'
        ? `${s.page_count} pages · ${s.passed} passed · ${s.failed} failed`
        : null,
    })),
    ...recentComparisons.map((c) => ({
      type: 'comparison' as const,
      id: c.id,
      title: c.label || `${c.original_domain} → ${c.migrated_domain}`,
      subtitle: `${c.original_domain} vs ${c.migrated_domain}`,
      status: c.status,
      created_at: c.created_at,
      meta: c.status === 'done'
        ? `${c.passed} passed · ${c.failed} failed`
        : null,
    })),
  ]
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
    .slice(0, 8);

  res.json({
    scans: { ...scanTotals },
    comparisons: { ...compTotals },
    deliveries: {
      ...deliveryTotals,
      latest_filename: latestDelivery?.filename ?? null,
      latest_stats: latestStats,
    },
    recent,
  });
});
