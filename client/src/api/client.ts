const BASE = '/api';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// ── Scans ──

export interface ScanListItem {
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
  page_count: number;
  passed: number;
  failed: number;
  duration_ms: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  accessibilityAudit?: {
    images: Array<{ src: string; alt: string | null; ariaLabel: string | null; hasAlt: boolean }>;
    links: Array<{ text: string; href: string; ariaLabel: string | null }>;
    headings: Array<{ tag: string; text: string; ariaLabel: string | null }>;
    formElements: Array<{ tag: string; type: string | null; ariaLabel: string | null; placeholder: string | null }>;
  } | null;
}

export interface ScanDetail extends ScanListItem {
  snapshot: unknown;
  report: {
    domain: string;
    timestamp: string;
    totalChecks: number;
    passed: number;
    failed: number;
    results: Array<{
      ruleId: string;
      ruleName: string;
      category: string;
      severity: string;
      passed: boolean;
      message: string;
      page: string;
      section: string;
      details?: unknown;
    }>;
  } | null;
}

export function listScans(): Promise<ScanListItem[]> {
  return request('/scans');
}

export function getScan(id: string): Promise<ScanDetail> {
  return request(`/scans/${id}`);
}

export function createScan(body: { domain: string; label?: string; viewports?: string; headed?: boolean; siteType?: string }): Promise<{ id: string }> {
  return request('/scans', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteScan(id: string): Promise<void> {
  return request(`/scans/${id}`, { method: 'DELETE' });
}

// ── Comparisons ──

export interface ComparisonListItem {
  id: string;
  original_domain: string;
  migrated_domain: string;
  label: string;
  status: string;
  viewports: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  total_checks: number;
  passed: number;
  failed: number;
  bugs_count: number | null;  // actual bug count from diff summary (null = old pre-fix comparison)
}

export interface ComparisonDetail extends ComparisonListItem {
  original_snapshot: unknown;
  migrated_snapshot: unknown;
  diff: {
    summary: {
      totalChecks: number;
      passed: number;
      failed: number;
      /** Real regression count after smart verdict classification */
      bugs?: number;
      contentChanged: number;
      newIssues: number;
      expectedChanges: number;
    };
    items: Array<{
      page: string;
      section: string;
      checkId: string;
      description: string;
      severity: string;
      original: unknown;
      migrated: unknown;
      changeType: string;
      /** Smart verdict — absent in old stored comparisons */
      verdict?: 'bug' | 'expected' | 'info';
    }>;
    pages: Array<{
      url: string;
      originalUrl?: string;
      migratedUrl?: string;
      items: Array<{
        page: string;
        section: string;
        checkId: string;
        description: string;
        severity: string;
        changeType: string;
        verdict?: 'bug' | 'expected' | 'info';
      }>;
    }>;
  } | null;
}

export function listComparisons(): Promise<ComparisonListItem[]> {
  return request('/comparisons');
}

export function getComparison(id: string): Promise<ComparisonDetail> {
  return request(`/comparisons/${id}`);
}

export function createComparison(body: { original: string; migrated: string; viewports?: string; siteType?: string; label?: string }): Promise<{ id: string }> {
  return request('/comparisons', { method: 'POST', body: JSON.stringify(body) });
}

export function compareFromScans(body: { originalScanId: string; migratedScanId: string; label?: string }): Promise<{ id: string }> {
  return request('/comparisons/from-scans', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteComparison(id: string): Promise<void> {
  return request(`/comparisons/${id}`, { method: 'DELETE' });
}

// ── Deliveries ──

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

export interface DeliveryListItem {
  id: string;
  filename: string;
  label: string;
  delivery_date: string | null;
  uploaded_at: string;
  site_count: number;
  status: string;
  error: string | null;
  stats: DeliveryStats | null;
}

export interface SiteSummary {
  domain: string;
  version_count: number;
  latest_date: string;
  latest_id: string;
  phase: number | null;
  wave: number | null;
}

export interface SiteVersionMeta {
  id: string;
  delivery_id: string;
  domain: string;
  site_id: string | null;
  delivery_date: string;
  is_latest: number;
  phase: number | null;
  wave: number | null;
}

export interface DiffEntry {
  path: string;
  type: 'added' | 'removed' | 'changed';
  was?: unknown;
  now?: unknown;
}

export interface DiffResult {
  domain: string;
  v1: { id: string; delivery_date: string; delivery_id: string };
  v2: { id: string; delivery_date: string; delivery_id: string };
  change_count: number;
  changes: DiffEntry[];
}

export function listDeliveries(): Promise<DeliveryListItem[]> {
  return request('/deliveries');
}

export function listSites(): Promise<SiteSummary[]> {
  return request('/deliveries/sites');
}

export function getSiteHistory(domain: string): Promise<SiteVersionMeta[]> {
  return request(`/deliveries/sites/${encodeURIComponent(domain)}`);
}

export function diffVersions(v1: string, v2: string): Promise<DiffResult> {
  return request(`/deliveries/diff?v1=${v1}&v2=${v2}`);
}

export function getVersionJson(id: string): Promise<{ json_data: Record<string, unknown> } & SiteVersionMeta> {
  return request(`/deliveries/version/${id}`);
}

export function uploadDelivery(file: File, label = ''): Promise<{ delivery_id: string; sites_imported: number; delivery_date: string }> {
  const form = new FormData();
  form.append('file', file);
  if (label) form.append('label', label);
  return fetch('/api/deliveries/upload', { method: 'POST', body: form })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      return res.json();
    });
}

export function updateDeliveryLabel(id: string, label: string): Promise<{ ok: boolean }> {
  return request(`/deliveries/${id}/label`, { method: 'PATCH', body: JSON.stringify({ label }) });
}

export function pushToApi(domain: string): Promise<{ br_status: number; delivery_date: string }> {
  return request(`/deliveries/push/${encodeURIComponent(domain)}`, { method: 'POST' });
}

// ── Dashboard ──

export interface DashboardData {
  scans: {
    total: number; done: number; failed: number; running: number; queued: number;
    total_passed: number; total_failed_checks: number; last_activity: string | null;
  };
  comparisons: {
    total: number; done: number; failed: number; running: number; queued: number;
    last_activity: string | null;
  };
  deliveries: {
    total_deliveries: number; total_sites: number; latest_delivery_date: string | null;
    latest_filename: string | null; latest_stats: DeliveryStats | null;
  };
  recent: Array<{
    type: 'scan' | 'comparison';
    id: string;
    title: string;
    subtitle: string;
    status: string;
    created_at: string;
    meta: string | null;
  }>;
}

export function getDashboard(): Promise<DashboardData> {
  return request('/dashboard');
}

// ── SSE ──

function subscribeProgress(
  endpoint: string,
  onMessage: (data: Record<string, unknown>) => void,
  onDone: () => void
): () => void {
  const source = new EventSource(endpoint);
  let receivedDone = false;

  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'done') {
      receivedDone = true;
      onDone();
      source.close();
    } else {
      onMessage(data);
    }
  };
  source.onerror = () => {
    source.close();
    if (!receivedDone) {
      // Connection dropped before the scan sent its done event.
      // This happens when the dev server hot-reloads or the connection blips.
      // Signal as an error so the UI doesn't proceed to comparison with a
      // missing snapshot. The server-side compareFromScans will retry/wait
      // if somehow triggered anyway.
      onMessage({ type: 'error', error: 'Scan connection lost — server may have restarted. Click "View error →" above to see the actual error.' });
    }
    onDone();
  };
  return () => source.close();
}

export function subscribeScanProgress(
  id: string,
  onMessage: (data: Record<string, unknown>) => void,
  onDone: () => void
): () => void {
  return subscribeProgress(`${BASE}/scans/${id}/progress`, onMessage, onDone);
}

export function subscribeComparisonProgress(
  id: string,
  onMessage: (data: Record<string, unknown>) => void,
  onDone: () => void
): () => void {
  return subscribeProgress(`${BASE}/comparisons/${id}/progress`, onMessage, onDone);
}
