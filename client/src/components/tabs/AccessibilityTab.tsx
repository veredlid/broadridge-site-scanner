import type { SiteSnapshot, PageSnapshot, ImageInfo } from './shared';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccessibilityImageInfo {
  src: string;
  originalAlt: string | null;
  migratedAlt: string | null;
  regression: boolean; // original had alt, migrated doesn't
}

export interface AccessibilityLinkInfo {
  text: string;
  href: string;
  originalAriaLabel: string | null;
  migratedAriaLabel: string | null;
  regression: boolean;
}

export interface AccessibilityFormElementInfo {
  elementType: string;
  originalAriaLabel: string | null;
  migratedAriaLabel: string | null;
  regression: boolean;
}

export interface PairedPage {
  originalUrl: string;
  migratedUrl: string;
  originalPage: PageSnapshot;
  migratedPage: PageSnapshot;
}

interface Props {
  original: SiteSnapshot | null;
  migrated: SiteSnapshot | null;
  pairedPages: PairedPage[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateSrc(src: string, maxLen = 60): string {
  if (src.length <= maxLen) return src;
  return '…' + src.slice(src.length - (maxLen - 1));
}

function hasAccessibilityData(page: PageSnapshot): boolean {
  // The server extractor doesn't yet produce accessibilityAudit; detect this by
  // checking whether the page object carries the field at all.
  return 'accessibilityAudit' in page && (page as any).accessibilityAudit !== undefined;
}

function buildImageRows(
  origPage: PageSnapshot,
  migPage: PageSnapshot | null,
): AccessibilityImageInfo[] {
  const origImages = origPage.images ?? [];
  const migImages = migPage?.images ?? [];

  // Index migrated images by src for fast lookup
  const migByAlt = new Map<string, ImageInfo>();
  for (const img of migImages) {
    migByAlt.set(img.src, img);
  }

  return origImages.map((img, i) => {
    const migratedImg = migByAlt.get(img.src) ?? migImages[i] ?? null;
    const originalAlt = img.alt?.trim() || null;
    const migratedAlt = migratedImg ? (migratedImg.alt?.trim() || null) : null;
    return {
      src: img.src,
      originalAlt,
      migratedAlt,
      regression: !!originalAlt && !migratedAlt,
    };
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AltCell({ value }: { value: string | null }) {
  if (value) {
    return <span className="text-green-400 text-sm">{value}</span>;
  }
  return <span className="text-red-400 text-sm font-medium">missing</span>;
}

function NoDataPlaceholder() {
  return (
    <div className="flex items-start gap-2 px-4 py-5 text-sm text-yellow-400 bg-yellow-400/5 border border-yellow-400/20 rounded-xl">
      <span className="shrink-0 mt-0.5">⚠</span>
      <p>
        Accessibility data not yet collected for this scan.
        Re-run the scan to see accessibility comparison.
      </p>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 mt-5">
      {title}
    </h4>
  );
}

function PagePairBlock({
  origPage,
  migPage,
}: {
  origPage: PageSnapshot;
  migPage: PageSnapshot | null;
}) {
  // If neither page has accessibilityAudit, show the placeholder.
  // Since the extractor doesn't produce it yet, we always show the placeholder
  // for the audit-specific sections (Links aria-labels, Form aria-labels)
  // while still deriving image alt-text from the images array which IS present.
  const hasAudit =
    hasAccessibilityData(origPage) || (migPage ? hasAccessibilityData(migPage) : false);

  const imageRows = buildImageRows(origPage, migPage);
  const hasImages = imageRows.length > 0;

  return (
    <div className="mb-10">
      <div className="flex items-baseline gap-2 mb-4 pb-2 border-b border-[var(--border)]">
        <h3 className="text-base font-semibold">{origPage.title || origPage.url}</h3>
        <span className="text-xs text-[var(--text-muted)]">{origPage.url}</span>
      </div>

      {/* ── 1. Images — Alt Text ──────────────────────────────────────────── */}
      <SectionHeader title="Images — Alt Text" />
      {hasImages ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-[var(--border)]">
                <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)] w-2/5">
                  Image Src
                </th>
                <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">
                  Original Alt
                </th>
                <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">
                  Migrated Alt
                </th>
                <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {imageRows.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b border-[var(--border)] hover:bg-blue-500/5 ${row.regression ? 'bg-red-500/5' : ''}`}
                >
                  <td
                    className="px-4 py-2 text-xs text-[var(--text-muted)] font-mono max-w-0 truncate"
                    title={row.src}
                  >
                    {truncateSrc(row.src)}
                  </td>
                  <td className="px-4 py-2">
                    <AltCell value={row.originalAlt} />
                  </td>
                  <td className="px-4 py-2">
                    {migPage ? (
                      <AltCell value={row.migratedAlt} />
                    ) : (
                      <span className="text-[var(--text-muted)] text-sm">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {row.regression && (
                      <span className="text-xs font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                        regression
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)] py-2">No images found on this page.</p>
      )}

      {/* ── 2. Links — Aria Labels ────────────────────────────────────────── */}
      <SectionHeader title="Links — Aria Labels" />
      {hasAudit ? (
        (() => {
          const origAudit = (origPage as any).accessibilityAudit;
          const migAudit = migPage ? (migPage as any).accessibilityAudit : null;
          const origLinks: AccessibilityLinkInfo[] = origAudit?.links ?? [];
          const migLinkMap = new Map<string, string | null>(
            (migAudit?.links ?? []).map((l: AccessibilityLinkInfo) => [l.href, l.originalAriaLabel])
          );

          if (origLinks.length === 0) {
            return (
              <p className="text-sm text-[var(--text-muted)] py-2">
                No aria-labeled links found on this page.
              </p>
            );
          }

          return (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-[var(--border)]">
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">
                      Link Text / Href
                    </th>
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">
                      Original Aria-Label
                    </th>
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">
                      Migrated Aria-Label
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {origLinks.map((link, i) => {
                    const migLabel = migPage ? (migLinkMap.get(link.href) ?? null) : null;
                    const regression = !!link.originalAriaLabel && !migLabel;
                    return (
                      <tr
                        key={i}
                        className={`border-b border-[var(--border)] hover:bg-blue-500/5 ${regression ? 'bg-red-500/5' : ''}`}
                      >
                        <td className="px-4 py-2 text-sm">
                          <span className="block truncate max-w-[200px]" title={link.text}>
                            {link.text || '(no text)'}
                          </span>
                          <span className="text-xs text-[var(--text-muted)] block truncate max-w-[200px]" title={link.href}>
                            {link.href}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <AltCell value={link.originalAriaLabel} />
                        </td>
                        <td className="px-4 py-2">
                          {migPage ? (
                            <AltCell value={migLabel} />
                          ) : (
                            <span className="text-[var(--text-muted)] text-sm">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()
      ) : (
        <NoDataPlaceholder />
      )}

      {/* ── 3. Form Elements — Aria Labels ───────────────────────────────── */}
      <SectionHeader title="Form Elements — Aria Labels" />
      {hasAudit ? (
        (() => {
          const origAudit = (origPage as any).accessibilityAudit;
          const migAudit = migPage ? (migPage as any).accessibilityAudit : null;
          const origForms: AccessibilityFormElementInfo[] = origAudit?.formElements ?? [];
          const migForms: AccessibilityFormElementInfo[] = migAudit?.formElements ?? [];

          if (origForms.length === 0) {
            return (
              <p className="text-sm text-[var(--text-muted)] py-2">
                No aria-labeled form elements found on this page.
              </p>
            );
          }

          return (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-[var(--border)]">
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">
                      Element Type
                    </th>
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">
                      Original Aria-Label
                    </th>
                    <th className="px-4 py-2 text-left text-xs uppercase text-[var(--text-muted)]">
                      Migrated Aria-Label
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {origForms.map((el, i) => {
                    const migEl = migForms[i] ?? null;
                    const migLabel = migEl?.migratedAriaLabel ?? null;
                    const regression = !!el.originalAriaLabel && !migLabel;
                    return (
                      <tr
                        key={i}
                        className={`border-b border-[var(--border)] hover:bg-blue-500/5 ${regression ? 'bg-red-500/5' : ''}`}
                      >
                        <td className="px-4 py-2 text-sm font-mono">{el.elementType}</td>
                        <td className="px-4 py-2">
                          <AltCell value={el.originalAriaLabel} />
                        </td>
                        <td className="px-4 py-2">
                          {migPage ? (
                            <AltCell value={migLabel} />
                          ) : (
                            <span className="text-[var(--text-muted)] text-sm">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()
      ) : (
        <NoDataPlaceholder />
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AccessibilityTab({ original, migrated, pairedPages }: Props) {
  // If we have explicit paired pages (future dual-scan mode), use those.
  if (pairedPages && pairedPages.length > 0) {
    return (
      <div>
        {pairedPages.map((pair) => (
          <PagePairBlock
            key={pair.originalUrl}
            origPage={pair.originalPage}
            migPage={pair.migratedPage}
          />
        ))}
      </div>
    );
  }

  // Single-snapshot mode: original only (migrated is null), one card per page.
  const snapshot = original ?? migrated;
  if (!snapshot) {
    return (
      <p className="text-[var(--text-muted)] text-sm py-8 text-center">
        No snapshot data available.
      </p>
    );
  }

  const migratedPages: Map<string, PageSnapshot> = new Map();
  if (migrated) {
    for (const p of migrated.pages) {
      migratedPages.set(p.url, p);
    }
  }

  return (
    <div>
      {snapshot.pages.map((page) => (
        <PagePairBlock
          key={page.url}
          origPage={page}
          migPage={migratedPages.get(page.url) ?? null}
        />
      ))}
    </div>
  );
}
