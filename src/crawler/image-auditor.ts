import type { Page } from 'playwright';
import type { ImageInfo } from '../types/index.js';
import { SECTION_IDS } from '../config.js';

export async function auditImages(page: Page): Promise<ImageInfo[]> {
  // NOTE: Use page.evaluate() + document.querySelectorAll() — NOT page.$$eval() — to avoid
  // a tsx/esbuild serialisation bug where named functions get __name-wrapped and the browser
  // context throws "ReferenceError: __name is not defined".
  return page.evaluate(({ sectionIds }: { sectionIds: string[] }) => {
    const images = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];

    const findSection = (el: Element): string => {
      let current: Element | null = el;
      while (current) {
        if (current.id && sectionIds.includes(current.id)) {
          return current.id;
        }
        current = current.parentElement;
      }
      return 'unknown';
    };

    return images.map((img) => {
      const rect = img.getBoundingClientRect();
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
      const displayW = Math.round(rect.width);
      const displayH = Math.round(rect.height);
      const isLoaded = naturalW > 0 && naturalH > 0;

      const naturalRatio = naturalW / (naturalH || 1);
      const displayRatio = displayW / (displayH || 1);
      const isDistorted = isLoaded && Math.abs(naturalRatio - displayRatio) / naturalRatio > 0.05;

      const parentAnchor = img.closest('a');

      return {
        src: img.src,
        alt: img.alt || '',
        naturalWidth: naturalW,
        naturalHeight: naturalH,
        displayWidth: displayW,
        displayHeight: displayH,
        isLoaded,
        isUpscaled: isLoaded && displayW > naturalW,
        isDistorted,
        hasLink: parentAnchor !== null,
        linkHref: parentAnchor?.href ?? null,
        section: findSection(img),
      };
    });
  }, { sectionIds: [...SECTION_IDS] as string[] });
}
