import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getScan } from '../api/client';
import { RuleSummary } from '../components/RuleSummary';
import { SeverityBadge } from '../components/SeverityBadge';
import { exportScanCsv } from '../utils/export';
import type { SiteSnapshot, ValidationResult, ContentComparisonSummary } from '../components/tabs/shared';
import { ChecklistTab } from '../components/tabs/ChecklistTab';
import { LinkMapTab } from '../components/tabs/LinkMapTab';
import { LinksTab } from '../components/tabs/LinksTab';
import { ImagesTab } from '../components/tabs/ImagesTab';
import { ContactTab } from '../components/tabs/ContactTab';
import { ContentFidelityTab } from '../components/tabs/ContentFidelityTab';
import { AccessibilityTab } from '../components/tabs/AccessibilityTab';

type Tab = 'checklist' | 'linkmap' | 'rules' | 'links' | 'images' | 'contact' | 'content' | 'accessibility';
type SeverityFilter = 'all' | 'critical' | 'major' | 'minor' | 'info';

// ── Main component ────────────────────────────────────────────────────────────

export function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const { data: scan, isLoading } = useQuery({
    queryKey: ['scan', id],
    queryFn: () => getScan(id!),
    enabled: !!id,
    refetchInterval: false,
  });

  const [tab, setTab] = useState<Tab>('checklist');
  const [severity, setSeverity] = useState<SeverityFilter>('all');

  if (isLoading) return <div className="text-center py-12 text-[var(--text-muted)]">Loading report...</div>;
  if (!scan) return <div className="text-center py-12 text-red-400">Scan not found</div>;

  // ── Failed scan ───────────────────────────────────────────────────────────
  if (scan.status === 'failed') {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <Link to="/scans" className="text-[var(--blue)] hover:underline text-sm">&larr; Back</Link>
          <h1 className="text-2xl font-bold">{scan.domain}</h1>
          <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/15 text-red-400">failed</span>
        </div>

        <div className="bg-red-500/8 border border-red-500/25 rounded-xl p-6 mb-6">
          <h2 className="text-base font-semibold text-red-400 mb-3 flex items-center gap-2">
            <span>⚠</span> Scan failed
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 text-sm">
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">Domain</p>
              <p className="font-medium break-all">{scan.domain}</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">Label</p>
              <p>{scan.label || '—'}</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">Viewports</p>
              <p>{scan.viewports}</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">Failed at</p>
              <p>{scan.completed_at ? new Date(scan.completed_at).toLocaleString() : '—'}</p>
            </div>
          </div>
          <div>
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-2">Error message</p>
            <pre className="bg-[var(--bg)] border border-red-500/20 rounded-lg p-4 text-sm text-red-300 whitespace-pre-wrap break-all font-mono leading-relaxed">
              {scan.error ?? 'Unknown error'}
            </pre>
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3 text-[var(--text-muted)] uppercase tracking-wider">Common causes</h3>
          <ul className="space-y-2 text-sm text-[var(--text-muted)]">
            <li className="flex gap-2"><span className="text-yellow-400 shrink-0">→</span> Site requires auth or blocks automated browsers (anti-bot protection)</li>
            <li className="flex gap-2"><span className="text-yellow-400 shrink-0">→</span> Domain not reachable or returns 4xx/5xx on all pages</li>
            <li className="flex gap-2"><span className="text-yellow-400 shrink-0">→</span> Page crashed mid-scan (browser tab closed by the site)</li>
            <li className="flex gap-2"><span className="text-yellow-400 shrink-0">→</span> Timeout exceeded — try scanning again with fewer viewports</li>
          </ul>
          <div className="mt-5 pt-4 border-t border-[var(--border)] flex gap-3">
            <Link
              to={`/scans?retry=${encodeURIComponent(scan.domain)}&label=${encodeURIComponent(scan.label)}&viewports=${encodeURIComponent(scan.viewports)}`}
              className="px-4 py-2 text-sm bg-[var(--blue)] text-white rounded-lg hover:brightness-110 transition"
            >
              Retry this scan
            </Link>
            <Link to="/scans" className="px-4 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:text-[var(--text)] transition">
              Back to scans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal scan report ────────────────────────────────────────────────────
  const report = scan.report;
  const snapshot = scan.snapshot as SiteSnapshot | null;

  const results: ValidationResult[] = report?.results ?? [];
  const criticalCount = results.filter(r => r.severity === 'critical' && !r.passed).length;
  const filtered = severity === 'all' ? results : results.filter(r => r.severity === severity);

  const pageGroups = new Map<string, typeof results>();
  for (const r of filtered) {
    const key = r.page || 'all';
    if (!pageGroups.has(key)) pageGroups.set(key, []);
    pageGroups.get(key)!.push(r);
  }

  const severityCounts = {
    all: results.length,
    critical: results.filter(r => r.severity === 'critical').length,
    major: results.filter(r => r.severity === 'major').length,
    minor: results.filter(r => r.severity === 'minor').length,
    info: results.filter(r => r.severity === 'info').length,
  };

  const contentComparisons: ContentComparisonSummary[] = snapshot?.metadata?.contentComparisons ?? [];

  const TABS: { key: Tab; label: string; badge?: string }[] = [
    { key: 'checklist', label: '✓ Checklist' },
    { key: 'linkmap',   label: '🔗 Link Map' },
    { key: 'rules',     label: 'Rules' },
    { key: 'links',     label: 'Links' },
    { key: 'images',    label: 'Images' },
    { key: 'contact',   label: 'Contact' },
    ...(contentComparisons.length > 0
      ? [{ key: 'content' as Tab, label: '📊 Content Fidelity', badge: contentComparisons.every(c => c.allHigh) ? '✓' : '⚠' }]
      : []),
    { key: 'accessibility' as Tab, label: 'Accessibility' },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/scans" className="text-[var(--blue)] hover:underline text-sm">&larr; Back</Link>
        <h1 className="text-2xl font-bold">{scan.domain}</h1>
        <span className="text-[var(--text-muted)]">({scan.label})</span>
      </div>

      {report && (
        <RuleSummary
          totalChecks={report.totalChecks}
          passed={report.passed}
          failed={report.failed}
          critical={criticalCount}
          duration={scan.duration_ms}
          pageCount={scan.page_count}
        />
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-[var(--border)] pb-3 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
              tab === t.key
                ? 'bg-[var(--blue)] text-white'
                : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'
            }`}
          >
            {t.label}
            {t.badge && (
              <span className={`text-xs ${t.badge === '✓' ? 'text-green-400' : 'text-yellow-400'}`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'checklist' && <ChecklistTab snapshot={snapshot} results={results} />}
      {tab === 'linkmap'   && <LinkMapTab snapshot={snapshot} />}
      {tab === 'links'     && <LinksTab snapshot={snapshot} />}
      {tab === 'images'    && <ImagesTab snapshot={snapshot} />}
      {tab === 'contact'   && <ContactTab snapshot={snapshot} />}
      {tab === 'content'        && <ContentFidelityTab comparisons={contentComparisons} />}
      {tab === 'accessibility'  && <AccessibilityTab original={snapshot} migrated={null} pairedPages={[]} />}

      {tab === 'rules' && (
        <>
          <div className="flex gap-2 mb-6 flex-wrap items-center">
            {(Object.entries(severityCounts) as [SeverityFilter, number][]).map(([sev, count]) => (
              <button
                key={sev}
                onClick={() => setSeverity(sev)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition border ${
                  severity === sev
                    ? 'bg-[var(--blue)] border-[var(--blue)] text-white'
                    : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)]'
                }`}
              >
                {sev === 'all' ? 'All' : sev.charAt(0).toUpperCase() + sev.slice(1)} ({count})
              </button>
            ))}
            {report && (
              <div className="ml-auto">
                <button
                  onClick={() => exportScanCsv(scan.domain, report.timestamp, report.totalChecks, report.passed, report.failed, results.map(r => ({ ...r, section: r.section ?? 'all' })), severity)}
                  className="px-4 py-1.5 text-sm font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--blue)] transition"
                >
                  ↓ Export CSV
                </button>
              </div>
            )}
          </div>

          {[...pageGroups.entries()].map(([pageUrl, pageResults]) => (
            <div key={pageUrl} className="mb-8">
              <h3 className="text-base font-semibold mb-3 pb-2 border-b border-[var(--border)]">{pageUrl}</h3>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-[var(--border)]">
                      <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Rule</th>
                      <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Category</th>
                      <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Severity</th>
                      <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Status</th>
                      <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageResults.map((r, i) => (
                      <tr key={i} className="border-b border-[var(--border)] hover:bg-blue-500/5">
                        <td className="px-4 py-2"><code className="text-xs">{r.ruleId}</code></td>
                        <td className="px-4 py-2 text-sm">{r.category}</td>
                        <td className="px-4 py-2"><SeverityBadge severity={r.severity} /></td>
                        <td className="px-4 py-2">
                          <span className={`text-xs font-semibold ${r.passed ? 'text-green-400' : 'text-red-400'}`}>
                            {r.passed ? 'PASS' : 'FAIL'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm max-w-md truncate" title={r.message}>{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
