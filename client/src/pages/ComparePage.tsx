import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  listComparisons,
  getComparison,
  createComparison,
  createScan,
  compareFromScans,
  deleteComparison,
  subscribeComparisonProgress,
  subscribeScanProgress,
  type ComparisonListItem,
} from '../api/client';
import { StatusBadge } from '../components/SeverityBadge';
import { Tooltip } from '../components/Tooltip';
import { DiffTable, type VerdictFilter } from '../components/DiffTable';
import { exportComparisonCsv } from '../utils/export';
import { ChecklistTab } from '../components/tabs/ChecklistTab';
import { LinkMapTab } from '../components/tabs/LinkMapTab';
import { LinksTab } from '../components/tabs/LinksTab';
import { ImagesTab } from '../components/tabs/ImagesTab';
import { ContactTab } from '../components/tabs/ContactTab';
import { ContentFidelityTab } from '../components/tabs/ContentFidelityTab';
import type { SiteSnapshot, ContentComparisonSummary } from '../components/tabs/shared';
import { normalizePath } from '../components/tabs/shared';

type CompareMode = 'sequential' | 'parallel';
type CompareTab = 'diff' | 'checklist' | 'linkmap' | 'links' | 'images' | 'contact' | 'content';
type SiteType = 'vanilla' | 'flex' | 'deprecated';

const SITE_TYPES: { value: SiteType; label: string; description: string }[] = [
  { value: 'vanilla',    label: 'Vanilla Bean',  description: '1-1 match — strict rules' },
  { value: 'flex',       label: 'Flex',           description: 'Template-based creative freedom' },
  { value: 'deprecated', label: 'Deprecated',     description: 'Older template, same rules as Flex' },
];

type ParallelStatus = {
  originalId: string | null;
  migratedId: string | null;
  originalDone: boolean;
  migratedDone: boolean;
  originalError: string | null;
  migratedError: string | null;
  originalLog: string[];
  migratedLog: string[];
  systemLog: string[];   // cross-scan messages (comparison step, redirect, etc.)
};

type RerunPrefill = {
  original: string;
  migrated: string;
  label: string;
  viewports: string; // comma-separated e.g. "desktop,tablet"
};

