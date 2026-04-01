import type { Page } from 'playwright';
import type { PageSnapshot } from '../types/index.js';

// ── Wix editor placeholder patterns ────────────────────────────────────────
// These strings should never appear on a published site — they indicate an
// editor field that was never filled in.
const PLACEHOLDER_PATTERNS = [
  // Wix generic text field placeholders
  'Add paragraph text',
  "Click 'Edit Text'",
  'Click "Edit Text"',
  'Add a catchy title',
  'Add a short description',
  'Add subheading',
  'Write a short description',
  // Footer placeholder links — common across all BR templates
  'Footer link 1',
  'Footer link 2',
  'Footer link 3',
  'Footer link 4',
  // Generic template placeholders
  'Business Name',
  'Your name',
  'Your email',
  'Your phone',
  // Lorem ipsum
  'Lorem ipsum',
  // Wix Blog/CMS placeholders
  'Post Title',
  'Add your text here',
  'Item description',
  'This is the space to introduce the Services section',
  'Describe your service here',
];

/**
 * Scans the page for known Wix editor placeholder texts that indicate
 * unfilled template fields. Returns each finding with its text and location.
 */
export async function detectPlaceholderTexts(
  page: Page
): Promise<PageSnapshot['placeholderTexts']> {
  return page.evaluate((patterns: string[]) => {
    const results: Array<{ text: string; location: string }> = [];
    const seen = new Set<string>();

    // Walk all visible text nodes
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const el = node.parentElement;
          if (!el) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          // Skip script/style content
          const tag = el.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const findLocation = (el: Element): string => {
      let current: Element | null = el;
      while (current && current !== document.body) {
        const tag = current.tagName?.toLowerCase();
        const role = current.getAttribute('role');
        if (tag === 'header' || role === 'banner') return 'header';
        if (tag === 'footer' || role === 'contentinfo') return 'footer';
        if (tag === 'nav' || role === 'navigation') return 'nav';
        if (tag === 'main' || role === 'main') return 'main';
        current = current.parentElement;
      }
      return 'page';
    };

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim() ?? '';
      for (const pattern of patterns) {
        if (text.toLowerCase().includes(pattern.toLowerCase())) {
          const key = `${pattern}::${text.substring(0, 60)}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              text: text.substring(0, 100),
              location: findLocation(node.parentElement!),
            });
          }
          break; // one pattern match per text node is enough
        }
      }
    }

    return results;
  }, PLACEHOLDER_PATTERNS);
}

/**
 * Detects CTAs (buttons and links) that are non-functional:
 *  - Empty href (href="")
 *  - Void JavaScript (href="javascript:void(0)")
 *  - Bare hash (href="#") — except when text suggests intentional scroll
 *  - Self-referencing (href === current page URL)
 *  - No href attribute at all on an <a> styled as a button
 *
 * This catches the most common template bug: "Meet John" / "Learn More" / "Read More"
 * buttons that were never wired up to their actual destinations.
 */
export async function detectInvalidCTAs(
  page: Page
): Promise<PageSnapshot['invalidCTAs']> {
  return page.evaluate((pageUrl: string) => {
    const results: Array<{ text: string; href: string | null; section: string; reason: string }> = [];

    const findSection = (el: Element): string => {
      let current: Element | null = el;
      while (current && current !== document.body) {
        const tag = current.tagName?.toLowerCase();
        const role = current.getAttribute('role');
        if (tag === 'header' || role === 'banner') return 'header';
        if (tag === 'footer' || role === 'contentinfo') return 'footer';
        if (tag === 'nav' || role === 'navigation') return 'nav';
        if (tag === 'main' || role === 'main') return 'main';
        current = current.parentElement;
      }
      return 'page';
    };

    // Scroll-intent words that make href="#" acceptable
    const scrollTexts = ['top', 'back', 'scroll', '↑', '▲', '#'];

    // Text patterns that are intentionally JS-driven and must never be flagged as dead CTAs:
    const videoTextPrefixes = [
      // Video player controls (inline JS playback)
      'play video', 'now playing', 'pause video', 'stop video',
      'play:', 'playing:', 'watch video', 'watch now',
    ];

    // Exact texts that are always legitimate despite empty/void href:
    const exemptExactTexts = new Set([
      // Accessibility skip links — keyboard-only navigation helpers
      'skip to main content', 'skip to content', 'skip navigation', 'skip to navigation',
      'skip to main', 'skip to footer',
      // Mobile navigation toggles — JS-driven disclosure widgets
      'menu', 'open menu', 'close menu', 'toggle menu', 'toggle navigation',
      'hamburger', 'nav', 'navigation',
      // Form actions — JS-driven, no href needed
      'submit', 'send', 'send message', 'send inquiry', 'get started',
      'search', 'find', 'go',
      // Back-to-top — handled by dedicated check, not a dead CTA
      'back to top', 'back to the top', 'top', 'go to top', 'scroll to top',
      // Home nav on home page — handled separately via self-reference exemption
    ]);

    // Returns true if the element is inside a video player / media gallery container
    const isInsideVideoContainer = (el: Element): boolean => {
      let current: Element | null = el.parentElement;
      while (current && current !== document.body) {
        const cls = (current.className ?? '').toString().toLowerCase();
        const role = current.getAttribute('role') ?? '';
        const tag = current.tagName?.toLowerCase();
        if (
          cls.includes('video') || cls.includes('player') || cls.includes('media-') ||
          cls.includes('gallery') || tag === 'video' || role === 'application' ||
          current.getAttribute('data-testid')?.includes('video')
        ) return true;
        current = current.parentElement;
      }
      return false;
    };

    // Collect candidates and deduplicate by DOM element reference
    // (multiple selectors can match the same element, e.g. button + [role="button"])
    const seen = new Set<Element>();
    const candidates = Array.from(document.querySelectorAll(
      'a[href], a:not([href]), button:not([type="submit"]):not([type="reset"]), ' +
      '[role="button"], a[class*="button" i], a[class*="cta" i], a[class*="btn" i]'
    )).filter(el => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });

    const currentPath = new URL(pageUrl).pathname;

    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const rawText = el.textContent?.trim() ?? (el as HTMLInputElement).value ?? '';
      const text = rawText.substring(0, 80);
      if (!text) continue;  // No visible text — probably an icon-only element, skip

      // Skip known-legitimate JS-driven elements (video controls, skip links, nav toggles)
      const lowerTextFull = text.toLowerCase();
      if (exemptExactTexts.has(lowerTextFull)) continue;
      if (videoTextPrefixes.some(p => lowerTextFull.startsWith(p))) continue;
      if (isInsideVideoContainer(el)) continue;

      const tag = el.tagName.toLowerCase();
      const href = tag === 'a' ? (el as HTMLAnchorElement).getAttribute('href') : null;
      const section = findSection(el);

      // Case 1: <a> with no href at all
      if (tag === 'a' && href === null) {
        results.push({ text, href: null, section, reason: 'Link has no href — clicking does nothing' });
        continue;
      }

      // Case 2: empty href
      if (href === '' || href === null) {
        results.push({ text, href, section, reason: 'Empty href — link goes nowhere' });
        continue;
      }

      // Case 3: javascript:void
      if (href?.startsWith('javascript:void') || href === 'javascript:;') {
        results.push({ text, href, section, reason: 'href is javascript:void — explicitly disabled' });
        continue;
      }

      // Case 4: bare # — only flag if the text doesn't suggest intentional scroll
      if (href === '#') {
        const lowerText = text.toLowerCase();
        const isIntentionalScroll = scrollTexts.some(t => lowerText.includes(t));
        if (!isIntentionalScroll) {
          results.push({ text, href, section, reason: 'href="#" with no scroll intent — placeholder link' });
        }
        continue;
      }

      // Case 4b: anchor href (e.g. #top, #main) on a link labeled "Home"
      // A "Home" nav item should navigate to the home page (/), not scroll to an anchor.
      if (href?.startsWith('#') && href !== '#') {
        const lowerText = text.toLowerCase();
        const isHomeLabel = lowerText === 'home' || lowerText === 'homepage' || lowerText === 'home page';
        if (isHomeLabel) {
          results.push({ text, href, section, reason: `"Home" nav link scrolls to anchor "${href}" instead of navigating to the home page (/)` });
        }
        continue;
      }

      // Case 5: self-referencing (links back to the exact same page — usually means not wired up)
      // Exemptions: (a) Home nav link on the home page is correct, not a bug
      //             (b) Back-to-top links that go to root instead of #top
      if (href) {
        try {
          const hrefPath = new URL(href, pageUrl).pathname;
          if (hrefPath === currentPath && !href.includes('#')) {
            const lowerText = text.toLowerCase();
            const isHomeNav = (hrefPath === '/' || hrefPath === '') &&
              (lowerText === 'home' || lowerText === 'homepage' || lowerText === 'home page');
            const isBackToTop = scrollTexts.some(t => lowerText.includes(t));
            if (!isHomeNav && !isBackToTop) {
              results.push({ text, href, section, reason: `Link points back to the current page (${currentPath}) — likely not wired up` });
            }
          }
        } catch { /* invalid URL — skip */ }
      }
    }

    return results;
  }, page.url());
}

/**
 * Validates tel: and mailto: links on the page.
 * Flags links where:
 *  - tel: has no phone number (e.g. "tel:" or "tel: ")
 *  - mailto: has no email address (e.g. "mailto:" or "mailto: ")
 *  - The link text says "Phone" or "Email" but href is not a proper tel:/mailto:
 */
export async function detectInvalidContactLinks(
  page: Page
): Promise<PageSnapshot['invalidContactLinks']> {
  return page.evaluate(() => {
    const results: Array<{
      text: string; href: string; type: 'tel' | 'mailto'; reason: string; location: string;
    }> = [];

    const findLocation = (el: Element): string => {
      let current: Element | null = el;
      while (current && current !== document.body) {
        const tag = current.tagName?.toLowerCase();
        const role = current.getAttribute('role');
        if (tag === 'header' || role === 'banner') return 'header';
        if (tag === 'footer' || role === 'contentinfo') return 'footer';
        if (tag === 'nav' || role === 'navigation') return 'nav';
        if (tag === 'main' || role === 'main') return 'main';
        current = current.parentElement;
      }
      return 'page';
    };

    const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];

    for (const link of links) {
      const style = window.getComputedStyle(link);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const href = link.getAttribute('href') ?? '';
      const text = link.textContent?.trim().substring(0, 80) ?? '';
      const location = findLocation(link);

      if (href.startsWith('tel:')) {
        const number = href.replace('tel:', '').replace(/\s/g, '');
        if (!number || number.length < 7) {
          results.push({ text, href, type: 'tel', reason: `Phone link has no valid number: "${href}"`, location });
        }
      } else if (href.startsWith('mailto:')) {
        const email = href.replace('mailto:', '').split('?')[0].trim();
        if (!email || !email.includes('@')) {
          results.push({ text, href, type: 'mailto', reason: `Email link has no valid address: "${href}"`, location });
        }
      } else {
        // Check if link text implies phone/email but href isn't tel:/mailto:
        const lowerText = text.toLowerCase();
        const lowerHref = href.toLowerCase();
        const isPhoneText = /^\+?[\d\s\-().]{7,}$/.test(text); // looks like a phone number
        const isEmailText = text.includes('@') && text.includes('.');

        if (isPhoneText && !lowerHref.startsWith('tel:') && !lowerHref.startsWith('http')) {
          results.push({ text, href, type: 'tel', reason: `Phone number text ("${text}") but href is not a tel: link`, location });
        }
        if (isEmailText && !lowerHref.startsWith('mailto:') && !lowerHref.startsWith('http')) {
          results.push({ text, href, type: 'mailto', reason: `Email address text ("${text}") but href is not a mailto: link`, location });
        }
      }
    }

    return results;
  });
}
