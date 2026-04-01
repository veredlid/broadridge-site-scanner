import type { SiteSnapshot } from './shared';

export function ImagesTab({ snapshot }: { snapshot: SiteSnapshot | null }) {
  if (!snapshot) return null;
  return (
    <div>
      {snapshot.pages.map((page) => {
        if (page.images.length === 0) return null;
        return (
          <div key={page.url} className="mb-8">
            <h3 className="text-base font-semibold mb-3">{page.title} ({page.url})</h3>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-[var(--border)]">
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Alt</th>
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Size</th>
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Section</th>
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {page.images.map((img, i) => (
                    <tr key={i} className="border-b border-[var(--border)] hover:bg-blue-500/5">
                      <td className="px-4 py-2 text-sm max-w-[200px] truncate">{img.alt || '(no alt)'}</td>
                      <td className="px-4 py-2 text-xs text-[var(--text-muted)]">{img.naturalWidth}×{img.naturalHeight} → {img.displayWidth}×{img.displayHeight}</td>
                      <td className="px-4 py-2 text-xs text-[var(--text-muted)]">{img.section}</td>
                      <td className="px-4 py-2">
                        {img.isUpscaled && <span className="text-xs text-red-400 mr-2">upscaled</span>}
                        {img.isDistorted && <span className="text-xs text-yellow-400 mr-2">distorted</span>}
                        {!img.isLoaded && <span className="text-xs text-red-400">broken</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
