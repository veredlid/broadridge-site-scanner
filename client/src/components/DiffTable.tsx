import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SeverityBadge, ChangeTypeBadge } from './SeverityBadge';
import { Tooltip } from './Tooltip';

interface DiffEvidence {
  originalScreenshot?: string;
  migratedScreenshot?: string;
}

interface DiffItem {
  page: string;
  section: string;
  checkId: string;
  description: string;
  severity: string;
  changeType: string;
  verdict?: 'bug' | 'expected' | 'info';
  evidence?: DiffEvidence;
  affectedPages?: string[];
}

interface DiffPageGroup {
  url: string;
  originalUrl?: string;
  migratedUrl?: string;
  items: DiffItem[];
}

export type VerdictFilter = 'bugs' | 'all-issues' | 'expected' | 'all';

interface Props {
  pages: DiffPageGroup[];
  verdictFilter: VerdictFilter;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEffectiveVerdict(item: DiffItem): 'bug' | 'expected' | 'info' {
  if (item.verdict) return item.verdict;
  if (item.changeType === 'expected-change') return 'expected';
  if (item.changeType === 'new-in-migrated' || item.changeType === 'content-changed') return 'info';
  if (item.severity === 'critical' || item.severity === 'major') return 'bug';
  return 'info';
}

function filterByVerdict(items: DiffItem[], filter: VerdictFilter): DiffItem[] {
  switch (filter) {
    case 'bugs':       return items.filter((i) => getEffectiveVerdict(i) === 'bug');
    case 'all-issues': return items.filter((i) => getEffectiveVerdict(i) === 'info');
    case 'expected':   return items.filter((i) => getEffectiveVerdict(i) === 'expected');
    case 'all':        return items;
  }
}

/** Convert a URL or path to a human-readable page name. */
function formatPageName(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '') || '/';
    if (path === '/') return 'Home';
    // /about-us → About Us
    return path
      .replace(/^\//, '')
      .split('/')
      .map((seg) => seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
      .join(' / ');
  } catch {
    if (url === '/' || url === '') return 'Home';
    return url;
  }
}

// ── Source category ───────────────────────────────────────────────────────────

/** Maps a checkId prefix to a human-readable source category + emoji. */
function getSourceCategory(checkId: string): { label: string; color: string } {
  if (checkId.startsWith('link-'))    return { label: '🔗 Links',    color: 'bg-sky-500/15 text-sky-400' };
  if (checkId.startsWith('menu-'))    return { label: '📋 Menu',     color: 'bg-violet-500/15 text-violet-400' };
  if (checkId === 'section-font-family') return { label: '🔤 Typography', color: 'bg-teal-500/15 text-teal-400' };
  if (checkId.startsWith('section-'))    return { label: '📐 Layout',    color: 'bg-amber-500/15 text-amber-400' };
  if (checkId === 'image-aspect-ratio')  return { label: '🖼 Images',    color: 'bg-pink-500/15 text-pink-400' };
  if (checkId === 'slider-controls-missing') return { label: '🎠 Slider', color: 'bg-indigo-500/15 text-indigo-400' };
  if (checkId === 'map-zoom-changed')    return { label: '🗺 Maps',      color: 'bg-cyan-500/15 text-cyan-400' };
  if (checkId.startsWith('contact-')) return { label: '📞 Contact',  color: 'bg-green-500/15 text-green-400' };
  if (checkId.startsWith('image-'))   return { label: '🖼 Images',   color: 'bg-pink-500/15 text-pink-400' };
  if (checkId.startsWith('form-'))    return { label: '📝 Forms',    color: 'bg-orange-500/15 text-orange-400' };
  if (checkId.startsWith('cta-'))     return { label: '🖱 Actions',    color: 'bg-rose-500/15 text-rose-400' };
  if (checkId.startsWith('content-')) return { label: '📝 Content',    color: 'bg-yellow-500/15 text-yellow-400' };
  if (checkId.startsWith('page-js')) return { label: '🐞 JS Errors',  color: 'bg-red-500/15 text-red-400' };
  return { label: '⚙ Other', color: 'bg-slate-500/15 text-slate-400' };
}

// ── Verdict badge ─────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: 'bug' | 'expected' | 'info' }) {
  if (verdict === 'bug') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30">
      🐛 Bug
    </span>
  );
  if (verdict === 'expected') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-500/20 text-slate-400 border border-slate-500/20">
      ✓ Expected
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
      ℹ Info
    </span>
  );
}

// ── Screenshot modal ──────────────────────────────────────────────────────────

interface ModalProps {
  originalSrc?: string;
  migratedSrc?: string;
  section: string;
  onClose: () => void;
}

