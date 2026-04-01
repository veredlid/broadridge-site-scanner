import { Router } from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { v4 as uuid } from 'uuid';
import {
  insertDelivery,
  updateDeliveryDone,
  updateDeliveryError,
  updateDeliveryStats,
  updateDeliveryLabel,
  listDeliveries,
  getDelivery,
  insertSiteVersion,
  recalcLatest,
  listSiteSummaries,
  getSiteHistory,
  getSiteVersion,
  getLatestSiteVersion,
  getSiteVersionsByDelivery,
  updateSiteVersionPhaseWave,
} from '../db/queries.js';

export const deliveryRoutes = Router();

// ── Multer: keep zip in memory (max 200 MB) ──────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse the delivery timestamp from the Broadridge filename convention:
 *   202603162029-1-1.zip  →  "2026-03-16T20:29:00"
 * Falls back to current time if format doesn't match.
 */
function parseDeliveryDate(filename: string): string {
  const m = filename.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`;
  }
  return new Date().toISOString();
}

/**
 * Extract all site JSON files from a zip Buffer.
 * Handles:
 *  - Nested zips (JSON.zip containing other zips)
 *  - Windows backslash paths
 *  - UTF-8 BOM encoding
 *  - Arbitrary subfolder depth
 */
interface SiteFile {
  filename: string;   // e.g. "2260-www.ClientsBestInterest.com.json"
  content: Buffer;
}

function extractSiteJsons(zipBuffer: Buffer): SiteFile[] {
  const results: SiteFile[] = [];

  function processZip(buf: Buffer): void {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buf);
    } catch {
      return; // not a valid zip
    }

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName.replace(/\\/g, '/');
      const basename = entryName.split('/').pop() ?? '';

      // Nested zip — recurse
      if (basename.endsWith('.zip')) {
        const nested = entry.getData();
        processZip(nested);
        continue;
      }

      // Site JSON file: matches pattern like "2260-www.domain.com.json"
      // (NOT Images.json / Objects.json / Sites-Schema.json / Images-Schema.json)
      if (
        basename.endsWith('.json') &&
        /^\d+-/.test(basename) &&
        !basename.toLowerCase().includes('schema')
      ) {
        results.push({ filename: basename, content: entry.getData() });
      }
    }
  }

  processZip(zipBuffer);
  return results;
}

/**
 * Parse a site JSON buffer — handles UTF-8 BOM.
 */
function parseSiteJson(buf: Buffer): Record<string, unknown> {
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

/**
 * Extract domain and site_id from filename like "2260-www.ClientsBestInterest.com.json"
 */
function parseFilename(filename: string): { siteId: string; domain: string } {
  const m = filename.match(/^(\d+)-(.+)\.json$/i);
  if (m) return { siteId: m[1], domain: m[2] };
  return { siteId: '', domain: filename.replace(/\.json$/i, '') };
}

// ── Stats computation ─────────────────────────────────────────────────────────

export interface DeliveryStats {
  total: number;
  by_phase: Record<string, number>;
  by_wave: Record<string, number>;
  live: number;
  under_construction: number;
  with_broker_check_on: number;
  with_custom_pages: number;
  with_tax_library: number;
  with_gtm: number;
  with_bing: number;
  with_seo: number;
  with_blog: number;
  with_aria_labels: number;
}

function computeStats(siteParsedList: Record<string, unknown>[]): DeliveryStats {
  const stats: DeliveryStats = {
    total: siteParsedList.length,
    by_phase: {},
    by_wave: {},
    live: 0,
    under_construction: 0,
    with_broker_check_on: 0,
    with_custom_pages: 0,
    with_tax_library: 0,
    with_gtm: 0,
    with_bing: 0,
    with_seo: 0,
    with_blog: 0,
    with_aria_labels: 0,
  };

  for (const d of siteParsedList) {
    const phase = String(d['phase'] ?? '?');
    const wave  = String(d['wave']  ?? '?');
    stats.by_phase[phase] = (stats.by_phase[phase] ?? 0) + 1;
    stats.by_wave[wave]   = (stats.by_wave[wave]   ?? 0) + 1;

    const status = String(d['Live-Site-Status'] ?? '');
    if (status === 'Live') stats.live++;
    else if (status.toLowerCase().includes('construction')) stats.under_construction++;

    const bc = (d['brokerCheck'] as Record<string, unknown> | null) ?? {};
    if (bc['BrokerCheckEnabled'] === 'On') stats.with_broker_check_on++;

    const customPages = d['user-custom-pages'];
    if (Array.isArray(customPages) && customPages.length > 0) stats.with_custom_pages++;

    const tl = d['taxLibrary'];
    if (tl && typeof tl === 'object' &&
        Object.values(tl as Record<string, unknown>).some((v) => v === 'Yes')) {
      stats.with_tax_library++;
    }

    const analytics = (d['analytics'] as Record<string, unknown> | null) ?? {};
    if (analytics['google-tag-manager']) stats.with_gtm++;
    if (analytics['bing-site-auth'])      stats.with_bing++;

    const seo = (d['seo'] as Record<string, unknown> | null) ?? {};
    if (Object.values(seo).some((v) => String(v ?? '').trim().length > 0)) stats.with_seo++;

    const navJson = JSON.stringify(d['user-navigation'] ?? []);
    if (navJson.toLowerCase().includes('blog')) stats.with_blog++;

    // aria-labels: scan all user-content-fields for any "aria" mention
    const ucf = d['user-content-fields'];
    if (Array.isArray(ucf) && ucf.some((f) => JSON.stringify(f).toLowerCase().includes('aria'))) {
      stats.with_aria_labels++;
    }
  }

  return stats;
}

// ── Deep diff ─────────────────────────────────────────────────────────────────

export interface DiffEntry {
  path: string;
  type: 'added' | 'removed' | 'changed';
  was?: unknown;
  now?: unknown;
}

function deepDiff(a: unknown, b: unknown, path = ''): DiffEntry[] {
  const changes: DiffEntry[] = [];

  if (
    typeof a === 'object' && a !== null && !Array.isArray(a) &&
    typeof b === 'object' && b !== null && !Array.isArray(b)
  ) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const k of [...keys].sort()) {
      const full = path ? `${path}.${k}` : k;
      if (!(k in aObj)) {
        changes.push({ path: full, type: 'added', now: bObj[k] });
      } else if (!(k in bObj)) {
        changes.push({ path: full, type: 'removed', was: aObj[k] });
      } else {
        changes.push(...deepDiff(aObj[k], bObj[k], full));
      }
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      // Treat length change as a high-level change; still recurse for individual items
      changes.push({ path: `${path}.__length`, type: 'changed', was: a.length, now: b.length });
    }
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      changes.push(...deepDiff(a[i], b[i], `${path}[${i}]`));
    }
    // Items added
    for (let i = len; i < b.length; i++) {
      changes.push({ path: `${path}[${i}]`, type: 'added', now: b[i] });
    }
    // Items removed
    for (let i = len; i < a.length; i++) {
      changes.push({ path: `${path}[${i}]`, type: 'removed', was: a[i] });
    }
  } else if (a !== b) {
    changes.push({ path, type: 'changed', was: a, now: b });
  }

  return changes;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** POST /api/deliveries/upload — upload a zip file */
deliveryRoutes.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Send multipart/form-data with field "file".' });
    return;
  }

  const deliveryId   = uuid();
  const filename     = req.file.originalname;
  const deliveryDate = parseDeliveryDate(filename);
  const label        = typeof req.body?.label === 'string' ? req.body.label.trim() : '';

  insertDelivery({ id: deliveryId, filename, label, delivery_date: deliveryDate });

  // Process synchronously — zip parsing is fast
  try {
    const siteFiles = extractSiteJsons(req.file.buffer);

    if (siteFiles.length === 0) {
      updateDeliveryError(deliveryId, 'No site JSON files found in zip');
      res.status(422).json({ error: 'No site JSON files found in zip', delivery_id: deliveryId });
      return;
    }

    const domains: string[] = [];
    const parsedSites: Record<string, unknown>[] = [];

    for (const { filename: sf, content } of siteFiles) {
      let parsed: Record<string, unknown>;
      try {
        parsed = parseSiteJson(content);
      } catch {
        continue; // skip unparseable files
      }

      const { siteId, domain } = parseFilename(sf);
      // Prefer the domain field from the JSON itself if available
      const resolvedDomain = (parsed['domain'] as string | undefined) ?? domain;

      insertSiteVersion({
        id: uuid(),
        delivery_id: deliveryId,
        domain: resolvedDomain,
        site_id: siteId || null,
        json_data: JSON.stringify(parsed),
        delivery_date: deliveryDate,
        phase: typeof parsed['phase'] === 'number' ? parsed['phase'] : null,
        wave:  typeof parsed['wave']  === 'number' ? parsed['wave']  : null,
      });

      domains.push(resolvedDomain);
      parsedSites.push(parsed);
    }

    recalcLatest([...new Set(domains)]);
    const stats = computeStats(parsedSites);
    updateDeliveryStats(deliveryId, JSON.stringify(stats));
    updateDeliveryDone(deliveryId, domains.length);

    res.status(201).json({
      delivery_id: deliveryId,
      filename,
      delivery_date: deliveryDate,
      sites_imported: domains.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateDeliveryError(deliveryId, msg);
    res.status(500).json({ error: msg, delivery_id: deliveryId });
  }
});

/** GET /api/deliveries — list all deliveries (includes parsed stats) */
deliveryRoutes.get('/', (_req, res) => {
  const rows = listDeliveries();
  res.json(rows.map((d) => ({
    ...d,
    stats: d.stats_json ? JSON.parse(d.stats_json) : null,
  })));
});

/** GET /api/deliveries/sites — all sites with version summary */
deliveryRoutes.get('/sites', (_req, res) => {
  res.json(listSiteSummaries());
});

/** GET /api/deliveries/sites/:domain — version history for one site */
deliveryRoutes.get('/sites/:domain', (req, res) => {
  const domain = decodeURIComponent(req.params.domain);
  const history = getSiteHistory(domain);
  if (history.length === 0) {
    res.status(404).json({ error: 'No versions found for domain' });
    return;
  }
  // Return metadata (no json_data blob in list to keep it light)
  res.json(
    history.map(({ json_data: _jd, ...rest }) => rest)
  );
});

/** GET /api/deliveries/diff?v1=ID&v2=ID — diff two site versions */
deliveryRoutes.get('/diff', (req, res) => {
  const { v1, v2 } = req.query as { v1?: string; v2?: string };
  if (!v1 || !v2) {
    res.status(400).json({ error: 'v1 and v2 query params required' });
    return;
  }

  const ver1 = getSiteVersion(v1);
  const ver2 = getSiteVersion(v2);

  if (!ver1 || !ver2) {
    res.status(404).json({ error: 'One or both versions not found' });
    return;
  }

  if (ver1.domain !== ver2.domain) {
    res.status(400).json({ error: 'Versions belong to different domains' });
    return;
  }

  const j1 = JSON.parse(ver1.json_data) as Record<string, unknown>;
  const j2 = JSON.parse(ver2.json_data) as Record<string, unknown>;
  const changes = deepDiff(j1, j2);

  res.json({
    domain: ver1.domain,
    v1: { id: ver1.id, delivery_date: ver1.delivery_date, delivery_id: ver1.delivery_id },
    v2: { id: ver2.id, delivery_date: ver2.delivery_date, delivery_id: ver2.delivery_id },
    change_count: changes.length,
    changes,
  });
});

/** GET /api/deliveries/version/:id — get full JSON for one version */
deliveryRoutes.get('/version/:id', (req, res) => {
  const ver = getSiteVersion(req.params.id);
  if (!ver) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }
  res.json({ ...ver, json_data: JSON.parse(ver.json_data) });
});

/**
 * POST /api/deliveries/backfill
 * Re-parse stored json_data for all deliveries to populate phase/wave/stats.
 * Safe to run multiple times (idempotent).
 */
deliveryRoutes.post('/backfill', (_req, res) => {
  const deliveries = listDeliveries();
  let totalVersions = 0;
  let totalDeliveries = 0;

  for (const delivery of deliveries) {
    const versions = getSiteVersionsByDelivery(delivery.id);
    const parsedSites: Record<string, unknown>[] = [];

    for (const ver of versions) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(ver.json_data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const phase = typeof parsed['phase'] === 'number' ? parsed['phase'] : null;
      const wave  = typeof parsed['wave']  === 'number' ? parsed['wave']  : null;
      updateSiteVersionPhaseWave(ver.id, phase, wave);
      parsedSites.push(parsed);
      totalVersions++;
    }

    if (parsedSites.length > 0) {
      const stats = computeStats(parsedSites);
      updateDeliveryStats(delivery.id, JSON.stringify(stats));
      totalDeliveries++;
    }
  }

  res.json({ ok: true, deliveries_updated: totalDeliveries, versions_updated: totalVersions });
});

/** PATCH /api/deliveries/:id/label — rename a delivery label */
deliveryRoutes.patch('/:id/label', (req, res) => {
  const { label } = req.body as { label?: string };
  if (typeof label !== 'string') {
    res.status(400).json({ error: 'label must be a string' });
    return;
  }
  const delivery = getDelivery(req.params.id);
  if (!delivery) {
    res.status(404).json({ error: 'Delivery not found' });
    return;
  }
  updateDeliveryLabel(req.params.id, label.trim());
  res.json({ ok: true, id: req.params.id, label: label.trim() });
});

/** GET /api/deliveries/:id — delivery detail */
deliveryRoutes.get('/:id', (req, res) => {
  const delivery = getDelivery(req.params.id);
  if (!delivery) {
    res.status(404).json({ error: 'Delivery not found' });
    return;
  }
  res.json(delivery);
});

/**
 * POST /api/deliveries/push/:domain
 * Pushes the latest JSON for a domain to the BR Source API.
 * Requires the Wix BO session cookie to be forwarded from the browser.
 */
deliveryRoutes.post('/push/:domain', async (req, res) => {
  const domain = decodeURIComponent(req.params.domain);
  const ver = getLatestSiteVersion(domain);

  if (!ver) {
    res.status(404).json({ error: `No version found for ${domain}` });
    return;
  }

  const siteJson = JSON.parse(ver.json_data) as Record<string, unknown>;
  const brApiUrl = `https://bo.wix.com/_api/broadridge-source/v1/sites/${encodeURIComponent(domain)}`;

  // Forward the Authorization or Cookie header the browser sends
  const authHeader = req.headers['authorization'] ?? req.headers['cookie'] ?? '';

  try {
    const response = await fetch(brApiUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader as string } : {}),
      },
      body: JSON.stringify(siteJson),
    });

    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }

    res.status(response.status).json({
      domain,
      br_status: response.status,
      br_response: body,
      version_id: ver.id,
      delivery_date: ver.delivery_date,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Failed to reach BR API: ${msg}` });
  }
});
