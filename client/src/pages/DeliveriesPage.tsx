import { useState, useEffect, useCallback } from 'react';
import {
  listDeliveries,
  listSites,
  getSiteHistory,
  diffVersions,
  uploadDelivery,
  updateDeliveryLabel,
  type DeliveryListItem,
  type DeliveryStats,
  type SiteSummary,
  type SiteVersionMeta,
  type DiffResult,
} from '../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function Badge({ label, color }: { label: string; color: string }) {
  const map: Record<string, string> = {
    green:  'bg-green-100 text-green-800',
    red:    'bg-red-100 text-red-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    blue:   'bg-blue-100 text-blue-800',
    gray:   'bg-gray-100 text-gray-600',
    purple: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[color] ?? map.gray}`}>
      {label}
    </span>
  );
}

function statusBadge(status: string) {
  if (status === 'done')       return <Badge label="✓ pass"      color="green"  />;
  if (status === 'failed')     return <Badge label="failed"     color="red"    />;
  if (status === 'processing') return <Badge label="processing" color="yellow" />;
  return <Badge label={status} color="gray" />;
}

function pct(n: number, total: number) {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

// ── Stats Panel ───────────────────────────────────────────────────────────────

function StatBar({ label, value, total, color = 'blue' }: {
  label: string; value: number; total: number; color?: string;
}) {
  const pctNum = total ? Math.round((value / total) * 100) : 0;
  const barColor: Record<string, string> = {
    blue:   'bg-blue-500',
    green:  'bg-green-500',
    orange: 'bg-orange-400',
    purple: 'bg-purple-500',
    gray:   'bg-gray-400',
  };
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-44 text-[var(--text-muted)] truncate shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor[color] ?? barColor.blue} rounded-full transition-all`}
          style={{ width: `${pctNum}%` }}
        />
      </div>
      <span className="w-20 text-right font-semibold text-xs">
        {value} <span className="text-[var(--text-muted)] font-normal">({pct(value, total)})</span>
      </span>
    </div>
  );
}