function CompareForm({ prefill, formRef }: { prefill?: RerunPrefill | null; formRef?: React.RefObject<HTMLDivElement | null> }) {
  const [original, setOriginal] = useState('');
  const [migrated, setMigrated] = useState('');
  const [label, setLabel] = useState('');
  const [siteType, setSiteType] = useState<SiteType | ''>('');
  const [viewports, setViewports] = useState({ desktop: true, tablet: false, mobile: false });
  const [headed, setHeaded] = useState(false);
  const [mode, setMode] = useState<CompareMode>('parallel');
  const [loading, setLoading] = useState(false);
  const [parallelStatus, setParallelStatus] = useState<ParallelStatus | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const unsubsRef = useRef<Array<() => void>>([]);

  // Apply prefill when a re-run is requested from the history table
  useEffect(() => {
    if (!prefill) return;
    setOriginal(prefill.original);
    setMigrated(prefill.migrated);
    setLabel(prefill.label ? `${prefill.label} (re-run)` : '');
    setSiteType(''); // user must confirm site type
    const vps = prefill.viewports?.split(',') ?? ['desktop'];
    setViewports({
      desktop: vps.includes('desktop'),
      tablet:  vps.includes('tablet'),
      mobile:  vps.includes('mobile'),
    });
    setParallelStatus(null);
  }, [prefill]);

  const vps = Object.entries(viewports).filter(([, v]) => v).map(([k]) => k).join(',') || 'desktop';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!original.trim() || !migrated.trim() || !siteType) return;
    setLoading(true);

    if (mode === 'sequential') {
      try {
        await createComparison({ original: original.trim(), migrated: migrated.trim(), viewports: vps, siteType, label: label.trim() || undefined });
        queryClient.invalidateQueries({ queryKey: ['comparisons'] });
        setOriginal(''); setMigrated(''); setLabel('');
      } finally { setLoading(false); }
      return;
    }

    const labelPrefix = label.trim();
    // Parallel mode: launch both scans simultaneously, compare when both done
    try {
      const [{ id: origId }, { id: migId }] = await Promise.all([
        createScan({ domain: original.trim(), label: labelPrefix ? `${labelPrefix} — original` : 'original', viewports: vps, headed, siteType }),
        createScan({ domain: migrated.trim(), label: labelPrefix ? `${labelPrefix} — migrated` : 'migrated', viewports: vps, headed, siteType }),
      ]);
      queryClient.invalidateQueries({ queryKey: ['scans'] });

      const status: ParallelStatus = {
        originalId: origId, migratedId: migId,
        originalDone: false, migratedDone: false,
        originalError: null, migratedError: null,
        originalLog: [], migratedLog: [], systemLog: [],
      };
      setParallelStatus({ ...status });

      const addOrigLog = (msg: string) =>
        setParallelStatus((prev) => prev ? { ...prev, originalLog: [...prev.originalLog, msg] } : prev);
      const addMigLog = (msg: string) =>
        setParallelStatus((prev) => prev ? { ...prev, migratedLog: [...prev.migratedLog, msg] } : prev);
      const addSysLog = (msg: string) =>
        setParallelStatus((prev) => prev ? { ...prev, systemLog: [...prev.systemLog, msg] } : prev);

      const tryCompare = async (s: ParallelStatus) => {
        if (!s.originalDone || !s.migratedDone) return;

        if (s.originalError || s.migratedError) {
          addSysLog(`❌ Comparison aborted — fix the scan error(s) above before comparing`);
          setLoading(false);
          return;
        }

        addSysLog('✓ Both scans complete — running comparison...');
        try {
          await compareFromScans({ originalScanId: origId, migratedScanId: migId, label: labelPrefix || undefined });
          queryClient.invalidateQueries({ queryKey: ['comparisons'] });
          addSysLog('✓ Comparison ready — redirecting to history...');
          setTimeout(() => { setParallelStatus(null); setLoading(false); navigate('/comparisons'); }, 1200);
        } catch (err) {
          addSysLog(`❌ Comparison failed: ${err instanceof Error ? err.message : String(err)}`);
          setLoading(false);
        }
      };

      let latestStatus = { ...status };

      const unsub1 = subscribeScanProgress(origId,
        (d) => {
          if (d.type === 'error') {
            const errMsg = d.error as string;
            latestStatus = { ...latestStatus, originalError: errMsg };
            setParallelStatus((p) => p ? { ...p, originalError: errMsg } : p);
            addOrigLog(`❌ Error: ${errMsg}`);
          } else if (d.message) {
            addOrigLog(d.message as string);
          }
        },
        async () => {
          latestStatus = { ...latestStatus, originalDone: true };
          setParallelStatus((p) => p ? { ...p, originalDone: true } : p);
          if (!latestStatus.originalError) addOrigLog('✓ Scan complete');
          await tryCompare(latestStatus);
        }
      );
      const unsub2 = subscribeScanProgress(migId,
        (d) => {
          if (d.type === 'error') {
            const errMsg = d.error as string;
            latestStatus = { ...latestStatus, migratedError: errMsg };
            setParallelStatus((p) => p ? { ...p, migratedError: errMsg } : p);
            addMigLog(`❌ Error: ${errMsg}`);
          } else if (d.message) {
            addMigLog(d.message as string);
          }
        },
        async () => {
          latestStatus = { ...latestStatus, migratedDone: true };
          setParallelStatus((p) => p ? { ...p, migratedDone: true } : p);
          if (!latestStatus.migratedError) addMigLog('✓ Scan complete');
          await tryCompare(latestStatus);
        }
      );
      unsubsRef.current = [unsub1, unsub2];
      setOriginal(''); setMigrated(''); setLabel('');
    } catch {
      setLoading(false);
    }
  };

  return (
    <div ref={formRef} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 mb-8">
      {prefill && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-xs text-purple-300 flex items-center gap-2">
          🔄 Pre-filled from previous run — select site type and click Compare to re-run.
        </div>
      )}
      {/* Mode toggle */}
      <div className="flex items-center gap-1 mb-5 bg-[var(--bg)] border border-[var(--border)] rounded-lg p-1 w-fit">
        {(['parallel', 'sequential'] as CompareMode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${mode === m ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
            {m === 'parallel' ? '⚡ Scan Both Now' : '↕ Sequential'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Row 1: domains + site type */}
        <div className="flex flex-wrap gap-4 items-end mb-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm text-[var(--text-muted)] mb-1">Original Domain</label>
            <input type="text" value={original} onChange={(e) => setOriginal(e.target.value)}
              placeholder="www.blankequity.com"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--blue)]" />
          </div>
          <span className="text-[var(--text-muted)] font-bold pb-2">&rarr;</span>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm text-[var(--text-muted)] mb-1">Migrated Domain</label>
            <input type="text" value={migrated} onChange={(e) => setMigrated(e.target.value)}
              placeholder="blankequity-26020000.brprodaccount.com"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--blue)]" />
          </div>
          {/* Site Type — mandatory */}
          <div className="min-w-[200px]">
            <label className="block text-sm mb-1 font-medium">
              Site Type <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              {SITE_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  title={t.description}
                  onClick={() => setSiteType(t.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                    siteType === t.value
                      ? t.value === 'vanilla'
                        ? 'bg-purple-500/20 border-purple-500/60 text-purple-300'
                        : t.value === 'deprecated'
                          ? 'bg-orange-500/20 border-orange-500/60 text-orange-300'
                          : 'bg-blue-500/20 border-blue-500/60 text-blue-300'
                      : 'bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {!siteType && (
              <p className="text-xs text-[var(--text-muted)] mt-1">Select site type to enable scan</p>
            )}
          </div>
        </div>

        {/* Row 2: viewports + headed + submit */}
        <div className="flex flex-wrap gap-4 items-center mb-3">
          <div className="flex gap-3 items-center flex-wrap">
            {(['desktop', 'tablet', 'mobile'] as const).map((vp) => (
              <label key={vp} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={viewports[vp]}
                  onChange={(e) => setViewports({ ...viewports, [vp]: e.target.checked })}
                  className="accent-[var(--blue)]" />
                {vp}
              </label>
            ))}
            <Tooltip content="Opens visible Chrome windows on the server so you can watch both scans in real time. Useful for debugging. Leave unchecked for normal use — headless mode is faster.">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-2 border-l border-[var(--border)] pl-3">
                <input type="checkbox" checked={headed}
                  onChange={(e) => setHeaded(e.target.checked)}
                  className="accent-[var(--blue)]" />
                <span className={headed ? 'text-[var(--blue)]' : 'text-[var(--text-muted)]'}>👁 Headed</span>
              </label>
            </Tooltip>
          </div>
          <button type="submit" disabled={loading || !original.trim() || !migrated.trim() || !siteType}
            className="px-6 py-2 bg-[var(--blue)] text-white rounded-lg font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition">
            {loading ? (mode === 'parallel' ? 'Scanning...' : 'Queuing...') : (mode === 'parallel' ? '⚡ Scan & Compare' : 'Compare')}
          </button>
        </div>
        {/* Row 3: optional label */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--text-muted)] shrink-0">Label <span className="opacity-60">(optional)</span></label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. pre-launch"
            className="w-48 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--blue)]" />
        </div>
      </form>

      {/* Parallel progress — two side-by-side columns */}
      {parallelStatus && (
        <div className="mt-5 bg-[var(--bg)] border border-[var(--border)] rounded-xl overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-2 border-b border-[var(--border)]">
            {([
              { key: 'orig', label: original || 'Original', done: parallelStatus.originalDone, err: parallelStatus.originalError, id: parallelStatus.originalId, accent: 'blue' },
              { key: 'mig',  label: migrated || 'Migrated', done: parallelStatus.migratedDone, err: parallelStatus.migratedError, id: parallelStatus.migratedId, accent: 'purple' },
            ] as const).map((col) => (
              <div key={col.key} className={`flex items-center gap-2 px-4 py-2.5 ${col.key === 'orig' ? 'border-r border-[var(--border)]' : ''}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  col.err ? 'bg-red-400' :
                  col.done ? 'bg-green-400' :
                  col.accent === 'blue' ? 'bg-blue-400 animate-pulse' : 'bg-purple-400 animate-pulse'
                }`} />
                <span className={`text-xs font-semibold truncate ${
                  col.err ? 'text-red-400' :
                  col.done ? 'text-green-400' :
                  col.accent === 'blue' ? 'text-blue-400' : 'text-purple-400'
                }`}>{col.label}</span>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <span className={`text-xs ${col.err ? 'text-red-400' : col.done ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>
                    {col.err ? 'failed ✗' : col.done ? 'done ✓' : 'scanning…'}
                  </span>
                  {col.err && col.id && (
                    <Link
                      to={`/scans/${col.id}`}
                      className="text-xs text-red-400 underline hover:text-red-300 transition"
                      title="View full error details for this scan"
                    >
                      View error →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Log columns */}
          <div className="grid grid-cols-2 font-mono text-xs max-h-52 overflow-hidden">
            {([
              { key: 'orig', log: parallelStatus.originalLog, accent: 'border-r border-[var(--border)]' },
              { key: 'mig',  log: parallelStatus.migratedLog, accent: '' },
            ] as const).map((col) => (
              <div key={col.key} className={`${col.accent} overflow-y-auto max-h-52 p-3 space-y-0.5`}>
                {col.log.length === 0
                  ? <span className="text-[var(--text-muted)]/40 italic">waiting…</span>
                  : col.log.map((msg, i) => (
                    <div key={i} className={
                      msg.startsWith('❌') ? 'text-red-400' :
                      msg.startsWith('✓') ? 'text-green-400' :
                      msg.startsWith('△') || msg.startsWith('⚠') ? 'text-yellow-400' :
                      'text-[var(--text-muted)]'
                    }>{msg}</div>
                  ))
                }
              </div>
            ))}
          </div>

          {/* System strip — comparison step + errors */}
          {parallelStatus.systemLog.length > 0 && (
            <div className="border-t border-[var(--border)] px-4 py-2 font-mono text-xs space-y-0.5">
              {parallelStatus.systemLog.map((msg, i) => (
                <div key={i} className={msg.startsWith('❌') ? 'text-red-400' : 'text-green-400'}>{msg}</div>
              ))}
            </div>
          )}

          {/* Retry button */}
          {(parallelStatus.originalError || parallelStatus.migratedError) && (
            <div className="border-t border-[var(--border)] px-4 py-2.5">
              <button
                onClick={() => { setParallelStatus(null); setLoading(false); }}
                className="px-4 py-1.5 text-xs bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:text-[var(--text)] transition"
              >
                Dismiss &amp; retry
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComparisonsList({ onRerun }: { onRerun: (prefill: RerunPrefill) => void }) {
  const { data: comparisons = [], isLoading } = useQuery({
    queryKey: ['comparisons'],
    queryFn: listComparisons,
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      const hasActive = rows.some((r) => r.status === 'queued' || r.status === 'running');
      return hasActive ? 3000 : false;
    },
  });
  const queryClient = useQueryClient();

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteComparison(id);
    queryClient.invalidateQueries({ queryKey: ['comparisons'] });
  };

  const handleRerun = (e: React.MouseEvent, c: ComparisonListItem) => {
    e.stopPropagation();
    onRerun({
      original: c.original_domain,
      migrated: c.migrated_domain,
      label: c.label ?? '',
      viewports: c.viewports ?? 'desktop',
    });
  };

  if (isLoading) return <div className="text-[var(--text-muted)] text-center py-8">Loading...</div>;
  if (comparisons.length === 0) {
    return (
      <div className="text-[var(--text-muted)] text-center py-12 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
        No comparisons yet.
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-[var(--border)]">
            <th className="px-4 py-3 text-left text-xs uppercase text-[var(--text-muted)]">Original</th>
            <th className="px-4 py-3 text-left text-xs uppercase text-[var(--text-muted)]">Migrated</th>
            <th className="px-4 py-3 text-left text-xs uppercase text-[var(--text-muted)]">Status</th>
            <th className="px-4 py-3 text-left text-xs uppercase text-[var(--text-muted)]">Bugs</th>
            <th className="px-4 py-3 text-left text-xs uppercase text-[var(--text-muted)]">Date</th>
            <th className="px-4 py-3 text-left text-xs uppercase text-[var(--text-muted)]">Label</th>
            <th className="px-4 py-3 text-right text-xs uppercase text-[var(--text-muted)]">Actions</th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((c: ComparisonListItem) => (
            <tr key={c.id} className="border-b border-[var(--border)] hover:bg-blue-500/5">
              <td className="px-4 py-3 font-medium max-w-[180px]">
                <Tooltip content={c.original_domain}>
                  <span className="block truncate">{c.original_domain}</span>
                </Tooltip>
              </td>
              <td className="px-4 py-3 font-medium max-w-[180px]">
                <Tooltip content={c.migrated_domain}>
                  <span className="block truncate">{c.migrated_domain}</span>
                </Tooltip>
              </td>
              <td className="px-4 py-3 max-w-[260px]">
                <StatusBadge status={c.status} />
                {c.status === 'failed' && c.error && (
                  <Tooltip content={c.error}>
                    <p className="text-xs text-red-400 mt-1 truncate">{c.error}</p>
                  </Tooltip>
                )}
              </td>
              <td className="px-4 py-3">
                {c.status === 'done' ? (
                  c.bugs_count == null
                    ? <span className="text-[var(--text-muted)]">—</span>
                    : c.bugs_count > 0
                      ? <span className="text-red-400 font-semibold">🐛 {c.bugs_count} bugs</span>
                      : <span className="text-green-400">✓ No bugs</span>
                ) : '—'}
              </td>
              <td className="px-4 py-3 text-[var(--text-muted)] text-sm">{new Date(c.created_at).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm">
                {c.label ? <span className="px-2 py-0.5 rounded bg-blue-500/10 text-[var(--blue)] text-xs font-medium">{c.label}</span> : <span className="text-[var(--text-muted)]/40">—</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex gap-2 justify-end">
                  {(c.status === 'done' || c.status === 'failed') && (
                    <Link
                      to={`/comparisons/${c.id}`}
                      className={`px-3 py-1 text-xs rounded-lg transition ${
                        c.status === 'failed'
                          ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                          : 'bg-[var(--blue)]/15 text-[var(--blue)] hover:bg-[var(--blue)]/25'
                      }`}
                    >
                      {c.status === 'failed' ? 'View Error' : 'View'}
                    </Link>
                  )}
                  <Tooltip content="Pre-fill the form with this comparison's domains and settings">
                    <button
                      onClick={(e) => handleRerun(e, c)}
                      className="px-3 py-1 text-xs bg-purple-500/15 text-purple-300 rounded-lg hover:bg-purple-500/25 transition"
                    >
                      🔄 Re-run
                    </button>
                  </Tooltip>
                  <button
                    onClick={(e) => handleDelete(e, c.id)}
                    className="px-3 py-1 text-xs bg-red-500/15 text-red-400 rounded-lg hover:bg-red-500/25 transition"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * PairedSideBySide — renders tabs page-by-page aligned by path.
 *
 * Pages are matched by normalised path (strips domain) so that
 * e.g. "www.example.com/about" ↔ "example-preview.com/about" pair up.
 * When a page exists only on one side, the other column shows a
 * "Page not found" placeholder so rows stay in sync.
 */
/**
 * Strip site name from page title so "Articles | Gunn Financial" → "articles"
 * allowing title-based fallback matching when URL paths differ between sites.
 */
function simplifyTitle(title: string): string {
  return title.split(/\s*[|\-–—]\s*/)[0].toLowerCase().trim();
}

function PairedSideBySide({
  originalSnapshot,
  migratedSnapshot,
  originalDomain,
  migratedDomain,
  renderPage,
}: {
  originalSnapshot: SiteSnapshot | null;
  migratedSnapshot: SiteSnapshot | null;
  originalDomain: string;
  migratedDomain: string;
  renderPage: (snapshot: SiteSnapshot) => React.ReactNode;
}) {
  const origPages = originalSnapshot?.pages ?? [];
  const migPages  = migratedSnapshot?.pages ?? [];

  // ── Step 1: match by normalised path ───────────────────────────────────────
  type Pair = { origPage: typeof origPages[number] | null; migPage: typeof migPages[number] | null; key: string };
  const pairs: Pair[] = [];
  const matchedOrigPaths = new Set<string>();
  const matchedMigPaths  = new Set<string>();

  for (const op of origPages) {
    const oPath = normalizePath(op.url);
    const mp = migPages.find((p) => normalizePath(p.url) === oPath);
    if (mp) {
      pairs.push({ origPage: op, migPage: mp, key: oPath });
      matchedOrigPaths.add(oPath);
      matchedMigPaths.add(normalizePath(mp.url));
    }
  }

  // ── Step 2: fallback — match unmatched pages by simplified title ────────────
  const unmatchedOrig = origPages.filter((p) => !matchedOrigPaths.has(normalizePath(p.url)));
  const unmatchedMig  = migPages.filter((p)  => !matchedMigPaths.has(normalizePath(p.url)));

  const usedMigTitles = new Set<string>();
  for (const op of unmatchedOrig) {
    const oTitle = simplifyTitle(op.title);
    const mp = unmatchedMig.find((p) => !usedMigTitles.has(simplifyTitle(p.title)) && simplifyTitle(p.title) === oTitle);
    if (mp) {
      usedMigTitles.add(simplifyTitle(mp.title));
      pairs.push({ origPage: op, migPage: mp, key: normalizePath(op.url) + '__title__' + oTitle });
    } else {
      // Original page with no match on migrated side
      pairs.push({ origPage: op, migPage: null, key: normalizePath(op.url) });
    }
  }
  // Migrated pages with no match on original side
  for (const mp of unmatchedMig) {
    if (!usedMigTitles.has(simplifyTitle(mp.title))) {
      pairs.push({ origPage: null, migPage: mp, key: normalizePath(mp.url) + '__mig' });
    }
  }

  return (
    <div className="space-y-8">
      {/* Column headers */}
      <div className="grid grid-cols-2 gap-6">
        <div className="flex items-center gap-2 pb-2 border-b border-blue-500/30">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shrink-0" />
          <span className="text-sm font-semibold text-blue-400 truncate">{originalDomain}</span>
          <span className="text-xs text-[var(--text-muted)]">original</span>
        </div>
        <div className="flex items-center gap-2 pb-2 border-b border-purple-500/30">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-400 shrink-0" />
          <span className="text-sm font-semibold text-purple-400 truncate">{migratedDomain}</span>
          <span className="text-xs text-[var(--text-muted)]">migrated</span>
        </div>
      </div>

      {/* One aligned row per page pair */}
      {pairs.map(({ origPage, migPage, key }) => {
        const origSingle = origPage && originalSnapshot
          ? { ...originalSnapshot, pages: [origPage] } : null;
        const migSingle  = migPage  && migratedSnapshot
          ? { ...migratedSnapshot, pages: [migPage]  } : null;

        // If matched by title but paths differ, show a notice
        const pathsDiffer = origPage && migPage
          && normalizePath(origPage.url) !== normalizePath(migPage.url);

        return (
          <div key={key} className="space-y-1">
            {pathsDiffer && (
              <p className="text-xs text-[var(--text-muted)] px-1">
                ⚠ Matched by title — paths differ:&nbsp;
                <code>{normalizePath(origPage!.url)}</code> ↔ <code>{normalizePath(migPage!.url)}</code>
              </p>
            )}
            <div className="grid grid-cols-2 gap-6 min-w-0">
              <div className="min-w-0">
                {origSingle ? renderPage(origSingle) : (
                  <div className="bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-xl p-6 text-center text-[var(--text-muted)] text-sm">
                    <span className="text-lg block mb-1">🚫</span>
                    No matching page found on original site
                  </div>
                )}
              </div>
              <div className="min-w-0">
                {migSingle ? renderPage(migSingle) : (
                  <div className="bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-xl p-6 text-center text-[var(--text-muted)] text-sm">
                    <span className="text-lg block mb-1">🚫</span>
                    No matching page found on migrated site
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * SideBySide — simple two-column layout for non-page-aligned content
 * (e.g. Content Fidelity which already groups internally).
 */
function SideBySide({ originalDomain, migratedDomain, children }: {
  originalDomain: string;
  migratedDomain: string;
  children: [React.ReactNode, React.ReactNode];
}) {
  return (
    <div className="grid grid-cols-2 gap-6 min-w-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-blue-500/30">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shrink-0"></span>
          <span className="text-sm font-semibold text-blue-400 truncate">{originalDomain}</span>
          <span className="text-xs text-[var(--text-muted)]">original</span>
        </div>
        {children[0]}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-purple-500/30">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-400 shrink-0"></span>
          <span className="text-sm font-semibold text-purple-400 truncate">{migratedDomain}</span>
          <span className="text-xs text-[var(--text-muted)]">migrated</span>
        </div>
        {children[1]}
      </div>
    </div>
  );
}

function ComparisonDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { data: comp, isLoading } = useQuery({
    queryKey: ['comparison', id],
    queryFn: () => getComparison(id),
    refetchInterval: false,
  });
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('bugs');
  const [compareTab, setCompareTab] = useState<CompareTab>('diff');
  const [progressLog, setProgressLog] = useState<string[]>([]);

  useEffect(() => {
    if (!comp || comp.status === 'done' || comp.status === 'failed') return;

    const unsub = subscribeComparisonProgress(
      id,
      (data) => {
        if (data.type === 'progress' && data.message) {
          setProgressLog((prev) => [...prev, data.message as string]);
        }
        if (data.type === 'status' && data.status === 'done') {
          queryClient.invalidateQueries({ queryKey: ['comparison', id] });
          queryClient.invalidateQueries({ queryKey: ['comparisons'] });
        }
      },
      () => {
        queryClient.invalidateQueries({ queryKey: ['comparison', id] });
        queryClient.invalidateQueries({ queryKey: ['comparisons'] });
      }
    );

    return unsub;
  }, [id, comp?.status, queryClient]);

  if (isLoading) return <div className="text-center py-12 text-[var(--text-muted)]">Loading...</div>;
  if (!comp) return <div className="text-center py-12 text-red-400">Comparison not found</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/comparisons" className="text-[var(--blue)] hover:underline text-sm">&larr; Back</Link>
        <h1 className="text-2xl font-bold">{comp.original_domain} &rarr; {comp.migrated_domain}</h1>
        <StatusBadge status={comp.status} />
      </div>

      {/* Live progress */}
      {(comp.status === 'queued' || comp.status === 'running') && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 mb-6 font-mono text-sm">
          <p className="text-[var(--text-muted)] mb-2 text-xs uppercase tracking-wider">Live Progress</p>
          {progressLog.length === 0 ? (
            <p className="text-[var(--text-muted)]">Waiting for job to start…</p>
          ) : (
            <ul className="space-y-1">
              {progressLog.map((msg, i) => (
                <li key={i} className="text-green-400">{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Error */}
      {comp.status === 'failed' && comp.error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm">
          <strong>Error:</strong> {comp.error}
        </div>
      )}

      {(() => {
        const originalSnapshot = comp.original_snapshot as SiteSnapshot | null;
        const migratedSnapshot = comp.migrated_snapshot as SiteSnapshot | null;
        const originalComparisons: ContentComparisonSummary[] = originalSnapshot?.metadata?.contentComparisons ?? [];
        const migratedComparisons: ContentComparisonSummary[] = migratedSnapshot?.metadata?.contentComparisons ?? [];
        const hasContent = (originalComparisons.length > 0 || migratedComparisons.length > 0);

        const TABS: { key: CompareTab; label: string }[] = [
          { key: 'diff',      label: '⚡ Differences' },
          { key: 'checklist', label: '✓ Checklist' },
          { key: 'linkmap',   label: '🔗 Link Map' },
          { key: 'links',     label: 'Links' },
          { key: 'images',    label: 'Images' },
          { key: 'contact',   label: 'Contact' },
          ...(hasContent ? [{ key: 'content' as CompareTab, label: '📊 Content Fidelity' }] : []),
        ];

        return (
          <>
            {/* Tab bar */}
            <div className="flex gap-2 mb-6 border-b border-[var(--border)] pb-3 flex-wrap">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setCompareTab(t.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                    compareTab === t.key ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Diff tab — verdict-filtered DiffTable */}
            {compareTab === 'diff' && comp.diff && (() => {
              const { summary, pages, items } = comp.diff;

              // Compute verdict counts — for old comparisons without verdict field,
              // fall back to severity-based inference
              const getV = (i: { verdict?: string; changeType: string; severity: string }) => {
                if (i.verdict) return i.verdict;
                if (i.changeType === 'expected-change') return 'expected';
                if (i.changeType === 'new-in-migrated' || i.changeType === 'content-changed') return 'info';
                return (i.severity === 'critical' || i.severity === 'major') ? 'bug' : 'info';
              };
              const bugCount      = (summary.bugs != null) ? summary.bugs : items.filter((i: { verdict?: string; changeType: string; severity: string }) => getV(i) === 'bug').length;
              const infoCount     = items.filter((i: { verdict?: string; changeType: string; severity: string }) => getV(i) === 'info').length;
              const expectedCount = items.filter((i: { verdict?: string; changeType: string; severity: string }) => getV(i) === 'expected').length;

              const FILTERS: { key: VerdictFilter; label: string; count: number; accent: string }[] = [
                { key: 'bugs',       label: '🐛 Bugs',          count: bugCount,      accent: 'red' },
                { key: 'all-issues', label: '🔍 Info / Watch',   count: infoCount,     accent: 'yellow' },
                { key: 'expected',   label: '✓ Expected',       count: expectedCount, accent: 'slate' },
                { key: 'all',        label: '📋 All',           count: items.length,  accent: 'blue' },
              ];

              return (
                <>
                  {/* Summary bar */}
                  <div className="mb-6 space-y-3">

                    {/* ── Stat cards ── */}
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { count: bugCount,                 label: 'Real Bugs',   color: 'text-red-400',    bg: 'bg-red-500/8',    border: 'border-red-500/25' },
                        { count: infoCount,                label: 'Info / Watch', color: 'text-yellow-400', bg: 'bg-yellow-500/8', border: 'border-yellow-500/25' },
                        { count: expectedCount,            label: 'Expected',    color: 'text-slate-400',  bg: 'bg-slate-500/8',  border: 'border-slate-500/20' },
                        { count: items.length,             label: 'Total Items', color: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface)]', border: 'border-[var(--border)]' },
                      ].map(({ count, label, color, bg, border }) => (
                        <div key={label} className={`${bg} border ${border} rounded-xl p-4 text-center`}>
                          <div className={`text-3xl font-bold ${color}`}>{count}</div>
                          <div className="text-xs text-[var(--text-muted)] mt-1 font-medium">{label}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── Legend ── */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-5 py-3 flex flex-col gap-2">
                      {[
                        {
                          icon: '🐛',
                          label: 'Bug',
                          labelColor: 'text-red-400',
                          badgeBg: 'bg-red-500/15 border-red-500/30',
                          desc: 'Genuine regressions — contact info mismatch, missing nav items, redirect-risk URL path changes',
                        },
                        {
                          icon: 'ℹ',
                          label: 'Info / Watch',
                          labelColor: 'text-yellow-400',
                          badgeBg: 'bg-yellow-500/15 border-yellow-500/30',
                          desc: 'Notable but non-critical — content edits, new template sections, minor styling changes',
                        },
                        {
                          icon: '✓',
                          label: 'Expected',
                          labelColor: 'text-slate-400',
                          badgeBg: 'bg-slate-500/15 border-slate-500/20',
                          desc: 'Normal migration artifacts — domain swap, Wix template links added, HTML structure change',
                        },
                      ].map(({ icon, label, labelColor, badgeBg, desc }) => (
                        <div key={label} className="flex items-start gap-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold whitespace-nowrap ${labelColor} ${badgeBg}`}>
                            {icon} {label}
                          </span>
                          <span className="text-xs text-[var(--text-muted)] leading-relaxed pt-0.5">{desc}</span>
                        </div>
                      ))}
                    </div>

                  </div>

                  {/* Verdict filter tabs */}
                  <div className="flex gap-2 mb-6 flex-wrap items-center">
                    {FILTERS.map(({ key, label, count, accent }) => (
                      <button key={key} onClick={() => setVerdictFilter(key)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition border ${
                          verdictFilter === key
                            ? accent === 'red'    ? 'bg-red-500/20 border-red-500/50 text-red-300'
                            : accent === 'yellow' ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300'
                            : accent === 'slate'  ? 'bg-slate-500/20 border-slate-500/50 text-slate-300'
                            : 'bg-[var(--blue)] border-[var(--blue)] text-white'
                            : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)]'
                        }`}>
                        {label} ({count})
                      </button>
                    ))}
                    <div className="ml-auto">
                      <button onClick={() => exportComparisonCsv(comp.original_domain, comp.migrated_domain, summary, pages, verdictFilter)}
                        className="px-4 py-1.5 text-sm font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--blue)] transition flex items-center gap-2">
                        ↓ Export CSV
                      </button>
                    </div>
                  </div>

                  {pages.length === 0 ? (
                    <div className="text-center py-12 text-green-400 bg-[var(--surface)] border border-[var(--border)] rounded-xl">✓ No differences found — sites are consistent.</div>
                  ) : bugCount === 0 && verdictFilter === 'bugs' ? (
                    <div className="text-center py-12 text-green-400 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
                      <div className="text-4xl mb-3">🎉</div>
                      <div className="text-lg font-semibold">No bugs found!</div>
                      <div className="text-sm text-[var(--text-muted)] mt-1">
                        {infoCount > 0 ? `${infoCount} informational items — switch to "Info / Watch" to review.` : 'All checks passed.'}
                      </div>
                    </div>
                  ) : (
                    <DiffTable pages={pages} verdictFilter={verdictFilter} />
                  )}
                </>
              );
            })()}

            {/* Page-aligned side-by-side tabs — pages matched by path */}
            {compareTab === 'checklist' && (
              <PairedSideBySide
                originalSnapshot={originalSnapshot}
                migratedSnapshot={migratedSnapshot}
                originalDomain={comp.original_domain}
                migratedDomain={comp.migrated_domain}
                renderPage={(snap) => <ChecklistTab snapshot={snap} results={[]} />}
              />
            )}
            {compareTab === 'linkmap' && (
              <PairedSideBySide
                originalSnapshot={originalSnapshot}
                migratedSnapshot={migratedSnapshot}
                originalDomain={comp.original_domain}
                migratedDomain={comp.migrated_domain}
                renderPage={(snap) => <LinkMapTab snapshot={snap} />}
              />
            )}
            {compareTab === 'links' && (
              <PairedSideBySide
                originalSnapshot={originalSnapshot}
                migratedSnapshot={migratedSnapshot}
                originalDomain={comp.original_domain}
                migratedDomain={comp.migrated_domain}
                renderPage={(snap) => <LinksTab snapshot={snap} />}
              />
            )}
            {compareTab === 'images' && (
              <PairedSideBySide
                originalSnapshot={originalSnapshot}
                migratedSnapshot={migratedSnapshot}
                originalDomain={comp.original_domain}
                migratedDomain={comp.migrated_domain}
                renderPage={(snap) => <ImagesTab snapshot={snap} />}
              />
            )}
            {compareTab === 'contact' && (
              <PairedSideBySide
                originalSnapshot={originalSnapshot}
                migratedSnapshot={migratedSnapshot}
                originalDomain={comp.original_domain}
                migratedDomain={comp.migrated_domain}
                renderPage={(snap) => <ContactTab snapshot={snap} />}
              />
            )}
            {/* Content Fidelity — flat list, not page-aligned per snapshot */}
            {compareTab === 'content' && (
              <SideBySide originalDomain={comp.original_domain} migratedDomain={comp.migrated_domain}>
                {[<ContentFidelityTab comparisons={originalComparisons} />, <ContentFidelityTab comparisons={migratedComparisons} />]}
              </SideBySide>
            )}
          </>
        );
      })()}
    </div>
  );
}

export function ComparePage() {
  const { id } = useParams<{ id: string }>();
  const [prefill, setPrefill] = useState<RerunPrefill | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const handleRerun = (p: RerunPrefill) => {
    setPrefill(p);
    // Scroll smoothly to the form so the user sees it populate
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  if (id) return <ComparisonDetail id={id} />;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Cross-Site Comparison</h1>
      <p className="text-[var(--text-muted)] mb-8">Compare an original Broadridge site against its migrated version.</p>
      <CompareForm prefill={prefill} formRef={formRef} />
      <h2 className="text-lg font-semibold mb-4">Comparison History</h2>
      <ComparisonsList onRerun={handleRerun} />
    </div>
  );
}
