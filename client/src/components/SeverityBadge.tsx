const colors: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400',
  major: 'bg-yellow-500/15 text-yellow-400',
  minor: 'bg-purple-500/15 text-purple-400',
  info: 'bg-blue-500/15 text-blue-400',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors[severity] ?? 'bg-slate-500/15 text-slate-400'}`}>
      {severity}
    </span>
  );
}

const statusColors: Record<string, string> = {
  queued: 'bg-slate-500/15 text-slate-400',
  running: 'bg-blue-500/15 text-blue-400 animate-pulse',
  done: 'bg-green-500/15 text-green-400',
  failed: 'bg-red-500/15 text-red-400',
};

const statusLabels: Record<string, string> = {
  done: '✓ pass',
  queued: 'queued',
  running: 'running…',
  failed: '✗ failed',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[status] ?? statusColors.queued}`}>
      {statusLabels[status] ?? status}
    </span>
  );
}

const changeColors: Record<string, string> = {
  match: 'bg-green-500/15 text-green-400',
  mismatch: 'bg-red-500/15 text-red-400',
  'content-changed': 'bg-blue-500/15 text-blue-400',
  'missing-in-migrated': 'bg-yellow-500/15 text-yellow-400',
  'new-in-migrated': 'bg-purple-500/15 text-purple-400',
  fixed: 'bg-green-500/15 text-green-400',
  regressed: 'bg-red-500/15 text-red-400',
  'expected-change': 'bg-teal-500/15 text-teal-400',
};

export function ChangeTypeBadge({ changeType }: { changeType: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${changeColors[changeType] ?? 'bg-slate-500/15 text-slate-400'}`}>
      {changeType}
    </span>
  );
}
