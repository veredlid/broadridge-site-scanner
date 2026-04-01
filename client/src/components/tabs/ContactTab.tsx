import type { SiteSnapshot } from './shared';

export function ContactTab({ snapshot }: { snapshot: SiteSnapshot | null }) {
  if (!snapshot) return null;
  const allContacts = snapshot.pages.flatMap(page =>
    page.contactInfo.map(c => ({ ...c, pageTitle: page.title, pageUrl: page.url }))
  );
  if (allContacts.length === 0) {
    return <p className="text-[var(--text-muted)] text-sm py-8 text-center">No contact information found.</p>;
  }
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-[var(--border)]">
            <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Page</th>
            <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Location</th>
            <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Phone</th>
            <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Email</th>
            <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">Address</th>
          </tr>
        </thead>
        <tbody>
          {allContacts.map((c, i) => (
            <tr key={i} className="border-b border-[var(--border)] hover:bg-blue-500/5">
              <td className="px-4 py-2 text-sm">{c.pageTitle}</td>
              <td className="px-4 py-2 text-xs text-[var(--text-muted)]">{c.location}</td>
              <td className="px-4 py-2 text-sm">{c.phone || '—'}</td>
              <td className="px-4 py-2 text-sm">{c.email || '—'}</td>
              <td className="px-4 py-2 text-sm max-w-[200px] truncate">{c.address || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
