import type { Page } from 'playwright';

export interface AccessibilityAudit {
  images: Array<{
    src: string;
    alt: string | null;
    ariaLabel: string | null;
    hasAlt: boolean;
  }>;
  links: Array<{
    text: string;
    href: string;
    ariaLabel: string | null;
  }>;
  headings: Array<{
    tag: string;      // 'h1', 'h2', 'h3', etc.
    text: string;
    ariaLabel: string | null;
  }>;
  formElements: Array<{
    tag: string;      // 'input', 'button', 'select', 'textarea'
    type: string | null;
    ariaLabel: string | null;
    placeholder: string | null;
  }>;
}

export async function extractAccessibilityData(page: Page): Promise<AccessibilityAudit> {
  const limits = { images: 50, links: 100, headings: 30, formElements: 30 };

  const result = await page.evaluate((args) => {
    const { maxImages, maxLinks, maxHeadings, maxFormElements } = args;

    // Images
    const imgEls = Array.from(document.querySelectorAll('img')).slice(0, maxImages);
    const images = imgEls.map(function(img) {
      var alt = img.getAttribute('alt');
      var ariaLabel = img.getAttribute('aria-label');
      return {
        src: img.src || img.getAttribute('src') || '',
        alt: alt !== null && alt !== '' ? alt : null,
        ariaLabel: ariaLabel !== null && ariaLabel !== '' ? ariaLabel : null,
        hasAlt: img.hasAttribute('alt') && alt !== null,
      };
    });

    // Links — only those with aria-label OR inside nav/header
    var linkEls = Array.from(document.querySelectorAll('a[href]'));
    var filteredLinks = linkEls.filter(function(a) {
      if (a.getAttribute('aria-label')) return true;
      var el = a.parentElement;
      while (el) {
        var tag = el.tagName;
        if (tag === 'NAV' || tag === 'HEADER') return true;
        el = el.parentElement;
      }
      return false;
    }).slice(0, maxLinks);

    var links = filteredLinks.map(function(a) {
      var ariaLabel = a.getAttribute('aria-label');
      return {
        text: (a.textContent || '').trim().slice(0, 200),
        href: (a as HTMLAnchorElement).href || a.getAttribute('href') || '',
        ariaLabel: ariaLabel !== null && ariaLabel !== '' ? ariaLabel : null,
      };
    });

    // Headings
    var headingEls = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).slice(0, maxHeadings);
    var headings = headingEls.map(function(h) {
      var ariaLabel = h.getAttribute('aria-label');
      return {
        tag: h.tagName.toLowerCase(),
        text: (h.textContent || '').trim().slice(0, 200),
        ariaLabel: ariaLabel !== null && ariaLabel !== '' ? ariaLabel : null,
      };
    });

    // Form elements
    var formEls = Array.from(document.querySelectorAll('input,button,select,textarea')).slice(0, maxFormElements);
    var formElements = formEls.map(function(el) {
      var ariaLabel = el.getAttribute('aria-label');
      var placeholder = el.getAttribute('placeholder');
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        ariaLabel: ariaLabel !== null && ariaLabel !== '' ? ariaLabel : null,
        placeholder: placeholder !== null && placeholder !== '' ? placeholder : null,
      };
    });

    return { images, links, headings, formElements };
  }, {
    maxImages: limits.images,
    maxLinks: limits.links,
    maxHeadings: limits.headings,
    maxFormElements: limits.formElements,
  });

  return result as AccessibilityAudit;
}
