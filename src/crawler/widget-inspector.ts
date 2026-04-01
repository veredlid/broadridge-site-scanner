import type { Page } from 'playwright';
import type { SliderControlsInfo, MapEmbedInfo } from '../types/index.js';

/**
 * Detects carousels/sliders on the page and checks whether they have
 * prev/next arrow controls and pause/play buttons.
 *
 * Covers the most common implementations found on BR/Wix sites:
 *  - Slick Slider (.slick-prev, .slick-next, .slick-pause)
 *  - Owl Carousel (.owl-prev, .owl-next)
 *  - Swiper (.swiper-button-prev, .swiper-button-next)
 *  - Wix native gallery/slider ([aria-label*="next"], [aria-label*="previous"])
 *  - Generic: buttons inside elements with "slider", "carousel", "slideshow" in class/id
 */
export async function detectSliderControls(page: Page): Promise<SliderControlsInfo[]> {
  return page.evaluate(() => {
    const results: SliderControlsInfo[] = [];

    // Selector for known carousel/slider container elements
    const CONTAINER_SEL = [
      '.slick-slider',
      '.owl-carousel',
      '.swiper-container',
      '.swiper',
      '[class*="slider" i]',
      '[class*="carousel" i]',
      '[class*="slideshow" i]',
      '[id*="slider" i]',
      '[id*="carousel" i]',
    ].join(',');

    const findSection = (el: Element): string => {
      let current: Element | null = el;
      while (current && current !== document.body) {
        const tag = current.tagName?.toLowerCase();
        const role = current.getAttribute('role');
        if (tag === 'header' || role === 'banner') return 'header';
        if (tag === 'footer' || role === 'contentinfo') return 'footer';
        if (tag === 'nav' || role === 'navigation') return 'nav';
        if (tag === 'main' || role === 'main') return 'main';
        if (current.id) return current.id;
        current = current.parentElement;
      }
      return 'page';
    };

    const containers = Array.from(document.querySelectorAll(CONTAINER_SEL));

    // Deduplicate nested containers (keep outermost)
    const topLevel = containers.filter(
      (c) => !containers.some((other) => other !== c && other.contains(c))
    );

    for (const container of topLevel) {
      const style = window.getComputedStyle(container);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      // Prev/next detection
      const prevNextSel = [
        '.slick-prev', '.slick-next',
        '.owl-prev', '.owl-next',
        '.swiper-button-prev', '.swiper-button-next',
        '[aria-label*="previous" i]', '[aria-label*="next" i]',
        '[aria-label*="prev" i]',
        'button[class*="prev" i]', 'button[class*="next" i]',
        'button[class*="arrow" i]',
        '[class*="prev-btn" i]', '[class*="next-btn" i]',
      ].join(',');

      // Pause/play detection
      const pausePlaySel = [
        '.slick-pause', '.slick-play',
        '[aria-label*="pause" i]', '[aria-label*="play" i]',
        'button[class*="pause" i]', 'button[class*="play" i]',
        '[title*="pause" i]', '[title*="play" i]',
      ].join(',');

      const hasPrevNext = container.querySelector(prevNextSel) !== null;
      const hasPausePlay = container.querySelector(pausePlaySel) !== null;

      // Only report if it's actually a slider (has multiple slides)
      const slideCount = container.querySelectorAll(
        '.slick-slide:not(.slick-cloned), .owl-item:not(.cloned), .swiper-slide, [role="group"]'
      ).length;

      if (slideCount < 2 && !hasPrevNext && !hasPausePlay) continue;

      results.push({
        section: findSection(container),
        hasPrevNext,
        hasPausePlay,
      });
    }

    return results;
  });
}

/**
 * Finds all Google Maps iframes on the page and extracts their zoom level
 * from the embed URL's `z=` parameter.
 *
 * Google Maps embeds use URLs like:
 *  https://www.google.com/maps/embed?pb=...
 *  https://maps.google.com/maps?q=...&z=15
 *  https://www.google.com/maps/embed/v1/place?key=...&zoom=15
 */
export async function detectMapEmbeds(page: Page): Promise<MapEmbedInfo[]> {
  return page.evaluate(() => {
    const results: MapEmbedInfo[] = [];

    const findSection = (el: Element): string => {
      let current: Element | null = el;
      while (current && current !== document.body) {
        const tag = current.tagName?.toLowerCase();
        const role = current.getAttribute('role');
        if (tag === 'header' || role === 'banner') return 'header';
        if (tag === 'footer' || role === 'contentinfo') return 'footer';
        if (tag === 'nav' || role === 'navigation') return 'nav';
        if (tag === 'main' || role === 'main') return 'main';
        if (current.id) return current.id;
        current = current.parentElement;
      }
      return 'page';
    };

    const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];

    for (const iframe of iframes) {
      const src = iframe.getAttribute('src') ?? '';
      if (!src.includes('google.com/maps') && !src.includes('maps.google.com')) continue;

      const style = window.getComputedStyle(iframe);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      let zoom: number | null = null;

      // Try `z=15` (classic embed)
      const zMatch = src.match(/[?&]z=(\d+)/);
      if (zMatch) zoom = parseInt(zMatch[1], 10);

      // Try `zoom=15` (Maps Embed API v1)
      if (zoom === null) {
        const zoomMatch = src.match(/[?&]zoom=(\d+)/);
        if (zoomMatch) zoom = parseInt(zoomMatch[1], 10);
      }

      // Try `!2d..!3d..!4d..!5e..!6m..` encoded zoom in pb= parameter (newer embeds)
      // pb=...1z15... where the number after 1z is zoom
      if (zoom === null) {
        const pbMatch = src.match(/1z(\d+)/);
        if (pbMatch) zoom = parseInt(pbMatch[1], 10);
      }

      results.push({
        zoom,
        section: findSection(iframe),
        src: src.substring(0, 300),
      });
    }

    return results;
  });
}
