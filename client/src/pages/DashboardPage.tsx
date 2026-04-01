import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard, type DashboardData, type DeliveryStats } from '../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtRelative(iso: string | null) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

// ── SVG Donut Chart ───────────────────────────────────────────────────────────

interface PieSlice { label: string; value: number; color: string }

function DonutChart({ slices, size = 120, centerLabel }: {
  slices: PieSlice[]; size?: number; centerLabel?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const ro = size / 2 - 4;   // outer radius (4px inset for shadow room)
  const ri = ro * 0.52;       // inner radius — ring thickness
  const gap = 0.018;          // radians of gap between slices

  let cursor = -Math.PI / 2;

  const paths = slices.map((slice) => {
    const angle   = (slice.value / total) * 2 * Math.PI;
    const a0      = cursor + gap / 2;
    const a1      = cursor + angle - gap / 2;
    cursor       += angle;

    const x1o = cx + ro * Math.cos(a0), y1o = cy + ro * Math.sin(a0);
    const x2o = cx + ro * Math.cos(a1), y2o = cy + ro * Math.sin(a1);
    const x1i = cx + ri * Math.cos(a1), y1i = cy + ri * Math.sin(a1);
    const x2i = cx + ri * Math.cos(a0), y2i = cy + ri * Math.sin(a0);
    const large = angle > Math.PI ? 1 : 0;

    const d = [
      `M ${x1o} ${y1o}`,
      `A ${ro} ${ro} 0 ${large} 1 ${x2o} ${y2o}`,
      `L ${x1i} ${y1i}`,
      `A ${ri} ${ri} 0 ${large} 0 ${x2i} ${y2i}`,
      'Z',
    ].join(' ');

    return { ...slice, d, pct: Math.round((slice.value / total) * 100) };
  });

  const filterId = `dshadow-${size}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} overflow="visible">
      <defs>
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000000" floodOpacity="0.35" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        {paths.map((p) => (
          <path key={p.label} d={p.d} fill={p.color} stroke="white" strokeWidth="1.5">
            <title>{p.label}: {p.value.toLocaleString()} ({p.pct}%)</title>
          </path>
        ))}
      </g>
      {centerLabel && (
        <text
          x={cx} y={cy + 1}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={size * 0.15} fontWeight="700" fill="#e2e8f0"
        >
          {centerLabel}
        </text>
      )}
    </svg>
  );
}

function PieLegend({ slices, total }: { slices: PieSlice[]; total: number }) {
  return (
    <div className="space-y-1.5">
      {slices.map((s) => (
        <div key={s.label} className="flex items-center gap-2 text-sm">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
          <span className="text-[var(--text-muted)] truncate flex-1">{s.label}</span>
          <span className="font-bold tabular-nums">{s.value.toLocaleString()}</span>
          <span className="text-[var(--text-muted)] text-xs w-8 text-right">{pct(s.value, total)}%</span>
        </div>
      ))}
    </div>
  );
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'done'       ? 'bg-green-500' :
    status === 'failed'     ? 'bg-red-500'   :
    status === 'running'    ? 'bg-blue-400 animate-pulse' :
                              'bg-gray-300';
  return <span className={`inline-block w-2 h-2 rounded-full ${color} shrink-0`} />;
}

function MiniBar({ value, total, color = 'blue' }: { value: number; total: number; color?: string }) {
  const p = pct(value, total);
  const bar: Record<string, string> = {
    blue:   'bg-blue-500',
    green:  'bg-green-500',
    red:    'bg-red-400',
    orange: 'bg-orange-400',
    purple: 'bg-purple-500',
    gray:   'bg-gray-300',
  };
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
        <div
          className={`h-full ${bar[color] ?? bar.blue} rounded-full transition-all`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className="text-xs font-bold text-[var(--text-muted)] w-8 text-right">{p}%</span>
    </div>
  );
}

// ── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon, title, href, children,
}: {
  icon: string; title: string; href: string; children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="rounded-2xl p-6 flex flex-col gap-4 transition-shadow hover:shadow-xl cursor-default"
      style={{ background: '#1e3a5f', boxShadow: '0 4px 24px rgba(59,130,246,0.15), 0 1px 6px rgba(0,0,0,0.3)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{icon}</span>
          <h2 className="font-extrabold text-[15px] tracking-tight">{title}</h2>
        </div>
        <button
          onClick={() => navigate(href)}
          className="text-xs text-[var(--blue)] font-bold hover:underline"
        >
          Open →
        </button>
      </div>
      {children}
    </div>
  );
}

function StatRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-medium text-[var(--text-muted)]">{label}</span>
      <span className="font-bold text-sm tabular-nums">
        {value}
        {sub && <span className="font-normal text-[var(--text-muted)] ml-1 text-xs">{sub}</span>}
      </span>
    </div>
  );
}

// ── Scans Card ────────────────────────────────────────────────────────────────

function ScansCard({ data }: { data: DashboardData['scans'] }) {
  const totalChecks = (data.total_passed ?? 0) + (data.total_failed_checks ?? 0);
  const passRate    = pct(data.total_passed ?? 0, totalChecks);

  return (
    <SummaryCard icon="🔍" title="Scans" href="/scans">
      <div className="space-y-2">
        <StatRow label="Total scans"  value={data.total} />
        <StatRow label="Completed"    value={data.done}  sub={data.total ? `${pct(data.done, data.total)}%` : undefined} />
        {data.failed  > 0 && <StatRow label="Failed"   value={<span className="text-red-600">{data.failed}</span>}  />}
        {data.running > 0 && <StatRow label="Running"  value={<span className="text-blue-500">{data.running}</span>} />}
        <StatRow label="Last activity" value={fmtRelative(data.last_activity)} />
      </div>

      {totalChecks > 0 && (
        <div className="border-t border-[var(--border)] pt-3 space-y-1.5">
          <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
            <span>Check pass rate</span>
            <span className="font-semibold text-[var(--text)]">{passRate}%</span>
          </div>
          <MiniBar value={data.total_passed ?? 0} total={totalChecks} color="green" />
          <div className="flex justify-between text-xs text-[var(--text-muted)]">
            <span>{(data.total_passed ?? 0).toLocaleString()} passed</span>
            <span>{(data.total_failed_checks ?? 0).toLocaleString()} failed</span>
          </div>
        </div>
      )}
    </SummaryCard>
  );
}

// ── Comparisons Card ──────────────────────────────────────────────────────────

function ComparisonsCard({ data }: { data: DashboardData['comparisons'] }) {
  return (
    <SummaryCard icon="⚖️" title="Comparisons" href="/comparisons">
      <div className="space-y-2">
        <StatRow label="Total"         value={data.total} />
        <StatRow label="Completed"     value={data.done} sub={data.total ? `${pct(data.done, data.total)}%` : undefined} />
        {data.failed  > 0 && <StatRow label="Failed"  value={<span className="text-red-600">{data.failed}</span>}  />}
        {data.running > 0 && <StatRow label="Running" value={<span className="text-blue-500">{data.running}</span>} />}
        <StatRow label="Last activity" value={fmtRelative(data.last_activity)} />
      </div>

      {data.total === 0 && (
        <p className="text-xs text-[var(--text-muted)] italic">
          No comparisons yet — compare an original vs migrated site to see diffs here.
        </p>
      )}
    </SummaryCard>
  );
}

// ── Deliveries Card ───────────────────────────────────────────────────────────

const PHASE_COLORS = ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b'];
const WAVE_COLORS  = [
  '#818cf8','#60a5fa','#34d399','#fbbf24','#f87171',
  '#a78bfa','#38bdf8','#4ade80','#fb923c','#e879f9','#94a3b8',
];

function DeliveriesCard({ data }: { data: DashboardData['deliveries'] }) {
  const stats = data.latest_stats;

  const phaseSlices: PieSlice[] = stats
    ? Object.entries(stats.by_phase)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([p, c], i) => ({
          label: `Phase ${p}`,
          value: c as number,
          color: PHASE_COLORS[i % PHASE_COLORS.length],
        }))
    : [];

  const totalSites = data.total_sites ?? 0;

  return (
    <SummaryCard icon="📦" title="Deliveries" href="/deliveries">
      <div className="space-y-2">
        <StatRow label="Total uploads"  value={data.total_deliveries ?? 0} />
        <StatRow label="Sites tracked"  value={totalSites.toLocaleString()} />
        <StatRow label="Latest drop"    value={fmtDate(data.latest_delivery_date)} />
        {data.latest_filename && (
          <StatRow label="File" value={
            <span className="font-mono text-xs text-[var(--text-muted)] truncate max-w-[160px]">
              {data.latest_filename}
            </span>
          } />
        )}
      </div>

      {phaseSlices.length > 0 && (
        <div className="border-t border-[var(--border)] pt-3">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">
            Phase breakdown
          </p>
          <div className="flex items-center gap-5">
            <DonutChart slices={phaseSlices} size={90} centerLabel={`${phaseSlices.length}Ph`} />
            <PieLegend slices={phaseSlices} total={totalSites} />
          </div>
        </div>
      )}
    </SummaryCard>
  );
}

// ── Recent Activity ───────────────────────────────────────────────────────────

function RecentActivity({ items }: { items: DashboardData['recent'] }) {
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div className="rounded-2xl p-6" style={{ background: '#1e3a5f', boxShadow: '0 4px 24px rgba(59,130,246,0.15), 0 1px 6px rgba(0,0,0,0.3)' }}>
        <h2 className="font-extrabold text-[15px] tracking-tight mb-4">Recent Activity</h2>
        <p className="text-sm text-[var(--text-muted)] italic">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-6" style={{ background: '#1e3a5f', boxShadow: '0 4px 24px rgba(59,130,246,0.15), 0 1px 6px rgba(0,0,0,0.3)' }}>
      <h2 className="font-extrabold text-[15px] tracking-tight mb-4">Recent Activity</h2>
      <div className="divide-y divide-[var(--border)]">
        {items.map((item) => {
          const isScan = item.type === 'scan';
          const href   = isScan ? `/scans/${item.id}` : `/comparisons/${item.id}`;
          return (
            <div
              key={`${item.type}-${item.id}`}
              className="flex items-start gap-3 py-3 hover:bg-white/5 -mx-2 px-2 rounded-lg cursor-pointer transition-colors group"
              onClick={() => navigate(href)}
            >
              {/* Status dot */}
              <div className="mt-0.5 shrink-0">
                <StatusDot status={item.status} />
              </div>

              {/* Main content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Type badge — the key fix */}
                  <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-wide ${
                    isScan
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  }`}>
                    {isScan ? 'Scan' : 'Compare'}
                  </span>
                  <span className="font-semibold text-sm truncate group-hover:text-white transition-colors">
                    {item.title}
                  </span>
                </div>
                {item.meta && (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 ml-0.5">{item.meta}</p>
                )}
              </div>

              {/* Time + arrow */}
              <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-[var(--text-muted)]">
                  {fmtRelative(item.created_at)}
                </span>
                <span className="text-[var(--text-muted)] text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Delivery Feature Snapshot ─────────────────────────────────────────────────

function DeliverySnapshot({ stats, total }: { stats: DeliveryStats; total: number }) {
  const features: Array<{ label: string; value: number; color: string }> = [
    { label: 'Live sites',          value: stats.live,                  color: 'green'  },
    { label: 'Google Tag Manager',  value: stats.with_gtm,              color: 'blue'   },
    { label: 'Tax library',         value: stats.with_tax_library,      color: 'blue'   },
    { label: 'Custom pages',        value: stats.with_custom_pages,     color: 'blue'   },
    { label: 'Broker check ON',     value: stats.with_broker_check_on,  color: 'green'  },
    { label: 'SEO data',            value: stats.with_seo,              color: 'blue'   },
    { label: 'Aria labels',         value: stats.with_aria_labels,      color: 'purple' },
    { label: 'Blog',                value: stats.with_blog,             color: 'orange' },
    { label: 'Under construction',  value: stats.under_construction,    color: 'orange' },
  ];

  const waveSlices: PieSlice[] = Object.entries(stats.by_wave)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([w, c], i) => ({
      label: `Wave ${w}`,
      value: c as number,
      color: WAVE_COLORS[i % WAVE_COLORS.length],
    }));

  return (
    <div className="rounded-2xl p-6" style={{ background: '#1e3a5f', boxShadow: '0 4px 24px rgba(59,130,246,0.15), 0 1px 6px rgba(0,0,0,0.3)' }}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-extrabold text-[15px] tracking-tight">Site Fleet Snapshot</h2>
        <span className="text-xs text-[var(--text-muted)]">{total.toLocaleString()} sites · latest delivery</span>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-8">
        {/* Feature adoption bars */}
        <div className="space-y-3">
          {features.map((f) => (
            <div key={f.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-[var(--text-muted)]">{f.label}</span>
                <span className="font-semibold tabular-nums">
                  {f.value.toLocaleString()}
                  <span className="text-[var(--text-muted)] font-normal ml-1 text-xs">
                    ({pct(f.value, total)}%)
                  </span>
                </span>
              </div>
              <MiniBar value={f.value} total={total} color={f.color} />
            </div>
          ))}
        </div>

        {/* Wave pie */}
        {waveSlices.length > 0 && (
          <div className="flex flex-col items-center gap-3 min-w-[160px]">
            <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide self-start">
              Wave distribution
            </p>
            <DonutChart slices={waveSlices} size={110} centerLabel={`${waveSlices.length}W`} />
            <div className="space-y-1 w-full">
              {waveSlices.map((s) => (
                <div key={s.label} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-[var(--text-muted)] flex-1">{s.label}</span>
                  <span className="font-medium tabular-nums">{pct(s.value, total)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    getDashboard()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-[var(--text-muted)] animate-pulse">
        Loading dashboard…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-32 text-red-500">
        Failed to load dashboard: {error}
      </div>
    );
  }

  const latestStats  = data.deliveries.latest_stats;
  const totalSites   = data.deliveries.total_sites ?? 0;
  const hasAnyData   = data.scans.total > 0 || data.comparisons.total > 0 || data.deliveries.total_deliveries > 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-[var(--text-muted)] mt-1">
          Overview of all scans, comparisons, and delivery activity
        </p>
      </div>

      {!hasAnyData ? (
        <div className="text-center py-24 text-[var(--text-muted)]">
          <p className="text-5xl mb-4">🚀</p>
          <p className="font-semibold text-lg">Nothing here yet</p>
          <p className="text-sm mt-2">Run a scan, compare sites, or upload a Broadridge delivery to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary cards row */}
          <div className="grid grid-cols-3 gap-5">
            <ScansCard       data={data.scans}       />
            <ComparisonsCard data={data.comparisons} />
            <DeliveriesCard  data={data.deliveries}  />
          </div>

          {/* Recent activity + fleet snapshot */}
          <div className="grid grid-cols-[1fr_1.6fr] gap-5">
            <RecentActivity items={data.recent} />
            {latestStats && totalSites > 0
              ? <DeliverySnapshot stats={latestStats} total={totalSites} />
              : <div className="rounded-2xl border-2 border-dashed border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] text-sm p-8 text-center">
                  Upload a delivery zip to see<br />the site fleet snapshot here.
                </div>
            }
          </div>
        </div>
      )}
    </div>
  );
}
