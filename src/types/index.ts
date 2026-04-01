import type { AccessibilityAudit } from '../crawler/accessibility-extractor.js';
export type { AccessibilityAudit };

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
  /** Content fidelity comparison results (BR source vs Wix page text) */
  contentComparisons?: ContentComparisonSummary[];
}

/** Per-page content fidelity summary stored in the snapshot */
export interface ContentComparisonSummary {
  pageUrl: string;
  pageTitle: string;
  overallSimilarity: number;
  allHigh: boolean;
  fields: Array<{
    fieldName: string;
    similarity: number;
    similarityPct: string;
    rating: 'high' | 'medium' | 'low';
    missingKeyTerms: string[];
    meaningful: boolean;
  }>;
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
  accessibilityAudit: AccessibilityAudit | null;
  /** True if the page has a visible print button/link (window.print or href contains "print") */
  hasPrintButton: boolean;
  /** True if the page has a visible back-to-top button/link (#top, scroll-to-top, etc.) */
  hasBackToTopButton: boolean;
  /** JavaScript console errors captured during page load */
  jsConsoleErrors: string[];
  /** Wix editor placeholder texts found on the page (e.g. "Footer link 1", "Add paragraph text") */
  placeholderTexts: Array<{ text: string; location: string }>;
  /** CTAs/buttons with non-functional href (void, empty, self-loop, or no destination) */
  invalidCTAs: Array<{ text: string; href: string | null; section: string; reason: string }>;
  /** tel: and mailto: links with missing or malformed values */
  invalidContactLinks: Array<{ text: string; href: string; type: 'tel' | 'mailto'; reason: string; location: string }>;
  /** Carousel/slider control presence — prev/next arrows and pause/play buttons */
  sliderControls: SliderControlsInfo[];
  /** Google Maps embeds found on the page with their zoom level */
  mapEmbeds: MapEmbedInfo[];
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
  isAntiBotBlocked?: boolean;
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
//  Slider Controls
// ═══════════════════════════════════════

export interface SliderControlsInfo {
  /** CSS selector or section id of the carousel container */
  section: string;
  hasPrevNext: boolean;
  hasPausePlay: boolean;
}

// ═══════════════════════════════════════
//  Map Embeds
// ═══════════════════════════════════════

export interface MapEmbedInfo {
  /** Zoom level extracted from the iframe src (null if not parseable) */
  zoom: number | null;
  /** Section/location where the map appears */
  section: string;
  /** The full iframe src for debugging */
  src: string;
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
  /** Count of items with verdict === 'bug' — the true regression count after smart filtering */
  bugs: number;
  contentChanged: number;
  fixed: number;
  regressed: number;
  newIssues: number;
  expectedChanges: number;
}

export interface DiffItem {
  page: string;
  section: string;
  checkId: string;
  description: string;
  severity: 'critical' | 'major' | 'minor' | 'info';
  original: unknown;
  migrated: unknown;
  changeType: 'match' | 'mismatch' | 'content-changed' | 'missing-in-migrated' | 'new-in-migrated' | 'fixed' | 'regressed' | 'expected-change';
  /**
   * Smart verdict — computed by classifyVerdict() in snapshot-differ.
   * - 'bug'      : genuine regression requiring action (contact mismatch, missing menu, redirect-risk path change)
   * - 'expected' : known migration artifact (domain swap, Wix template links, HTML structure change)
   * - 'info'     : informational / editorial change (content edits, new template sections, minor styling)
   * Optional for backward-compat with old stored comparisons that pre-date this field.
   */
  verdict?: 'bug' | 'expected' | 'info';
  /** Visual evidence: screenshot paths (absolute on disk, converted to web URLs by the server) */
  evidence?: {
    originalScreenshot?: string;
    migratedScreenshot?: string;
  };
  /**
   * Set when the same issue was found on multiple pages and consolidated into one site-wide row.
   * `page` will be 'site-wide' and this array lists every affected page URL.
   */
  affectedPages?: string[];
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
  /** Legacy field — may be absent in actual API responses */
  pages?: Record<string, { url: string; title: string }>;
  'user-content-fields': Array<{ id: number; name: string; content: string; styledContent?: string }>;
  'Live-Site-Status': string;
  /** The Wix template this site is being migrated to — used to auto-detect site type */
  'Target-Theme-Name'?: string;
  /** The original BR template */
  'Current-Theme-Name'?: string;
  /** Navigation structure from the original BR site */
  'user-navigation'?: Array<{
    Title: string;
    Href: string;
    Id?: string;
    Children?: Array<{ Title: string; Href: string; CustomSectionID?: string }>;
  }>;
  /** Business contact info */
  'business-info'?: {
    'business-name'?: string;
    'business-city'?: string;
    'business-zip'?: string;
    'business-street'?: string;
    'business-phone'?: string;
    'business-fax'?: string;
  };
  /** Custom pages / sub-pages */
  'user-custom-pages'?: Array<{
    FieldID: number;
    FieldName: string;
    PageTitle: string;
    'Stripped Title'?: string;
    Href?: string;
    SectionStatus: string;
    navigationStatus: boolean;
    content?: string;
    styledContent?: string;
  }>;
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
  /** Run Chromium in headed (visible) mode for debugging. Implies slowMo. */
  headed?: boolean;
  /** Playwright slowMo in ms — automatically set to 400 when headed is true. */
  slowMo?: number;
  /** Site type for rule filtering. Auto-detected from BR API if not provided. */
  siteType?: 'vanilla' | 'flex' | 'deprecated';
  onProgress?: (message: string, step?: number, total?: number) => void;
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
  /** When true, skip Playwright crawl of original site — build snapshot from BR API data only */
  skipOriginalCrawl?: boolean;
  onProgress?: (message: string, step?: number, total?: number) => void;
}

export interface ScanResult {
  snapshot: SiteSnapshot;
  report: ValidationReport;
}

export type ViewportName = 'desktop' | 'tablet' | 'mobile';