function StatsPanel({ stats, filename, label }: { stats: DeliveryStats; filename: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const t = stats.total;

  const phases = Object.entries(stats.by_phase).sort(([a], [b]) => a.localeCompare(b));
  const waves  = Object.entries(stats.by_wave).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 bg-[var(--surface)] hover:bg-gray-50 text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-medium text-sm">{filename}</span>
          {label && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--blue)]/20 text-[var(--blue)] font-medium border border-[var(--blue)]/30">
              {label}
            </span>
          )}
          <span className="text-xs text-[var(--text-muted)]">{t} sites</span>
          {/* Show individual badges for small sets, summary for large */}
          {phases.length <= 3
            ? phases.map(([p, c]) => <Badge key={p} label={`Ph${p}: ${c}`} color="blue" />)
            : <Badge label={`${phases.length} phases`} color="blue" />
          }
          {waves.length <= 4
            ? waves.map(([w, c]) => <Badge key={w} label={`W${w}: ${c}`} color="purple" />)
            : <Badge label={`${waves.length} waves`} color="purple" />
          }
          <Badge label={`${stats.live} live`} color="green" />
          {stats.under_construction > 0 && (
            <Badge label={`${stats.under_construction} in construction`} color="yellow" />
          )}
        </div>
        <span className="text-[var(--text-muted)] text-lg">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-5 py-4 grid grid-cols-2 gap-x-10 gap-y-3 border-t border-[var(--border)]">
          {/* Left column */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Content</p>
            <StatBar label="SEO data"          value={stats.with_seo}          total={t} color="blue"   />
            <StatBar label="Custom pages"      value={stats.with_custom_pages} total={t} color="blue"   />
            <StatBar label="Tax library"       value={stats.with_tax_library}  total={t} color="blue"   />
            <StatBar label="Has blog"          value={stats.with_blog}         total={t} color="orange" />
            <StatBar label="Aria labels"       value={stats.with_aria_labels}  total={t} color="purple" />
          </div>
          {/* Right column */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Config</p>
            <StatBar label="Broker check ON"   value={stats.with_broker_check_on} total={t} color="green"  />
            <StatBar label="Google Tag Manager" value={stats.with_gtm}            total={t} color="green"  />
            <StatBar label="Bing auth"          value={stats.with_bing}           total={t} color="gray"   />
            <StatBar label="Live"               value={stats.live}                total={t} color="green"  />
            <StatBar label="Under construction" value={stats.under_construction}  total={t} color="orange" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upload Zone ───────────────────────────────────────────────────────────────

function UploadZone({ onUploaded }: { onUploaded: () => void }) {
  const [dragging,   setDragging]   = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [label,      setLabel]      = useState('');
  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.zip')) { setError('Please upload a .zip file'); return; }
    setUploading(true); setError(null); setLastResult(null);
    try {
      const result = await uploadDelivery(file, label.trim());
      setLastResult(
        `✓ Imported ${result.sites_imported} sites from ${file.name} (delivery ${fmtDate(result.delivery_date)})`
      );
      setLabel('');
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [onUploaded, label]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="mb-8">
      {/* Hidden file input — triggered natively via the label's htmlFor */}
      <input id="delivery-file-input" type="file" accept=".zip" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
      <label
        htmlFor={uploading ? undefined : 'delivery-file-input'}
        className={`block border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
          uploading ? 'cursor-default opacity-60' : 'cursor-pointer'
        } ${
          dragging
            ? 'border-[var(--blue)] bg-blue-50'
            : 'border-[var(--border)] hover:border-[var(--blue)] hover:bg-[var(--surface)]'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); onDrop(e); }}
      >
        {uploading ? (
          <p className="text-[var(--text-muted)] animate-pulse">Extracting zip and importing sites…</p>
        ) : (
          <>
            <p className="text-4xl mb-3">📦</p>
            <p className="font-semibold text-[var(--text)]">Drop a Broadridge delivery zip here</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Accepts delivery zips (202603162029-1-1.zip) or bundle zips (JSON.zip) containing multiple deliveries
            </p>
          </>
        )}
      </label>
      {/* Label input — below drop zone */}
      <div className="mt-3 flex items-center gap-2">
        <label className="text-sm text-[var(--text-muted)] shrink-0">Batch label <span className="text-xs">(optional)</span></label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder='e.g. "Wave 0 – March batch"'
          disabled={uploading}
          className="flex-1 border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--blue)] disabled:opacity-50"
        />
      </div>
      {lastResult && (
        <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">{lastResult}</p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">✗ {error}</p>
      )}
    </div>
  );
}

// ── Delivery History + Stats ──────────────────────────────────────────────────

function LabelCell({ delivery, onSaved }: { delivery: DeliveryListItem; onSaved: (id: string, label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value,   setValue]   = useState(delivery.label ?? '');
  const [saving,  setSaving]  = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateDeliveryLabel(delivery.id, value.trim());
      onSaved(delivery.id, value.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="border border-[var(--blue)] rounded px-2 py-0.5 text-xs bg-transparent w-44 focus:outline-none"
        />
        <button onClick={save} disabled={saving}
          className="text-xs px-2 py-0.5 rounded bg-[var(--blue)] text-white disabled:opacity-50">
          {saving ? '…' : '✓'}
        </button>
        <button onClick={() => { setEditing(false); setValue(delivery.label ?? ''); }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group">
      {value
        ? <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--blue)]/20 text-[var(--blue)] font-medium border border-[var(--blue)]/30">{value}</span>
        : <span className="text-xs text-[var(--text-muted)] italic">no label</span>
      }
      <button onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text)] text-xs transition-opacity"
        title="Edit label">
        ✏︎
      </button>
    </div>
  );
}

function DeliveryHistory({ deliveries, onLabelSaved }: {
  deliveries: DeliveryListItem[];
  onLabelSaved: (id: string, label: string) => void;
}) {
  if (deliveries.length === 0) return null;
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold mb-3">Delivery History</h2>
      <div className="rounded-xl border border-[var(--border)] overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--surface)] text-[var(--text-muted)] text-left">
              <th className="px-4 py-2 font-medium">File</th>
              <th className="px-4 py-2 font-medium">Label</th>
              <th className="px-4 py-2 font-medium">Delivery Date</th>
              <th className="px-4 py-2 font-medium">Uploaded</th>
              <th className="px-4 py-2 font-medium">Sites</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {deliveries.map((d) => (
              <tr key={d.id} className="hover:bg-[var(--surface)]">
                <td className="px-4 py-2 font-mono text-xs text-[var(--text-muted)]">{d.filename}</td>
                <td className="px-4 py-2">
                  <LabelCell delivery={d} onSaved={onLabelSaved} />
                </td>
                <td className="px-4 py-2">{fmtDate(d.delivery_date)}</td>
                <td className="px-4 py-2 text-[var(--text-muted)]">{fmtDate(d.uploaded_at)}</td>
                <td className="px-4 py-2 font-semibold">{d.site_count}</td>
                <td className="px-4 py-2">
                  {statusBadge(d.status)}
                  {d.error && <span className="ml-2 text-xs text-red-500">{d.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stats panels — one per delivery that has stats */}
      {deliveries.some((d) => d.stats) && (
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
            Delivery Stats (click to expand)
          </h3>
          <div className="space-y-2">
            {deliveries
              .filter((d) => d.stats && d.status === 'done')
              .map((d) => (
                <StatsPanel key={d.id} stats={d.stats as DeliveryStats} filename={d.filename} label={d.label} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Diff Viewer ───────────────────────────────────────────────────────────────

function DiffViewer({ diff, onClose }: { diff: DiffResult; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | 'added' | 'removed' | 'changed'>('all');
  const filtered = diff.changes.filter((c) => filter === 'all' || c.type === filter);
  const counts = {
    added:   diff.changes.filter((c) => c.type === 'added').length,
    removed: diff.changes.filter((c) => c.type === 'removed').length,
    changed: diff.changes.filter((c) => c.type === 'changed').length,
  };
  const typeStyle = (t: string) =>
    t === 'added'   ? 'text-green-700 bg-green-50' :
    t === 'removed' ? 'text-red-700 bg-red-50' :
                      'text-yellow-800 bg-yellow-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-[900px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-bold text-lg">{diff.domain}</h3>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {fmtDate(diff.v1.delivery_date)} → {fmtDate(diff.v2.delivery_date)}
              &nbsp;·&nbsp; <span className="font-semibold text-[var(--text)]">{diff.change_count} changes</span>
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-2xl">&times;</button>
        </div>

        <div className="flex gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
          {(['all', 'added', 'removed', 'changed'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
                filter === f ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:bg-white'
              }`}>
              {f === 'all' ? `All (${diff.change_count})` : `${f} (${counts[f] ?? 0})`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {filtered.length === 0 && (
            <p className="text-center text-[var(--text-muted)] py-8">No changes of this type</p>
          )}
          {filtered.map((c, i) => (
            <div key={i} className={`rounded-lg p-3 text-xs font-mono ${typeStyle(c.type)}`}>
              <div className="flex items-start gap-2">
                <span className="font-bold uppercase text-[10px] mt-0.5 w-14 shrink-0">{c.type}</span>
                <span className="font-semibold break-all">{c.path}</span>
              </div>
              {c.type === 'changed' && (
                <div className="mt-2 space-y-1 ml-16">
                  <div className="text-red-700 line-through break-all">
                    {typeof c.was === 'object' ? JSON.stringify(c.was).slice(0, 200) : String(c.was ?? '')}
                  </div>
                  <div className="text-green-700 break-all">
                    {typeof c.now === 'object' ? JSON.stringify(c.now).slice(0, 200) : String(c.now ?? '')}
                  </div>
                </div>
              )}
              {c.type === 'added' && (
                <div className="mt-1 ml-16 text-green-700 break-all">
                  {typeof c.now === 'object' ? JSON.stringify(c.now).slice(0, 200) : String(c.now ?? '')}
                </div>
              )}
              {c.type === 'removed' && (
                <div className="mt-1 ml-16 text-red-700 line-through break-all">
                  {typeof c.was === 'object' ? JSON.stringify(c.was).slice(0, 200) : String(c.was ?? '')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// (SiteHistoryModal removed — version history is now inline in SiteRegistry)

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportCsv(sites: SiteSummary[]) {
  const rows = [
    ['Domain', 'Phase', 'Wave', 'Latest Delivery', 'Version Count'],
    ...sites.map((s) => [
      s.domain,
      s.phase ?? '',
      s.wave ?? '',
      s.latest_date,
      s.version_count,
    ]),
  ];
  const csv = rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `broadridge-sites-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Site Registry ─────────────────────────────────────────────────────────────

function SiteRegistry({ sites }: { sites: SiteSummary[] }) {
  const [search,       setSearch]       = useState('');
  const [phaseFilter,  setPhaseFilter]  = useState('all');
  const [waveFilter,   setWaveFilter]   = useState('all');
  const [multiOnly,    setMultiOnly]    = useState(false);

  // Inline tree state
  const [expanded,       setExpanded]       = useState<Set<string>>(new Set());
  const [versionCache,   setVersionCache]   = useState<Map<string, SiteVersionMeta[]>>(new Map());
  const [loadingDomains, setLoadingDomains] = useState<Set<string>>(new Set());
  const [selectedIds,    setSelectedIds]    = useState<string[]>([]);   // up to 2 version IDs for diff
  const [diff,           setDiff]           = useState<DiffResult | null>(null);
  const [diffLoading,    setDiffLoading]    = useState(false);

  const toggleExpand = async (domain: string) => {
    const next = new Set(expanded);
    if (next.has(domain)) {
      next.delete(domain);
      setExpanded(next);
      return;
    }
    next.add(domain);
    setExpanded(next);
    if (!versionCache.has(domain)) {
      setLoadingDomains((prev) => new Set(prev).add(domain));
      try {
        const versions = await getSiteHistory(domain);
        setVersionCache((prev) => new Map(prev).set(domain, versions));
      } finally {
        setLoadingDomains((prev) => { const s = new Set(prev); s.delete(domain); return s; });
      }
    }
  };

  const toggleVersion = (id: string, domain: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Only allow selecting from same domain — clear if switching domain
      const allVersions = Array.from(versionCache.values()).flat();
      const existingDomain = prev.length > 0
        ? allVersions.find((v) => v.id === prev[0])?.domain
        : null;
      if (existingDomain && existingDomain !== domain) return [id];
      return prev.length < 2 ? [...prev, id] : [prev[1], id];
    });
  };

  const runDiff = async () => {
    if (selectedIds.length !== 2) return;
    setDiffLoading(true);
    try {
      const allVersions = Array.from(versionCache.values()).flat();
      const v1 = allVersions.find((v) => v.id === selectedIds[0])!;
      const v2 = allVersions.find((v) => v.id === selectedIds[1])!;
      const older = v1.delivery_date <= v2.delivery_date ? v1.id : v2.id;
      const newer = v1.delivery_date <= v2.delivery_date ? v2.id : v1.id;
      setDiff(await diffVersions(older, newer));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Diff failed');
    } finally {
      setDiffLoading(false);
    }
  };

  // Unique phase/wave values for dropdowns
  const phases = [...new Set(sites.map((s) => s.phase).filter((p) => p !== null))].sort() as number[];
  const waves  = [...new Set(sites.map((s) => s.wave).filter((w) => w !== null))].sort()  as number[];

  const filtered = sites.filter((s) => {
    if (search      && !s.domain.toLowerCase().includes(search.toLowerCase())) return false;
    if (phaseFilter !== 'all' && String(s.phase) !== phaseFilter) return false;
    if (waveFilter  !== 'all' && String(s.wave)  !== waveFilter)  return false;
    if (multiOnly   && s.version_count < 2) return false;
    return true;
  });

  const multiCount = sites.filter((s) => s.version_count > 1).length;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h2 className="text-lg font-semibold">
          Site Registry
          <span className="text-[var(--text-muted)] font-normal text-sm ml-2">
            ({filtered.length} of {sites.length})
          </span>
        </h2>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Search */}
          <input type="text" placeholder="Search domain…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-[var(--blue)]" />

          {/* Phase filter */}
          {phases.length > 0 && (
            <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}
              className="border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]">
              <option value="all">All phases</option>
              {phases.map((p) => <option key={p} value={String(p)}>Phase {p}</option>)}
            </select>
          )}

          {/* Wave filter */}
          {waves.length > 0 && (
            <select value={waveFilter} onChange={(e) => setWaveFilter(e.target.value)}
              className="border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]">
              <option value="all">All waves</option>
              {waves.map((w) => <option key={w} value={String(w)}>Wave {w}</option>)}
            </select>
          )}

          {/* Multi-version toggle */}
          {multiCount > 0 && (
            <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none" title="Show only sites that appear in 2+ delivery batches — these can be compared across versions">
              <input type="checkbox" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)}
                className="rounded" />
              <span>🔄 Re-delivered sites ({multiCount})</span>
            </label>
          )}

          {/* CSV Export */}
          <button
            onClick={() => exportCsv(filtered)}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--surface)] flex items-center gap-1.5 font-medium"
            title="Export filtered list as CSV"
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* Compare bar — appears when 2 versions are selected */}
      {selectedIds.length === 2 && (
        <div className="mb-3 flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--blue)] text-white text-sm font-medium shadow-lg">
          <span>2 versions selected — ready to compare</span>
          <div className="flex gap-2">
            <button onClick={() => setSelectedIds([])}
              className="px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-xs">
              Clear
            </button>
            <button onClick={runDiff} disabled={diffLoading}
              className="px-3 py-1 rounded-lg bg-white text-[var(--blue)] font-bold hover:bg-blue-50 text-xs disabled:opacity-60">
              {diffLoading ? 'Comparing…' : 'Compare →'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--surface)] text-[var(--text-muted)] text-left">
              <th className="px-4 py-2 font-medium w-6"></th>
              <th className="px-4 py-2 font-medium">Domain</th>
              <th className="px-4 py-2 font-medium">Phase</th>
              <th className="px-4 py-2 font-medium">Wave</th>
              <th className="px-4 py-2 font-medium">Latest Delivery</th>
              <th className="px-4 py-2 font-medium">Deliveries</th>
            </tr>
          </thead>
          <tbody>
            {filtered.flatMap((s) => {
              const isOpen     = expanded.has(s.domain);
              const isLoading  = loadingDomains.has(s.domain);
              const versions   = versionCache.get(s.domain) ?? [];

              const mainRow = (
                <tr
                  key={s.domain}
                  className={`border-t border-[var(--border)] cursor-pointer hover:bg-[var(--surface)] transition-colors ${isOpen ? 'bg-[var(--surface)]' : ''}`}
                  onClick={() => toggleExpand(s.domain)}
                >
                  <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs select-none">
                    {isOpen ? '▼' : '▶'}
                  </td>
                  <td className="px-2 py-2.5 font-medium">{s.domain}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{s.phase ?? '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{s.wave ?? '—'}</td>
                  <td className="px-4 py-2.5">{fmtDate(s.latest_date)}</td>
                  <td className="px-4 py-2.5">
                    {s.version_count === 1
                      ? <Badge label="1 delivery" color="gray" />
                      : <Badge label={`${s.version_count} deliveries`} color="blue" />}
                  </td>
                </tr>
              );

              if (!isOpen) return [mainRow];

              // Loading row
              if (isLoading) {
                return [mainRow, (
                  <tr key={`${s.domain}-loading`} className="border-t border-[var(--border)]">
                    <td colSpan={6} className="pl-10 py-3 text-xs text-[var(--text-muted)] animate-pulse">
                      Loading versions…
                    </td>
                  </tr>
                )];
              }

              // Version rows
              const canCompare = versions.length > 1;

              const versionRows = versions.map((v, idx) => {
                const isLatest   = v.is_latest === 1;
                const isSelected = selectedIds.includes(v.id);
                const isFirst    = idx === 0;
                const isLast     = idx === versions.length - 1;

                return (
                  <tr
                    key={v.id}
                    className={`border-t border-[var(--border)] transition-colors ${
                      canCompare
                        ? isSelected
                          ? 'bg-blue-900/40 cursor-pointer'
                          : 'bg-[var(--surface)]/60 hover:bg-[var(--surface)] cursor-pointer'
                        : 'bg-[var(--surface)]/40'
                    }`}
                    onClick={(e) => { if (canCompare) { e.stopPropagation(); toggleVersion(v.id, s.domain); } }}
                  >
                    {/* Tree connector */}
                    <td className="px-3 py-2 text-[var(--text-muted)] select-none w-6">
                      <span className="text-[10px]">{isLast ? '└' : '├'}</span>
                    </td>

                    {/* Checkbox (only when comparable) + date + badges */}
                    <td className="py-2 pl-4 pr-2">
                      <div className="flex items-center gap-2.5">
                        {canCompare && (
                          <input
                            type="checkbox"
                            readOnly
                            checked={isSelected}
                            className="rounded accent-[var(--blue)] shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        <span className={`text-xs ${isLatest ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                          {fmtDate(v.delivery_date)}
                        </span>
                        {isLatest && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-green-500/20 text-green-400 border border-green-500/30">
                            ✓ CURRENT
                          </span>
                        )}
                        {canCompare && isFirst && !isLatest && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]">
                            newest
                          </span>
                        )}
                        {canCompare && isLast && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]">
                            oldest
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-2 px-4 text-xs text-[var(--text-muted)]">{v.phase ?? '—'}</td>
                    <td className="py-2 px-4 text-xs text-[var(--text-muted)]">{v.wave ?? '—'}</td>
                    <td className="py-2 px-4 text-xs text-[var(--text-muted)]">—</td>
                    <td className="py-2 px-4"></td>
                  </tr>
                );
              });

              // For single-version sites, append an explanatory row
              const noCompareNote = !canCompare ? [(
                <tr key={`${s.domain}-note`} className="border-t border-[var(--border)]">
                  <td colSpan={6} className="pl-10 py-2.5 text-xs text-[var(--text-muted)]">
                    <span className="font-medium text-amber-400">⚠ First delivery only</span>
                    {' — '}This site has only been included in one delivery batch so far. To compare changes between deliveries, it needs to appear in at least 2 batches. Use the{' '}
                    <button
                      className="underline hover:text-[var(--text)] text-[var(--blue)]"
                      onClick={(e) => { e.stopPropagation(); setMultiOnly(true); }}
                    >
                      🔄 Re-delivered sites ({multiCount})
                    </button>
                    {' '}filter to find sites that can be compared.
                  </td>
                </tr>
              )] : [];

              return [mainRow, ...versionRows, ...noCompareNote];
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-[var(--text-muted)] py-8">No sites match the current filters</p>
        )}
      </div>

      {diff && <DiffViewer diff={diff} onClose={() => setDiff(null)} />}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<DeliveryListItem[]>([]);
  const [sites,      setSites]      = useState<SiteSummary[]>([]);
  const [loading,    setLoading]    = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [d, s] = await Promise.all([listDeliveries(), listSites()]);
    setDeliveries(d);
    setSites(s);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const isEmpty = !loading && sites.length === 0 && deliveries.length === 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Broadridge Deliveries</h1>
      <p className="text-[var(--text-muted)] mb-8">
        Upload Broadridge zip deliveries · track versions per site · compare drops · filter by phase &amp; wave
      </p>

      <UploadZone onUploaded={refresh} />
      <DeliveryHistory
        deliveries={deliveries}
        onLabelSaved={(id, label) =>
          setDeliveries((prev) => prev.map((d) => d.id === id ? { ...d, label } : d))
        }
      />

      {sites.length > 0 && (
        <SiteRegistry sites={sites} />
      )}

      {loading && sites.length === 0 && (
        <p className="text-center text-[var(--text-muted)] py-16 animate-pulse">Loading…</p>
      )}

      {isEmpty && (
        <div className="text-center py-16 text-[var(--text-muted)]">
          <p className="text-4xl mb-4">📭</p>
          <p className="font-semibold">No deliveries yet</p>
          <p className="text-sm mt-1">Upload a Broadridge zip file above to get started</p>
        </div>
      )}

    </div>
  );
}
