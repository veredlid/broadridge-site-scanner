import type { ViewportName } from './types/index.js';

export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
} as const;

export const SECTION_IDS = [
  'headerContainer',
  'navigationContainer',
  'heroContainer',
  'mediaContainer',
  'contentContainer',
  'videoContainer',
  'cn_container',
  'mapContainer',
  'bottomNavigationContainer',
  'footerContainer',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export const SUB_ELEMENT_SELECTORS = {
  navMenu: '.nav-1st-level ul[role="menu"]',
  navSubItem: '.nav-1st-level',
  calloutItem: (n: number) => `div[class*="item col _${n}"]`,
  calloutButton: 'button, a.btn, a[class*="button"]',
  socialLinks: 'a[href*="facebook"], a[href*="linkedin"], a[href*="twitter"], a[href*="x.com"], a[href*="instagram"], a[href*="youtube"]',
  mapIframe: 'iframe[src*="google.com/maps"]',
  disclaimer: 'table[class="disclaimer-text"]',
  disclaimerAccept: 'a[href*="disclaimer=accept"]',
  splashPage: 'body[id="splashPage"]',
  splashSkip: 'a[href*="skipspash=1"], a[href*="skipsplash=1"]',
} as const;

export const PROHIBITED_FORMS = [
  'request-quote',
  'tell-friend',
  'p-and-c',
] as const;

export const PROHIBITED_MENU_ITEMS = [
  'flipbooks',
  'request a quote',
  'blog',
  'events',
  'site map',
] as const;

export const THRESHOLDS = {
  minMobileFontSize: 12,
  minPaddingPercent: 3,
  sectionHeightTolerance: 0.3,
  mapHeightTolerance: 0.2,
  textImageMinGapPx: 5,
  linkTimeout: 10_000,
  pageTimeout: 30_000,
  linkBatchSize: 10,
  ctaWaitMs: 2000,
} as const;

export const SOCIAL_PLATFORMS = [
  'facebook',
  'linkedin',
  'twitter',
  'x.com',
  'instagram',
  'youtube',
] as const;

export const BR_SOURCE_API = 'https://bo.wix.com/_api/broadridge-source/v1/sites';

export const FLEXXML_FIELD_IDS = [351, 999];
