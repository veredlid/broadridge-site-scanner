import type { ContentComparisonSummary } from './shared';

function SimilarityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono w-9 shrink-0 text-right ${
        pct >= 75 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400'
      }`}>{pct}%</span>
    </div>
  );
}

function RatingBadge({ rating }: { rating: 'high' | 'medium' | 'low' }) {
  const styles = {
    high:   'bg-green-500/15 text-green-400',
    medium: 'bg-yellow-500/15 text-yellow-400',
    low:    'bg-red-500/15 text-red-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[rating]}`}>
      {rating}
    </span>
  );
}

export function ContentFidelityTab({ comparisons }: { comparisons: ContentComparisonSummary[] }) {
  if (comparisons.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--text-muted)] text-sm mb-2">No content fidelity data available.</p>
        <p className="text-xs text-[var(--text-muted)]">
          This scan was run without access to the BR Source API, or the site has no comparable content fields.
        </p>
      </div>
    );
  }

  const allHigh = comparisons.every(c => c.allHigh);
  const avgSimilarity = comparisons.reduce((s, c) => s + c.overallSimilarity, 0) / comparisons.length;

  return (
    <div>
      {/* Summary header */}
      <div className={`mb-6 rounded-xl p-4 border flex items-center gap-4 ${
        allHigh
          ? 'bg-green-500/8 border-green-500/25'
          : 'bg-yellow-500/8 border-yellow-500/25'
      }`}>
        <span className="text-2xl">{allHigh ? '✅' : '⚠️'}</span>
        <div>
          <p className="font-semibold text-sm">
            {allHigh
              ? 'All pages passed content fidelity — original text is well-represented on the Wix site'
              : 'Some pages have low content similarity — original BR text may be missing or truncated'}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {comparisons.length} page{comparisons.length !== 1 ? 's' : ''} compared · avg similarity {Math.round(avgSimilarity * 100)}%
          </p>
        </div>
      </div>

      {/* Per-page comparison */}
      {comparisons.map((comp) => (
        <div key={comp.pageUrl} className="mb-8">
          <h3 className="text-base font-bold mb-3 pb-2 border-b border-[var(--border)] flex items-center gap-3">
            <span className="text-[var(--text-muted)]">📄</span>
            <span>{comp.pageTitle}</span>
            <code className="text-xs text-[var(--text-muted)] font-normal">{comp.pageUrl}</code>
            <span className="ml-auto">
              {comp.allHigh
                ? <span className="text-xs text-green-400 font-medium">All high ✓</span>
                : <span className="text-xs text-yellow-400 font-medium">Needs review</span>}
            </span>
          </h3>

          {/* Overall bar */}
          <div className="flex items-center gap-3 mb-4 pl-1">
            <span className="text-xs text-[var(--text-muted)] w-28 shrink-0">Overall</span>
            <div className="flex-1 max-w-xs">
              <SimilarityBar value={comp.overallSimilarity} />
            </div>
          </div>

          {/* Per-field table */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-4 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Field</th>
                  <th className="px-4 py-2.5 text-left text-xs uppercase text-[var(--text-muted)] w-56">Similarity</th>
                  <th className="px-4 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Rating</th>
                  <th className="px-4 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Missing key terms</th>
                </tr>
              </thead>
              <tbody>
                {comp.fields.map((field, i) => (
                  <tr key={i} className={`border-b border-[var(--border)] hover:bg-white/5 ${!field.meaningful ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium">{field.fieldName}</span>
                      {!field.meaningful && (
                        <span className="ml-2 text-xs text-[var(--text-muted)]">(too short to compare)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 w-56">
                      <SimilarityBar value={field.similarity} />
                    </td>
                    <td className="px-4 py-3">
                      <RatingBadge rating={field.rating} />
                    </td>
                    <td className="px-4 py-3">
                      {field.missingKeyTerms.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {field.missingKeyTerms.map((term, j) => (
                            <span key={j} className="px-1.5 py-0.5 rounded text-xs bg-red-500/10 text-red-400 font-mono">
                              {term}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-green-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
