import type { Page } from 'playwright';
import type { FormInfo } from '../types/index.js';
import { SECTION_IDS, PROHIBITED_FORMS } from '../config.js';

export async function detectForms(page: Page): Promise<FormInfo[]> {
  const forms = await page.$$eval(
    'form',
    (formElements, sectionIds) => {
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

      return formElements.map((form) => {
        const fields = Array.from(form.querySelectorAll('input, select, textarea'))
          .map((field: Element) => {
            return field.getAttribute('name') ||
              field.getAttribute('placeholder') ||
              field.getAttribute('aria-label') ||
              '';
          })
          .filter(Boolean);

        const allText = form.textContent?.toLowerCase() ?? '';
        const style = window.getComputedStyle(form);

        let formType = 'unknown';
        if (allText.includes('request a quote') || allText.includes('request quote')) {
          formType = 'request-quote';
        } else if (allText.includes('tell a friend') || allText.includes('tell-a-friend')) {
          formType = 'tell-friend';
        } else if (allText.includes('p&c') || allText.includes('property') || allText.includes('casualty')) {
          formType = 'p-and-c';
        } else if (allText.includes('newsletter') || allText.includes('subscribe')) {
          formType = 'newsletter';
        } else if (allText.includes('contact')) {
          formType = 'contact-us';
        }

        return {
          formType: formType as FormInfo['formType'],
          action: form.action || '',
          fields,
          section: findSection(form),
          isVisible: style.display !== 'none' && style.visibility !== 'hidden',
          hasSubmitButton: form.querySelector('button[type="submit"], input[type="submit"]') !== null,
        };
      });
    },
    [...SECTION_IDS] as string[]
  );

  return forms;
}

export function findProhibitedForms(forms: FormInfo[]): FormInfo[] {
  return forms.filter(
    (f) => f.isVisible && (PROHIBITED_FORMS as readonly string[]).includes(f.formType)
  );
}