function ScreenshotModal({ originalSrc, migratedSrc, section, onClose }: ModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ background: 'rgba(0,0,0,0.88)' }}
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-semibold text-white">
          📸 Evidence — <code className="text-blue-300">#{section}</code>
        </span>
        <button
          onClick={onClose}
          className="text-white/60 hover:text-white text-xl leading-none px-2"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Images */}
      <div
        className="flex flex-1 gap-4 p-6 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {[
          { label: 'Original', src: originalSrc },
          { label: 'Migrated', src: migratedSrc },
        ].map(({ label, src }) => (
          <div key={label} className="flex-1 flex flex-col min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">{label}</p>
            {src ? (
              <img
                src={src}
                alt={`${label} ${section}`}
                className="rounded-xl border max-h-full object-contain"
                style={{ borderColor: 'rgba(255,255,255,0.12)' }}
              />
            ) : (
              <div
                className="flex-1 rounded-xl border border-dashed flex items-center justify-center text-sm text-white/30"
                style={{ borderColor: 'rgba(255,255,255,0.15)' }}
              >
                No screenshot
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-white/30 pb-3">Click outside or press Esc to close</p>
    </div>,
    document.body,
  );
}

// ── Evidence panel (inline row expansion) ────────────────────────────────────

function EvidencePanel({ evidence, section }: { evidence: DiffEvidence; section: string }) {
  const [modal, setModal] = useState(false);
  const hasOriginal = !!evidence.originalScreenshot;
  const hasM = !!evidence.migratedScreenshot;
  if (!hasOriginal && !hasM) return null;

  return (
    <>
      <div className="mt-3 pt-3 border-t border-[var(--border)]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            📸 Evidence — <code>#{section}</code>
          </p>
          <button
            onClick={() => setModal(true)}
            className="text-xs px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition"
          >
            ⛶ Expand
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Original', src: evidence.originalScreenshot },
            { label: 'Migrated', src: evidence.migratedScreenshot },
          ].map(({ label, src }) => (
            <div key={label}>
              <p className="text-xs text-[var(--text-muted)] mb-1 font-medium">{label}</p>
              {src ? (
                <img
                  src={src}
                  alt={`${label} ${section}`}
                  className="w-full rounded-lg border border-[var(--border)] hover:opacity-90 transition cursor-zoom-in"
                  onClick={() => setModal(true)}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-full h-20 rounded-lg border border-dashed border-[var(--border)] flex items-center justify-center text-xs text-[var(--text-muted)]">
                  No screenshot
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {modal && (
        <ScreenshotModal
          originalSrc={evidence.originalScreenshot}
          migratedSrc={evidence.migratedScreenshot}
          section={section}
          onClose={() => setModal(false)}
        />
      )}
    </>
  );
}

// ── Expandable row ────────────────────────────────────────────────────────────

function DiffRow({
  item,
  showPage,
  pageOriginalUrl,
  pageMigratedUrl,
}: {
  item: DiffItem;
  showPage: boolean;
  pageOriginalUrl?: string;
  pageMigratedUrl?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const hasEvidence = !!(item.evidence?.originalScreenshot || item.evidence?.migratedScreenshot);
  const verdict = getEffectiveVerdict(item);
  const isTruncated = item.description.length > 80;

  const pageName = formatPageName(item.page);
  const pageLink = pageMigratedUrl || item.page;

  return (
    <>
      <tr
        className={`border-b border-[var(--border)] ${hasEvidence ? 'cursor-pointer hover:bg-blue-500/5' : 'hover:bg-blue-500/5'} ${verdict === 'bug' ? 'border-l-2 border-l-red-500/40' : ''}`}
        onClick={() => hasEvidence && setExpanded((e) => !e)}
      >
        {showPage && (
          <td className="px-4 py-2.5 max-w-[130px]">
            {item.page === 'site-wide' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-500/15 text-purple-300 whitespace-nowrap">
                🌐 Site-wide
              </span>
            ) : (
              <Tooltip content={`Original: ${pageOriginalUrl || item.page}\nMigrated: ${pageMigratedUrl || item.page}`}>
                <a
                  href={pageLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-blue-400 hover:underline font-medium block truncate"
                  title=""
                >
                  {pageName}
                </a>
              </Tooltip>
            )}
          </td>
        )}
        <td className="px-3 py-2.5">
          <VerdictBadge verdict={verdict} />
        </td>
        <td className="px-3 py-2.5">
          {(() => {
            const { label, color } = getSourceCategory(item.checkId);
            return (
              <Tooltip content={item.checkId}>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${color}`}>
                  {label}
                </span>
              </Tooltip>
            );
          })()}
        </td>
        <td className="px-4 py-2.5 text-sm">
          {(!item.section || item.section === 'unknown')
            ? <span className="text-[var(--text-muted)]">—</span>
            : item.section}
        </td>
        <td className="px-4 py-2.5"><SeverityBadge severity={item.severity} /></td>
        <td className="px-4 py-2.5"><ChangeTypeBadge changeType={item.changeType} /></td>

        {/* Description — hover tooltip; click expands to full selectable text */}
        <td
          className="px-4 py-2.5 text-sm max-w-md"
          onClick={(e) => {
            if (isTruncated) { e.stopPropagation(); setDescExpanded((v) => !v); }
          }}
        >
          {descExpanded ? (
            <span className="block whitespace-normal break-words select-text cursor-text">
              {item.description}
              <button
                className="ml-2 text-[10px] text-[var(--text-muted)] hover:text-white underline align-middle"
                onClick={(e) => { e.stopPropagation(); setDescExpanded(false); }}
              >
                collapse
              </button>
            </span>
          ) : isTruncated ? (
            <Tooltip content={item.description}>
              <span className="block truncate cursor-pointer" title="">{item.description}</span>
            </Tooltip>
          ) : (
            <span>{item.description}</span>
          )}
        </td>

        <td className="px-4 py-2.5 w-8">
          {hasEvidence && (
            <span className="text-xs text-[var(--text-muted)]" title="Click row to view evidence screenshots">
              {expanded ? '▲' : '📸'}
            </span>
          )}
        </td>
      </tr>

      {expanded && item.evidence && (
        <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
          <td colSpan={showPage ? 8 : 7} className="px-4 pb-4">
            <EvidencePanel evidence={item.evidence} section={item.section} />
          </td>
        </tr>
      )}

      {/* Affected pages expansion — shown for site-wide consolidated items */}
      {item.page === 'site-wide' && item.affectedPages && item.affectedPages.length > 0 && (
        <tr className="border-b border-[var(--border)] bg-purple-500/5">
          <td colSpan={showPage ? 8 : 7} className="px-6 py-2">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-purple-300 font-medium mr-1">Affects {item.affectedPages.length} pages:</span>
              {item.affectedPages.map((p) => (
                <a
                  key={p}
                  href={p}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-2 py-0.5 rounded text-xs bg-[var(--bg)] border border-[var(--border)] text-blue-400 hover:underline font-mono"
                >
                  {formatPageName(p)}
                </a>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main DiffTable ────────────────────────────────────────────────────────────

export function DiffTable({ pages, verdictFilter }: Props) {
  const allItems = pages.flatMap((p) => filterByVerdict(p.items, verdictFilter));
  const uniquePages = new Set(allItems.map((i) => i.page));
  const showPageColumn = uniquePages.size > 1;

  return (
    <div>
      {pages.map((page) => {
        const items = filterByVerdict(page.items, verdictFilter);
        if (items.length === 0) return null;

        const evidenceCount = items.filter((i) => i.evidence?.originalScreenshot || i.evidence?.migratedScreenshot).length;
        const bugCount = items.filter((i) => getEffectiveVerdict(i) === 'bug').length;
        const pageName = formatPageName(page.migratedUrl || page.url);

        return (
          <div key={page.url} className="mb-8">
            {/* Page group header */}
            <h3 className="text-base font-semibold mb-3 pb-2 border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
              <span className="text-[var(--text-muted)]">📄</span>
              <span className="text-white font-bold">{pageName}</span>
              <span className="text-[var(--text-muted)] text-xs">—</span>
              <a
                href={page.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--text-muted)] hover:text-[var(--blue)] font-mono text-xs hover:underline"
              >
                original ↗
              </a>
              <a
                href={page.migratedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--text-muted)] hover:text-[var(--blue)] font-mono text-xs hover:underline"
              >
                migrated ↗
              </a>
              <div className="ml-auto flex items-center gap-2">
                {bugCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold">
                    🐛 {bugCount} bug{bugCount !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-xs text-[var(--text-muted)]">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                {evidenceCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-500/15 text-[var(--blue)]">
                    📸 {evidenceCount}
                  </span>
                )}
              </div>
            </h3>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-[var(--border)]">
                    {showPageColumn && (
                      <th className="px-4 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Page</th>
                    )}
                    <th className="px-3 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Verdict</th>
                    <th className="px-3 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Source</th>
                    <th className="px-4 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Section</th>
                    <th className="px-4 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Severity</th>
                    <th className="px-4 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs uppercase text-[var(--text-muted)]">Description</th>
                    <th className="px-4 py-2.5 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <DiffRow
                      key={i}
                      item={item}
                      showPage={showPageColumn}
                      pageOriginalUrl={page.originalUrl}
                      pageMigratedUrl={page.migratedUrl}
                    />
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
