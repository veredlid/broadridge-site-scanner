import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { listScans, deleteScan, compareFromScans, subscribeScanProgress, type ScanListItem } from '../api/client';
import { StatusBadge } from './SeverityBadge';
import { Tooltip } from './Tooltip';

/** Live progress strip shown beneath a running scan row */
function ScanProgressStrip({ scan, colSpan }: { scan: ScanListItem; colSpan: number }) {
  const [lines, setLines] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scan.status !== 'running' && scan.status !== 'queued') return;

    const unsub = subscribeScanProgress(
      scan.id,
      (data) => {
        const msg = (data.message as string) ?? '';
        if (msg) setLines((prev) => [...prev.slice(-29), msg]); // keep last 30 lines
      },
      () => {
        // Scan finished — refresh the table to show updated status
        queryClient.invalidateQueries({ queryKey: ['scans'] });
      }
    );

    return unsub;
  }, [scan.id, scan.status, queryClient]);

  // Auto-scroll log to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <tr className="bg-[var(--bg)] border-b border-[var(--border)]">
      <td colSpan={colSpan} className="px-6 pb-3 pt-1">
        <div className="max-h-28 overflow-y-auto font-mono text-[11px] text-[var(--text-muted)] space-y-0.5 pr-1">
          {lines.map((line, i) => (
            <div key={i} className={i === lines.length - 1 ? 'text-[var(--text)]' : ''}>
              {line}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </td>
    </tr>
  );
}

export function ScanTable() {
  const { data: scans = [], isLoading } = useQuery({ queryKey: ['scans'], queryFn: listScans });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comparing, setComparing] = useState(false);

  const handleDelete = async (id: string) => {
    await deleteScan(id);
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    queryClient.invalidateQueries({ queryKey: ['scans'] });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      return next;
    });
  };

  const handleCompareSelected = async () => {
    const [id1, id2] = [...selected];
    setComparing(true);
    try {
      await compareFromScans({ originalScanId: id1, migratedScanId: id2 });
      queryClient.invalidateQueries({ queryKey: ['comparisons'] });
      navigate('/comparisons');
    } finally {
      setComparing(false);
      setSelected(new Set());
    }
  };

  if (isLoading) {
    return <div className="text-[var(--text-muted)] text-center py-12">Loading scans...</div>;
  }

  if (scans.length === 0) {
    return (
      <div className="text-[var(--text-muted)] text-center py-12 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
        No scans yet. Run your first scan above.
      </div>
    );
  }

  return (
    <div>
      {selected.size === 2 && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-[var(--blue)]/10 border border-[var(--blue)]/30 rounded-xl">
          <span className="text-sm text-[var(--blue)]">2 scans selected for comparison</span>
          <button
            onClick={handleCompareSelected}
            disabled={comparing}
            className="px-4 py-1.5 text-sm bg-[var(--blue)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 transition"
          >
            {comparing ? 'Comparing...' : 'Compare Selected →'}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition"
          >
            Clear
          </button>
        </div>
      )}
      {selected.size === 1 && (
        <div className="mb-3 px-3 py-2 text-sm text-[var(--text-muted)]">
          Select one more completed scan to compare
        </div>
      )}
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-[var(--border)]">
            <th className="px-4 py-3 w-8"></th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">Domain</th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">Label</th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">Type</th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">Status</th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">Pages</th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">Issues</th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">Duration</th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">Date</th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-[var(--text-muted)]">Actions</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((scan: ScanListItem) => (
            <>
            <tr key={scan.id} className={`border-b border-[var(--border)] hover:bg-blue-500/5 transition ${selected.has(scan.id) ? 'bg-[var(--blue)]/5' : ''}`}>
              <td className="px-4 py-3">
                {scan.status === 'done' && (
                  <input
                    type="checkbox"
                    checked={selected.has(scan.id)}
                    onChange={() => toggleSelect(scan.id)}
                    disabled={selected.size === 2 && !selected.has(scan.id)}
                    className="accent-[var(--blue)] cursor-pointer"
                  />
                )}
              </td>
              <td className="px-4 py-3 font-medium max-w-[200px]">
                <Tooltip content={scan.domain}>
                  <span className="block truncate">{scan.domain}</span>
                </Tooltip>
              </td>
              <td className="px-4 py-3 max-w-[120px]">
                <Tooltip content={scan.label || null}>
                  <span className="block truncate text-[var(--text-muted)]">{scan.label}</span>
                </Tooltip>
              </td>
              <td className="px-4 py-3">
                {scan.site_type && (
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    scan.site_type === 'vanilla' ? 'bg-purple-500/15 text-purple-400' :
                    scan.site_type === 'deprecated' ? 'bg-orange-500/15 text-orange-400' :
                    'bg-blue-500/15 text-blue-400'
                  }`}>
                    {scan.site_type === 'vanilla' ? 'Vanilla Bean' :
                     scan.site_type === 'deprecated' ? 'Deprecated' : 'Flex'}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 max-w-[260px]">
                <StatusBadge status={scan.status} />
                {scan.status === 'failed' && scan.error && (
                  <Tooltip content={scan.error}>
                    <p className="text-xs text-red-400 mt-1 truncate">{scan.error}</p>
                  </Tooltip>
                )}
              </td>
              <td className="px-4 py-3">{scan.page_count || '—'}</td>
              <td className="px-4 py-3">
                {scan.status === 'done' ? (
                  scan.failed > 0
                    ? <span className="text-red-400 font-semibold">⚠ {scan.failed} issues</span>
                    : <span className="text-green-400">✓ Clean</span>
                ) : '—'}
              </td>
              <td className="px-4 py-3 text-[var(--text-muted)]">
                {scan.duration_ms ? `${(scan.duration_ms / 1000).toFixed(1)}s` : '—'}
              </td>
              <td className="px-4 py-3 text-[var(--text-muted)] text-sm">
                {new Date(scan.created_at).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex gap-2 justify-end">
                  {(scan.status === 'done' || scan.status === 'failed') && (
                    <Link
                      to={`/scans/${scan.id}`}
                      className={`px-3 py-1 text-xs rounded-lg transition ${
                        scan.status === 'failed'
                          ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                          : 'bg-[var(--blue)]/15 text-[var(--blue)] hover:bg-[var(--blue)]/25'
                      }`}
                    >
                      {scan.status === 'failed' ? 'View Error' : 'View'}
                    </Link>
                  )}
                  <button
                    onClick={() => handleDelete(scan.id)}
                    className="px-3 py-1 text-xs bg-red-500/15 text-red-400 rounded-lg hover:bg-red-500/25 transition"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
            {(scan.status === 'running' || scan.status === 'queued') && (
              <ScanProgressStrip key={`${scan.id}-progress`} scan={scan} colSpan={10} />
            )}
            </>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}
