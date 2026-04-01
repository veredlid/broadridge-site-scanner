import { useState } from 'react';
import { normalizePath, classifyLink } from './shared';
import type { SiteSnapshot, LinkInfo } from './shared';

interface LinkMapItem {
  text: string;
  href: string | null;
  status: number | null;
  isExternal: boolean;
  newTab: boolean;
  kind: string;
  section: string;
}

export function LinkGroup({ title, icon, items, scannedPaths }: {
  title: string;
  icon: string;
  items: LinkMapItem[];
  scannedPaths: Set<string>;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] text-left hover:bg-white/5 transition"
      >
        <span>{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-[var(--text-muted)]">({items.length})</span>
        <span className="ml-auto text-[var(--text-muted)] text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="divide-y divide-[var(--border)]">
          {items.map((item, i) => {
            const destPath = item.href ? normalizePath(item.href) : null;
            const destPage = destPath ? scannedPaths.has(destPath) ? destPath : null : null;
            const isDead = item.kind === 'dead' || (!item.href && !item.status);
            const isBroken = item.status !== null && item.status >= 400;

            return (
              <div key={i} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${isBroken || isDead ? 'bg-red-500/5' : ''}`}>
                {/* Status icon */}
                <span className={`shrink-0 font-bold text-base ${
                  isDead ? 'text-red-400' :
                  isBroken ? 'text-red-400' :
                  item.status !== null && item.status < 400 ? 'text-green-400' :
                  item.kind === 'internal-page' ? 'text-green-400' :
                  'text-[var(--text-muted)]'
                }`}>
                  {isDead ? '✗' : isBroken ? '✗' : item.status !== null ? '✓' : item.kind === 'internal-page' ? '✓' : '—'}
                </span>

                {/* Link text */}
                <span className="font-medium min-w-[120px] max-w-[180px] truncate" title={item.text}>
                  {item.text}
                </span>

                {/* Arrow + destination */}
                <span className="text-[var(--text-muted)] shrink-0">→</span>
                {item.href ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--blue)] hover:underline truncate max-w-xs"
                    title={item.href}
                  >
                    {item.href.length > 60 ? item.href.slice(0, 60) + '…' : item.href}
                  </a>
                ) : (
                  <span className="text-red-400 italic text-xs">no destination</span>
                )}

                {/* Badges */}
                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  {item.status !== null && (
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      item.status < 400 ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                    }`}>
                      {item.status}
                    </span>
                  )}
                  {destPage && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-[var(--blue)]">
                      → {destPage === '/' ? 'home' : destPage}
                    </span>
                  )}
                  {item.kind === 'external' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">external</span>
                  )}
                  {item.newTab && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]">↗ new tab</span>
                  )}
                  {isDead && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">dead link</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LinkMapTab({ snapshot }: { snapshot: SiteSnapshot | null }) {
  if (!snapshot) return <p className="text-[var(--text-muted)] text-sm py-8 text-center">No snapshot data available.</p>;

  const scannedPaths = new Set(snapshot.pages.map(p => normalizePath(p.url)));
  const domain = ''; // will be compared by hostname in classifyLink

  return (
    <div>
      {snapshot.pages.map((page) => {
        // Group links by location/category
        const ctaLinks = page.ctas.filter(c => c.isVisible);
        const navLinks = page.links.filter(l => l.location === 'navigationContainer' || l.location === 'headerContainer');
        const footerLinks = page.links.filter(l => l.location === 'footerContainer' || l.location === 'bottomNavigationContainer');
        const bodyLinks = page.links.filter(l =>
          !['navigationContainer', 'headerContainer', 'footerContainer', 'bottomNavigationContainer'].includes(l.location)
        );

        return (
          <div key={page.url} className="mb-10">
            <h3 className="text-base font-bold mb-3 pb-2 border-b border-[var(--border)] flex items-center gap-2">
              <span className="text-[var(--text-muted)]">📄</span>
              <span>{page.title}</span>
              <code className="text-xs text-[var(--text-muted)] font-normal">{page.url}</code>
            </h3>

            <div className="space-y-5">
              {/* CTAs */}
              {ctaLinks.length > 0 && (
                <LinkGroup
                  title="CTAs"
                  icon="🔲"
                  items={ctaLinks.map(c => ({
                    text: c.text || '(no text)',
                    href: c.href ?? c.navigatesTo ?? null,
                    status: null,
                    isExternal: c.href ? !c.href.includes(page.url.split('/')[0]) : false,
                    newTab: false,
                    kind: c.href ? classifyLink({ href: c.href } as LinkInfo, scannedPaths, domain) : 'dead',
                    section: c.section,
                  }))}
                  scannedPaths={scannedPaths}
                />
              )}

              {/* Nav links */}
              {navLinks.length > 0 && (
                <LinkGroup
                  title="Navigation"
                  icon="🗂"
                  items={navLinks.map(l => ({
                    text: l.text || '(empty)',
                    href: l.href,
                    status: l.httpStatus,
                    isExternal: l.isExternal,
                    newTab: l.target === '_blank',
                    kind: classifyLink(l, scannedPaths, domain),
                    section: l.location,
                  }))}
                  scannedPaths={scannedPaths}
                />
              )}

              {/* Body links */}
              {bodyLinks.length > 0 && (
                <LinkGroup
                  title="Body links"
                  icon="🔗"
                  items={bodyLinks.map(l => ({
                    text: l.text || '(empty)',
                    href: l.href,
                    status: l.httpStatus,
                    isExternal: l.isExternal,
                    newTab: l.target === '_blank',
                    kind: classifyLink(l, scannedPaths, domain),
                    section: l.location,
                  }))}
                  scannedPaths={scannedPaths}
                />
              )}

              {/* Footer links */}
              {footerLinks.length > 0 && (
                <LinkGroup
                  title="Footer"
                  icon="📋"
                  items={footerLinks.map(l => ({
                    text: l.text || '(empty)',
                    href: l.href,
                    status: l.httpStatus,
                    isExternal: l.isExternal,
                    newTab: l.target === '_blank',
                    kind: classifyLink(l, scannedPaths, domain),
                    section: l.location,
                  }))}
                  scannedPaths={scannedPaths}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
