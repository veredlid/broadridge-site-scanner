import { Check, CheckGroup } from './shared';
import type { SiteSnapshot, ValidationResult } from './shared';

export function ChecklistTab({ snapshot, results }: { snapshot: SiteSnapshot | null; results: ValidationResult[] }) {
  if (!snapshot) return <p className="text-[var(--text-muted)] text-sm py-8 text-center">No snapshot data available.</p>;

  const siteWide = results.filter(r => r.page === 'site-wide');
  const rule = (pageUrl: string, ruleId: string) =>
    results.find(r => (r.page === pageUrl || r.page === pageUrl + '/') && r.ruleId === ruleId);
  const ruleByCategory = (pageUrl: string, category: string) =>
    results.filter(r => r.page === pageUrl && r.category === category && !r.passed);

  return (
    <div>
      {siteWide.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3 pb-1 border-b border-[var(--border)]">
            🌐 Site-wide
          </h3>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            {siteWide.map((r, i) => (
              <Check key={i} ok={r.passed} label={r.ruleName} detail={r.message} severity={r.severity} />
            ))}
          </div>
        </div>
      )}

      {snapshot.pages.map((page) => {
        const section = (id: string) => page.sections.find(s => s.id === id);
        const header = section('headerContainer');
        const hero = section('heroContainer');
        const footer = section('footerContainer');
        const mapSec = section('mapContainer');
        const menuItems = page.menu.items;
        const menuText = menuItems.length > 0 ? menuItems.map(i => i.text).join(' | ') : null;

        const visibleCtas = page.ctas.filter(c => c.isVisible && c.type !== 'submit');
        const deadCtas = visibleCtas.filter(c => !c.href && !c.navigatesTo);
        const brokenLinks = page.links.filter(l => l.httpStatus !== null && l.httpStatus >= 400);

        const v58 = rule(page.url, 'V58');
        const v59 = rule(page.url, 'V59');
        const v60 = rule(page.url, 'V60');
        const v61 = rule(page.url, 'V61');
        const v63 = rule(page.url, 'V63');
        const brokenLinkRule = ruleByCategory(page.url, 'Links');
        const prohibitedMenu = ruleByCategory(page.url, 'Menu');
        const prohibitedForms = ruleByCategory(page.url, 'Forms');
        const mobileIssues = ruleByCategory(page.url, 'Mobile');

        return (
          <div key={page.url} className="mb-8">
            <h3 className="text-base font-bold mb-3 pb-2 border-b border-[var(--border)] flex items-center gap-2">
              <span className="text-[var(--text-muted)]">📄</span>
              <span>{page.title}</span>
              <code className="text-xs text-[var(--text-muted)] font-normal">{page.url}</code>
            </h3>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <div>
                <CheckGroup title="Structure">
                  <Check ok={v58 ? v58.passed : (header?.isPresent ?? false)} label="Header present" severity="critical" />
                  <Check ok={v61 ? v61.passed : ((header?.imageCount ?? 0) > 0 || (header?.textContent?.trim().length ?? 0) > 0)}
                    label="Company logo / name in header"
                    detail={(header?.imageCount ?? 0) > 0 ? `${header!.imageCount} image(s)` : undefined}
                    severity="major" />
                  <Check ok={menuItems.length > 0} label="Navigation menu" detail={menuText ?? 'no menu items found'} severity="critical" />
                  {menuItems.filter(i => i.hasDropdown).map(item => (
                    <Check key={item.text} ok={item.subItems.length > 0} label={`  ↳ ${item.text} dropdown`}
                      detail={item.subItems.map(s => s.text).join(', ')} severity="major" />
                  ))}
                  <Check ok={hero?.isPresent ?? false} label="Hero section" severity="major" />
                  {mapSec && <Check ok={mapSec.isPresent} label="Map section" severity="minor" />}
                </CheckGroup>

                <CheckGroup title="Footer">
                  <Check ok={footer?.isPresent ?? false} label="Footer present" severity="critical" />
                  <Check ok={v59 ? v59.passed : null} label="Compliance disclaimer" severity="critical" />
                  <Check ok={v63 ? v63.passed : null} label="Back-to-top CTA" severity="minor" />
                </CheckGroup>
              </div>

              <div>
                <CheckGroup title="Compliance">
                  <Check ok={prohibitedMenu.length === 0} label="No prohibited menu items"
                    detail={prohibitedMenu.length > 0 ? prohibitedMenu.map(r => r.message).join('; ') : undefined} severity="critical" />
                  <Check ok={prohibitedForms.length === 0} label="No prohibited forms"
                    detail={prohibitedForms.length > 0 ? prohibitedForms.map(r => r.message).join('; ') : undefined} severity="critical" />
                  <Check ok={brokenLinks.length === 0} label="No broken links"
                    detail={brokenLinks.length > 0
                      ? `${brokenLinks.length} broken: ${brokenLinks.map(l => l.href).join(', ').slice(0, 80)}`
                      : `${page.links.length} links checked`}
                    severity={brokenLinkRule.length > 0 ? 'critical' : 'major'} />
                  <Check ok={deadCtas.length === 0} label="All CTAs have destinations"
                    detail={deadCtas.length > 0
                      ? `${deadCtas.length} dead: ${deadCtas.map(c => `"${c.text}"`).join(', ')}`
                      : `${visibleCtas.length} CTA(s) verified`}
                    severity="major" />
                </CheckGroup>

                <CheckGroup title="Consistency">
                  {page.url !== '/' ? (
                    <Check ok={v60 ? v60.passed : null} label="Nav menu matches home page" severity="major" />
                  ) : (
                    <Check ok={null} label="Nav menu (reference page)" />
                  )}
                  {mobileIssues.length > 0 ? (
                    mobileIssues.map((r, i) => <Check key={i} ok={false} label={r.ruleName} detail={r.message} severity={r.severity} />)
                  ) : (
                    <Check ok={true} label="No mobile layout issues" severity="minor" />
                  )}
                </CheckGroup>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
