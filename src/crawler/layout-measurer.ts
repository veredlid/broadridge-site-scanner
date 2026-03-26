import type { Page } from 'playwright';
import type { ViewportMetrics } from '../types/index.js';
import { THRESHOLDS } from '../config.js';

export async function measureLayout(page: Page): Promise<ViewportMetrics> {
  const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };

  const metrics = await page.evaluate((thresholds) => {
    const docEl = document.documentElement;
    const hasHorizontalScroll = docEl.scrollWidth > docEl.clientWidth;

    let smallestFontSize = Infinity;
    let smallestFontElement = '';

    const textOverflows: Array<{ element: string; text: string }> = [];
    const paddingIssues: Array<{
      element: string;
      paddingPx: number;
      viewportWidthPx: number;
      paddingPercent: number;
      threshold: number;
    }> = [];

    const textElements = document.querySelectorAll(
      'p, span, h1, h2, h3, h4, h5, h6, li, td, th, a, label, div'
    );

    for (const el of textElements) {
      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);

      if (fontSize > 0 && fontSize < smallestFontSize && el.textContent?.trim()) {
        smallestFontSize = fontSize;
        smallestFontElement = el.tagName.toLowerCase() +
          (el.className && typeof el.className === 'string'
            ? `.${el.className.trim().split(/\s+/)[0]}`
            : '');
      }

      if (el.scrollWidth > el.clientWidth + 2 && el.textContent?.trim()) {
        textOverflows.push({
          element: el.tagName.toLowerCase(),
          text: (el.textContent?.trim() ?? '').substring(0, 80),
        });
      }
    }

    const sections = document.querySelectorAll('[id$="Container"], #cn_container');
    const vw = docEl.clientWidth;

    for (const section of sections) {
      const style = window.getComputedStyle(section);
      const paddingLeft = parseFloat(style.paddingLeft);
      const paddingRight = parseFloat(style.paddingRight);

      for (const [side, px] of [['left', paddingLeft], ['right', paddingRight]] as const) {
        const pct = (px / vw) * 100;
        if (pct < thresholds.minPaddingPercent && px > 0) {
          paddingIssues.push({
            element: `#${section.id} (${side})`,
            paddingPx: Math.round(px),
            viewportWidthPx: vw,
            paddingPercent: Math.round(pct * 100) / 100,
            threshold: thresholds.minPaddingPercent,
          });
        }
      }
    }

    return {
      hasHorizontalScroll,
      smallestFontSize: smallestFontSize === Infinity ? 0 : smallestFontSize,
      smallestFontElement,
      textOverflows: textOverflows.slice(0, 20),
      paddingIssues,
    };
  }, THRESHOLDS);

  return {
    viewport,
    ...metrics,
  };
}
