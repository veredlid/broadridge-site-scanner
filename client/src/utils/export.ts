// ─── CSV export utilities ──────────────────────────────────────────────────

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  // Wrap in quotes if it contains commas, newlines, or quotes
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toRow(cells: unknown[]): string {
  return cells.map(csvEscape).join(',');
}

// ─── Comparison diff export ────────────────────────────────────────────────

type VerdictFilter = 'bugs' | 'all-issues' | 'expected' | 'all';

interface DiffItem {
  page: string;
  section: string;
  checkId: string;
  description: string;
  severity: string;
  changeType: string;
  verdict?: 'bug' | 'expected' | 'info';
  original?: unknown;
  migrated?: unknown;
}

interface DiffPage {
  originalUrl?: string;
  migratedUrl?: string;
  url: string;
  items: DiffItem[];
}

interface DiffSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  bugs?: number;
  expectedChanges: number;
  contentChanged: number;
  newIssues: number;
}

function getEffectiveVerdict(i: DiffItem): 'bug' | 'expected' | 'info' {
  if (i.verdict) return i.verdict;
  if (i.changeType === 'expected-change') return 'expected';
  if (i.changeType === 'new-in-migrated' || i.changeType === 'content-changed') return 'info';
  return (i.severity === 'critical' || i.severity === 'major') ? 'bug' : 'info';
}

function filterItemsByVerdict(items: DiffItem[], filter: VerdictFilter): DiffItem[] {
  switch (filter) {
    case 'bugs':       return items.filter((i) => getEffectiveVerdict(i) === 'bug');
    case 'all-issues': return items.filter((i) => getEffectiveVerdict(i) !== 'expected');
    case 'expected':   return items.filter((i) => getEffectiveVerdict(i) === 'expected');
    case 'all':        return items;
  }
}

const VERDICT_LABEL: Record<VerdictFilter, string> = {
  bugs: 'Bugs only',
  'all-issues': 'All issues',
  expected: 'Expected changes',
  all: 'All items',
};

export function exportComparisonCsv(
  originalDomain: string,
  migratedDomain: string,
  summary: DiffSummary,
  pages: DiffPage[],
  verdictFilter: VerdictFilter
): void {
  const lines: string[] = [];

  // Header block
  lines.push(toRow(['BR Site Scanner — Comparison Report']));
  lines.push(toRow(['Original', originalDomain]));
  lines.push(toRow(['Migrated', migratedDomain]));
  lines.push(toRow(['Exported', new Date().toLocaleString()]));
  lines.push(toRow(['Filter', VERDICT_LABEL[verdictFilter] ?? verdictFilter]));
  lines.push('');
  lines.push(toRow(['Total Items', 'Real Bugs', 'Expected Changes', 'Content Changed', 'New in Migrated']));
  lines.push(toRow([
    summary.totalChecks,
    summary.bugs ?? summary.failed,
    summary.expectedChanges ?? 0,
    summary.contentChanged,
    summary.newIssues,
  ]));
  lines.push('');

  // Column headers
  lines.push(toRow([
    'Page (Original)',
    'Page (Migrated)',
    'Verdict',
    'Section',
    'Check ID',
    'Severity',
    'Status',
    'Description',
    'Original Value',
    'Migrated Value',
  ]));

  // Data rows
  for (const page of pages) {
    const items = filterItemsByVerdict(page.items, verdictFilter);

    for (const item of items) {
      lines.push(toRow([
        page.originalUrl ?? page.url,
        page.migratedUrl ?? page.url,
        getEffectiveVerdict(item),
        item.section,
        item.checkId,
        item.severity,
        item.changeType,
        item.description,
        typeof item.original === 'string' ? item.original : JSON.stringify(item.original ?? ''),
        typeof item.migrated === 'string' ? item.migrated : JSON.stringify(item.migrated ?? ''),
      ]));
    }
  }

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `comparison-${slugify(originalDomain)}-vs-${slugify(migratedDomain)}-${datestamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Scan report export ────────────────────────────────────────────────────

interface RuleResult {
  ruleId: string;
  ruleName: string;
  category: string;
  severity: string;
  passed: boolean;
  message: string;
  page: string;
  section: string;
}

export function exportScanCsv(
  domain: string,
  timestamp: string,
  totalChecks: number,
  passed: number,
  failed: number,
  results: RuleResult[],
  severityFilter: string
): void {
  const lines: string[] = [];

  lines.push(toRow(['BR Site Scanner — Scan Report']));
  lines.push(toRow(['Domain', domain]));
  lines.push(toRow(['Scanned', new Date(timestamp).toLocaleString()]));
  lines.push(toRow(['Exported', new Date().toLocaleString()]));
  lines.push(toRow(['Filter', severityFilter === 'all' ? 'All severities' : severityFilter]));
  lines.push('');
  lines.push(toRow(['Total Checks', 'Passed', 'Failed']));
  lines.push(toRow([totalChecks, passed, failed]));
  lines.push('');

  lines.push(toRow([
    'Page',
    'Section',
    'Rule ID',
    'Rule Name',
    'Category',
    'Severity',
    'Passed',
    'Message',
  ]));

  const filtered = severityFilter === 'all'
    ? results
    : results.filter((r) => r.severity === severityFilter);

  for (const r of filtered) {
    lines.push(toRow([
      r.page,
      r.section,
      r.ruleId,
      r.ruleName,
      r.category,
      r.severity,
      r.passed ? 'PASS' : 'FAIL',
      r.message,
    ]));
  }

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `scan-${slugify(domain)}-${datestamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10);
}
