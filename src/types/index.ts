// ═══════════════════════════════════════
//  Top-Level Snapshot
// ═══════════════════════════════════════

export interface SiteSnapshot {
  domain: string;
  capturedAt: string;
  scanLabel: string;
  siteType: 'vanilla' | 'flex' | 'deprecated';
  pages: PageSnapshot[];
  metadata?: SiteMetadata;
}

export interface SiteMetadata {
  liveStatus: string;
  flexXmlFound: boolean;
  pageCount: number;
  scanDurationMs: number;
}

// ═══════════════════════════════════════
//  Page Snapshot
// ═══════════════════════════════════════

export interface PageSnapshot {
  url: string;
  title: string;
  pageId: string;
  links: LinkInfo[];
  ctas: CTAInfo[];
  sections: SectionSnapshot[];
  forms: FormInfo[];
  menu: MenuSnapshot;
  contactInfo: ContactInfo[];
  images: ImageInfo[];
  viewports: {
    desktop: ViewportMetrics;
    tablet: ViewportMetrics;
    mobile: ViewportMetrics;
  };
}

// ═══════════════════════════════════════
//  Links & CTAs
// ═══════════════════════════════════════

export interface LinkInfo {
  text: string;
  href: string;
  target: '_blank' | '_self' | '';
  httpStatus: number | null;
  isExternal: boolean;
  location: string;
  elementSelector: string;
}

export interface CTAInfo {
  text: string;
  type: 'button' | 'link' | 'submit';
  href: string | null;
  navigatesTo: string | null;
  httpStatus: number | null;
  section: string;
  isVisible: boolean;
  elementSelector: string;
}

export interface LinkValidationResult extends LinkInfo {
  isBroken: boolean;
  wasBrokenOnOriginal: boolean;
  isFlagged: boolean;
}

export interface CTAValidationResult extends CTAInfo {
  destinationTitle?: string;
  navigationWorks: boolean;
}

// ═══════════════════════════════════════
//  Sections
// ═══════════════════════════════════════

export interface SectionSnapshot {
  id: string;
  isPresent: boolean;
  isVisible: boolean;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize: string;
  boundingBox: BoundingBox;
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
  textContent: string;
  headings: string[];
  imageCount: number;
  linkCount: number;
  buttonCount: number;
  screenshot?: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ═══════════════════════════════════════
//  Forms
// ═══════════════════════════════════════

export interface FormInfo {
  formType:
    | 'contact-us'
    | 'request-quote'
    | 'tell-friend'
    | 'p-and-c'
    | 'newsletter'
    | 'unknown';
  action: string;
  fields: string[];
  section: string;
  isVisible: boolean;
  hasSubmitButton: boolean;
}

// ═══════════════════════════════════════
//  Menu
// ═══════════════════════════════════════

export interface MenuSnapshot {
  items: MenuItemInfo[];
}

export interface MenuItemInfo {
  text: string;
  href: string;
  hasDropdown: boolean;
  hasDropdownArrow: boolean;
  subItems: SubMenuItem[];
}

export interface SubMenuItem {
  text: string;
  href: string;
}

// ═══════════════════════════════════════
//  Images
// ═══════════════════════════════════════

export interface ImageInfo {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
  isLoaded: boolean;
  isUpscaled: boolean;
  isDistorted: boolean;
  hasLink: boolean;
  linkHref: string | null;
  section: string;
}

// ═══════════════════════════════════════
//  Contact Info
// ═══════════════════════════════════════

export interface ContactInfo {
  location: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  fax: string | null;
}

// ═══════════════════════════════════════
//  Layout Metrics (per viewport)
// ═══════════════════════════════════════

export interface ViewportMetrics {
  viewport: { width: number; height: number };
  hasHorizontalScroll: boolean;
  smallestFontSize: number;
  smallestFontElement: string;
  textOverflows: TextOverflow[];
  paddingIssues: PaddingIssue[];
}

export interface TextOverflow {
  element: string;
  text: string;
}

export interface PaddingIssue {
  element: string;
  paddingPx: number;
  viewportWidthPx: number;
  paddingPercent: number;
  threshold: number;
}

// ═══════════════════════════════════════
//  Comparison / Diff
// ═══════════════════════════════════════

export interface SnapshotDiff {
  originalDomain: string;
  migratedDomain: string;
  originalTimestamp: string;
  migratedTimestamp: string;
  mode: 'before-after' | 'cross-site';
  summary: DiffSummary;
  items: DiffItem[];
  pages: PageDiff[];
}

export interface DiffSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  fixed: number;
  regressed: number;
  newIssues: number;
}

export interface DiffItem {
  page: string;
  section: string;
  checkId: string;
  description: string;
  severity: 'critical' | 'major' | 'minor' | 'info';
  original: unknown;
  migrated: unknown;
  changeType: 'match' | 'mismatch' | 'missing-in-migrated' | 'new-in-migrated' | 'fixed' | 'regressed';
}

export interface PageDiff {
  url: string;
  originalUrl?: string;
  migratedUrl?: string;
  items: DiffItem[];
}

// ═══════════════════════════════════════
//  Validation Report
// ═══════════════════════════════════════

export interface ValidationReport {
  domain: string;
  timestamp: string;
  totalChecks: number;
  passed: number;
  failed: number;
  results: ValidationResult[];
}

export interface ValidationResult {
  ruleId: string;
  ruleName: string;
  category: string;
  severity: 'critical' | 'major' | 'minor' | 'info';
  passed: boolean;
  message: string;
  page: string;
  section: string;
  details?: unknown;
}

// ═══════════════════════════════════════
//  BR Source API types
// ═══════════════════════════════════════

export interface BRSourceResponse {
  site: {
    domain: string;
    json: string;
  };
}

export interface BRSiteData {
  domain: string;
  pages: Record<string, { url: string; title: string }>;
  'user-content-fields': Array<{ id: number; content: string }>;
  'Live-Site-Status': string;
}

// ═══════════════════════════════════════
//  CLI options
// ═══════════════════════════════════════

export interface ScanOptions {
  domain: string;
  label: string;
  viewports: Array<'desktop' | 'tablet' | 'mobile'>;
  screenshots: boolean;
  concurrency: number;
  timeout: number;
  auth?: string;
  output: string;
  csv: boolean;
}

export interface CompareOptions {
  domain: string;
  before: string;
  after: string;
  output: string;
}

export interface CompareSitesOptions {
  original: string;
  migrated: string;
  viewports: Array<'desktop' | 'tablet' | 'mobile'>;
  screenshots: boolean;
  concurrency: number;
  timeout: number;
  auth?: string;
  output: string;
  csv: boolean;
}

export type ViewportName = 'desktop' | 'tablet' | 'mobile';
