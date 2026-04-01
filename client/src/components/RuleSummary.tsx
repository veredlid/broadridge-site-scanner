interface Props {
  totalChecks: number;
  passed: number;
  failed: number;
  critical?: number;
  duration?: number;
  pageCount?: number;
  expectedChanges?: number;
}

export function RuleSummary({ totalChecks, passed, failed, critical, duration, pageCount, expectedChanges }: Props) {
  const cards = [
    { label: 'Total Checks', value: totalChecks, color: 'text-[var(--text)]' },
    { label: 'Passed', value: passed, color: 'text-green-400' },
    { label: 'Failed', value: failed, color: 'text-red-400' },
    ...(critical !== undefined ? [{ label: 'Critical', value: critical, color: 'text-red-500' }] : []),
    ...(expectedChanges !== undefined ? [{ label: 'Expected', value: expectedChanges, color: 'text-teal-400' }] : []),
    ...(pageCount !== undefined ? [{ label: 'Pages', value: pageCount, color: 'text-blue-400' }] : []),
    ...(duration !== undefined ? [{ label: 'Duration', value: `${(duration / 1000).toFixed(1)}s`, color: 'text-[var(--text-muted)]' }] : []),
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
      {cards.map((card) => (
        <div key={card.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 text-center">
          <div className={`text-3xl font-bold ${card.color}`}>{card.value}</div>
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mt-1">{card.label}</div>
        </div>
      ))}
    </div>
  );
}
