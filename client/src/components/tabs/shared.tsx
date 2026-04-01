// Shared types and helpers used by all tab components

export interface LinkInfo {
  text: string;
  href: string;
  target: string;
  httpStatus: number | null;
  isExternal: boolean;
  location: string;
}

export interface CtaInfo {
  text: string;
  href: string | null;
  type: string;
  section: string;
  isVisible: boolean;
  navigatesTo: string | null;
}

export interface SectionInfo {
  id: string;
  isPresent: boolean;
  isVisible: boolean;
  imageCount: number;
  textContent: string;
  headings: string[];
  linkCount: number;
  buttonCount: number;
}

export interface MenuItemInfo {
  text: string;
  href: string;
  hasDropdown: boolean;
  subItems: Array<{ text: string; href: string }>;
}

export interface ImageInfo {
  src: string; alt: string; section: string;
  isLoaded: boolean; isUpscaled: boolean; isDistorted: boolean;
  hasLink: boolean; naturalWidth: number; naturalHeight: number;
  displayWidth: number; displayHeight: number;
}

export interface ContactInfo {
  location: string; phone: string | null; email: string | null; address: string | null;
}

export interface PageSnapshot {
  url: string;
  title: string;
  links: LinkInfo[];
  ctas: CtaInfo[];
  sections: SectionInfo[];
  menu: { items: MenuItemInfo[] };
  images: ImageInfo[];
  contactInfo: ContactInfo[];
  accessibilityAudit?: {
    images: Array<{ src: string; alt: string | null; ariaLabel: string | null; hasAlt: boolean }>;
    links: Array<{ text: string; href: string; ariaLabel: string | null }>;
    headings: Array<{ tag: string; text: string; ariaLabel: string | null }>;
    formElements: Array<{ tag: string; type: string | null; ariaLabel: string | null; placeholder: string | null }>;
  } | null;
}

export interface SiteSnapshot {
  pages: PageSnapshot[];
  metadata?: {
    contentComparisons?: ContentComparisonSummary[];
  };
}

export interface ContentFieldResult {
  fieldName: string;
  similarity: number;
  similarityPct: string;
  rating: 'high' | 'medium' | 'low';
  missingKeyTerms: string[];
  meaningful: boolean;
}

export interface ContentComparisonSummary {
  pageUrl: string;
  pageTitle: string;
  overallSimilarity: number;
  allHigh: boolean;
  fields: ContentFieldResult[];
}

export interface ValidationResult {
  ruleId: string;
  ruleName: string;
  category: string;
  severity: string;
  passed: boolean;
  message: string;
  page: string;
  section?: string;
}

// ── Helper components ────────────────────────────────────────────────────────

export function Check({ ok, label, detail, severity = 'major' }: {
  ok: boolean | null;
  label: string;
  detail?: string;
  severity?: string;
}) {
  const icon = ok === null ? '—' : ok ? '✓' : '✗';
  const color = ok === null
    ? 'text-[var(--text-muted)]'
    : ok
      ? 'text-green-400'
      : severity === 'critical' ? 'text-red-400' : severity === 'major' ? 'text-orange-400' : 'text-yellow-400';

  return (
    <div className="flex items-start gap-2 py-1">
      <span className={`font-bold text-sm w-4 shrink-0 mt-0.5 ${color}`}>{icon}</span>
      <div className="min-w-0">
        <span className={`text-sm ${ok === false ? color : 'text-[var(--text)]'}`}>{label}</span>
        {detail && <span className="text-xs text-[var(--text-muted)] ml-2">{detail}</span>}
      </div>
    </div>
  );
}

export function CheckGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">{title}</p>
      <div className="pl-1">{children}</div>
    </div>
  );
}

export function normalizePath(href: string): string {
  try { return new URL(href).pathname.replace(/\/$/, '') || '/'; } catch { return href; }
}

export function classifyLink(link: LinkInfo, scannedPaths: Set<string>, domain: string): string {
  if (!link.href || link.href === '#') return 'anchor';
  try {
    const url = new URL(link.href);
    const host = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (url.hostname === host || url.hostname === `www.${host}` || `www.${url.hostname}` === host) {
      const path = url.pathname.replace(/\/$/, '') || '/';
      return scannedPaths.has(path) ? 'internal-page' : 'internal-other';
    }
    return 'external';
  } catch {
    return link.href.startsWith('/') ? 'internal-other' : 'external';
  }
}
