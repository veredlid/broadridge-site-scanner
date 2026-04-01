import type { SiteSnapshot } from './shared';

export function LinksTab({ snapshot }: { snapshot: SiteSnapshot | null }) {
  if (!snapshot) return null;
  return (
    <div>
      {snapshot.pages.map((page) => (
        <div key={page.url} className="mb-8">
          <h3 className="text-base font-semibold mb-3">{page.title} ({page.url})</h3>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-[var(--border)]">
                  <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Text</th>
                  <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">URL</th>
                  <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Status</th>
                  <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Section</th>
                  <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">External</th>
                </tr>
              </thead>
              <tbody>
                {page.links.map((link, i) => (
                  <tr key={i} className="border-b border-[var(--border)] hover:bg-blue-500/5">
                    <td className="px-4 py-2 text-sm max-w-[150px] truncate">{link.text || '(empty)'}</td>
                    <td className="px-4 py-2 text-sm max-w-[300px] truncate text-[var(--blue)]">{link.href}</td>
                    <td className="px-4 py-2">
                      {link.httpStatus ? (
                        <span className={`text-xs font-mono ${link.httpStatus < 400 ? 'text-green-400' : 'text-red-400'}`}>
                          {link.httpStatus}
                        </span>
                      ) : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--text-muted)]">{link.location}</td>
                    <td className="px-4 py-2">{link.isExternal ? <span className="text-yellow-400 text-xs">ext</span> : ''}</td>
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
