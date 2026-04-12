import { writeFileSync } from 'fs';
import type { MenuCheckResult, MenuItemIssue, IssueKind, MenuSectionSummary } from './menu-checker.js';
import type { ContentCheckResult, ContentMismatch } from './content-checker.js';
import type { SiteHealthResult, BrokerCheckResult, DomainCheckResult, TemplateSocialResult, ImageValidationResult, TemplateSubtitleResult } from './site-health-checker.js';

function kindLabel(kind: IssueKind): string {
  switch (kind) {
    case 'missing':          return '❌ Missing';
    case 'broken-link':      return '🔴 Broken Link';
    case 'duplicate':        return '🔁 Duplicate';
    case 'href-mismatch':    return '🔗 Href Mismatch';
    case 'structure-change': return '🔀 Structure Change';
    case 'extra':            return '➕ Extra';
    case 'ok':               return '✅ OK';
  }
}

function kindClass(kind: IssueKind): string {
  switch (kind) {
    case 'missing':          return 'missing';
    case 'broken-link':      return 'broken';
    case 'duplicate':        return 'duplicate';
    case 'href-mismatch':    return 'href-mismatch';
    case 'structure-change': return 'structure';
    case 'extra':            return 'extra';
    case 'ok':               return 'ok';
  }
}

function renderIssueRow(issue: MenuItemIssue, indent = 0): string {
  const indentPx = indent * 24;
  const cls = kindClass(issue.kind);
  const badge = kindLabel(issue.kind);
  const brPart = issue.brTitle
    ? `<span class="label">Source:</span> <code>${issue.brTitle}</code> <span class="path">${issue.brHref ?? ''}</span>`
    : '';
  const wixPart = issue.migratedText
    ? `<span class="label">Migrated:</span> <code>${issue.migratedText}</code> <span class="path">${issue.migratedPath ?? ''}</span>${issue.httpStatus !== undefined ? ` <span class="http http-${issue.httpStatus}">${issue.httpStatus}</span>` : ''}`
    : '';
  const note = issue.note ? `<div class="note">${issue.note}</div>` : '';

  const subRows = (issue.subIssues ?? [])
    .map((s) => renderIssueRow(s, indent + 1))
    .join('');

  return `
    <tr class="row-${cls}" style="--indent:${indentPx}px">
      <td class="badge-cell"><span class="badge badge-${cls}">${badge}</span></td>
      <td class="detail-cell" style="padding-left:calc(16px + ${indentPx}px)">
        ${brPart}
        ${brPart && wixPart ? '<br>' : ''}
        ${wixPart}
        ${note}
      </td>
    </tr>
    ${subRows}
  `;
}

const BUG_KINDS: IssueKind[] = ['missing', 'broken-link', 'duplicate', 'href-mismatch'];

/**
 * Collect all items for the bugs section:
 * - Top-level bug items (kind = missing | broken-link)
 * - Top-level ok/structure items that have bug sub-issues
 *   (rendered showing only bug sub-issues so they're visible)
 *
 * Note: the same item text may appear more than once if it exists in multiple
 * locations on the source site (e.g. both as top-level AND as a sub-item).
 * Each occurrence is a separate missing bug and is shown separately.
 */
function collectBugItems(issues: MenuItemIssue[]): MenuItemIssue[] {
  const result: MenuItemIssue[] = [];
  for (const issue of issues) {
    if (BUG_KINDS.includes(issue.kind)) {
      result.push(issue);
    } else if (issue.subIssues?.some((s) => BUG_KINDS.includes(s.kind))) {
      // Parent matched but has bug children — show parent with only bug sub-issues
      result.push({
        ...issue,
        subIssues: issue.subIssues.filter((s) => BUG_KINDS.includes(s.kind)),
      });
    }
  }
  return result;
}

function renderSection(title: string, items: MenuItemIssue[], open = true, bugMode = false): string {
  const displayItems = bugMode ? collectBugItems(items) : items.filter((i) => !BUG_KINDS.includes(i.kind) || true);
  if (displayItems.length === 0) return '';
  // For bug mode, count the actual number of bug issues (including sub-issues)
  const bugCount = bugMode
    ? items.filter((i) => BUG_KINDS.includes(i.kind)).length +
      items.flatMap((i) => i.subIssues ?? []).filter((s) => BUG_KINDS.includes(s.kind)).length
    : displayItems.length;
  const rows = displayItems.map((i) => renderIssueRow(i)).join('');
  return `
    <details ${open ? 'open' : ''}>
      <summary class="section-title">${title} <span class="count">${bugCount}</span></summary>
      <table class="issue-table">
        <tbody>${rows}</tbody>
      </table>
    </details>
  `;
}

function renderSummaryCards(summary: MenuSectionSummary, sourceName: string): string {
  return `
    <div class="summary-grid">
      <div class="summary-card"><div class="num">${summary.totalSourceItems}</div><div class="lbl">${sourceName} Items</div></div>
      <div class="summary-card"><div class="num">${summary.totalMigratedItems}</div><div class="lbl">Migrated Items</div></div>
      <div class="summary-card"><div class="num ${summary.missing > 0 ? 'num-red' : 'num-green'}">${summary.missing}</div><div class="lbl">Missing</div></div>
      <div class="summary-card"><div class="num ${summary.brokenLinks > 0 ? 'num-red' : 'num-green'}">${summary.brokenLinks}</div><div class="lbl">Broken Links</div></div>
      <div class="summary-card"><div class="num ${summary.duplicates > 0 ? 'num-red' : 'num-green'}">${summary.duplicates}</div><div class="lbl">Duplicates</div></div>
      <div class="summary-card"><div class="num ${summary.hrefMismatches > 0 ? 'num-red' : 'num-green'}">${summary.hrefMismatches}</div><div class="lbl">Href Mismatches</div></div>
      <div class="summary-card"><div class="num ${summary.structureChanges > 0 ? 'num-blue' : 'num-green'}">${summary.structureChanges}</div><div class="lbl">Structure Changes</div></div>
      <div class="summary-card"><div class="num ${summary.extra > 0 ? 'num-blue' : 'num-green'}">${summary.extra}</div><div class="lbl">Extra Items</div></div>
    </div>
  `;
}

function bugCount(summary: MenuSectionSummary): number {
  return summary.missing + summary.brokenLinks + summary.duplicates + summary.hrefMismatches;
}

function sectionStatusColor(summary: MenuSectionSummary): string {
  if (bugCount(summary) > 0) return '#d32f2f';
  if (summary.structureChanges > 0) return '#1565c0';
  return '#2e7d32';
}

function sectionStatusLabel(summary: MenuSectionSummary): string {
  if (bugCount(summary) > 0) return 'BUGS FOUND';
  if (summary.structureChanges > 0) return 'STRUCTURE CHANGES';
  return 'PASS';
}

function renderContentCheck(contentCheck: ContentCheckResult | undefined, originalDomain: string): string {
  if (!contentCheck) return '';

  const { originalIdentity, migratedIdentity, mismatches, error } = contentCheck;

  if (error || !originalIdentity || !migratedIdentity) {
    return `
      <div class="part">
        <div class="part-header">
          <div>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="part-badge badge-skip">PART 3</span>
              <span class="part-title">Content Identity Check</span>
              <span class="part-status" style="background:#757575">SKIPPED</span>
            </div>
            <div class="part-subtitle" style="margin-top:6px">
              Compares company name, phone, email, address, and person names between sites
            </div>
          </div>
        </div>
        <div class="part-body">
          <div class="skipped-notice">⚠ ${error ?? 'Identity data unavailable'}</div>
        </div>
      </div>`;
  }

  const criticalCount = mismatches.filter((m) => m.severity === 'critical').length;
  const warningCount = mismatches.filter((m) => m.severity === 'warning').length;
  const p3Color = criticalCount > 0 ? '#d32f2f' : warningCount > 0 ? '#e65100' : '#2e7d32';
  const p3Label = criticalCount > 0 ? 'MISMATCH' : warningCount > 0 ? 'WARNINGS' : 'PASS';
  const badgeClass = criticalCount > 0 ? 'badge-bug' : warningCount > 0 ? 'badge-warn' : 'badge-pass';

  const renderIdentity = (identity: typeof originalIdentity, label: string) => `
    <div class="raw-nav-box">
      <h3>${label}</h3>
      <div style="font-size:12px;line-height:1.8">
        <div><strong>Page Title:</strong> ${escHtml(identity.pageTitle || '(none)')}</div>
        <div><strong>Company Names:</strong> ${identity.companyNames.length > 0 ? identity.companyNames.map(escHtml).join(', ') : '<span class="muted">(none found)</span>'}</div>
        <div><strong>Phone Numbers:</strong> ${identity.phoneNumbers.length > 0 ? identity.phoneNumbers.map(escHtml).join(', ') : '<span class="muted">(none found)</span>'}</div>
        <div><strong>Emails:</strong> ${identity.emailAddresses.length > 0 ? identity.emailAddresses.map(escHtml).join(', ') : '<span class="muted">(none found)</span>'}</div>
        <div><strong>Person Names:</strong> ${identity.personNames.length > 0 ? identity.personNames.map(escHtml).join(', ') : '<span class="muted">(none found)</span>'}</div>
        <div><strong>Addresses:</strong> ${identity.physicalAddresses.length > 0 ? identity.physicalAddresses.map(escHtml).join('; ') : '<span class="muted">(none found)</span>'}</div>
      </div>
    </div>`;

  const mismatchRows = mismatches.map((m) => {
    const sevBadge = m.severity === 'critical'
      ? '<span class="badge badge-missing">🚨 CRITICAL</span>'
      : '<span class="badge badge-duplicate">⚠ WARNING</span>';
    const fieldLabel: Record<string, string> = {
      'company-name': 'Company Name',
      'phone': 'Phone Number',
      'email': 'Email Address',
      'address': 'Physical Address',
      'person-name': 'Person Name',
      'footer': 'Footer Content',
    };
    return `
      <tr>
        <td class="badge-cell">${sevBadge}</td>
        <td style="padding:10px 16px; font-weight:600">${fieldLabel[m.field] ?? m.field}</td>
        <td style="padding:10px 16px">
          <div><span class="label">Original:</span> <code>${escHtml(m.originalValue.substring(0, 120))}</code></div>
          <div><span class="label">Migrated:</span> <code>${escHtml(m.migratedValue.substring(0, 120))}</code></div>
          <div class="note">${escHtml(m.note)}</div>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="part">
      <div class="part-header">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="part-badge ${badgeClass}">PART 3</span>
            <span class="part-title">Content Identity Check</span>
            <span class="part-status" style="background:${p3Color}">${p3Label}</span>
          </div>
          <div class="part-subtitle" style="margin-top:6px">
            Compares company name, phone, email, address, and person names between <strong>${escHtml(originalDomain)}</strong> and migrated site
            &nbsp;·&nbsp; Answers: <em>"Is the migrated site showing the correct company's information?"</em>
          </div>
        </div>
      </div>
      <div class="part-body">
        <div class="summary-grid">
          <div class="summary-card"><div class="num ${criticalCount > 0 ? 'num-red' : 'num-green'}">${criticalCount}</div><div class="lbl">Critical Mismatches</div></div>
          <div class="summary-card"><div class="num ${warningCount > 0 ? 'num-orange' : 'num-green'}">${warningCount}</div><div class="lbl">Warnings</div></div>
          <div class="summary-card"><div class="num">${originalIdentity.phoneNumbers.length}</div><div class="lbl">Original Phones</div></div>
          <div class="summary-card"><div class="num">${migratedIdentity.phoneNumbers.length}</div><div class="lbl">Migrated Phones</div></div>
          <div class="summary-card"><div class="num">${originalIdentity.personNames.length}</div><div class="lbl">Original Names</div></div>
          <div class="summary-card"><div class="num">${migratedIdentity.personNames.length}</div><div class="lbl">Migrated Names</div></div>
        </div>

        <div class="raw-nav">
          ${renderIdentity(originalIdentity, 'Original Site Identity')}
          ${renderIdentity(migratedIdentity, 'Migrated Site Identity')}
        </div>

        ${mismatches.length > 0 ? `
          <details open>
            <summary class="section-title">🚨 Content Mismatches <span class="count">${mismatches.length}</span></summary>
            <table class="issue-table"><tbody>${mismatchRows}</tbody></table>
          </details>
        ` : `
          <div style="padding:20px;text-align:center;color:#2e7d32;font-weight:600">
            ✓ All identity markers match between original and migrated sites
          </div>
        `}
      </div>
    </div>`;
}

function renderTemplateSocial(result: TemplateSocialResult | undefined): string {
  if (!result) return '';
  const badge = result.severity === 'ok' ? 'badge-pass' : 'badge-fail';
  const color = result.severity === 'ok' ? '#2e7d32' : '#c62828';
  const label = result.severity === 'ok' ? 'PASS' : `${result.templateCount} TEMPLATE`;
  return `
    <div class="part">
      <div class="part-header">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="part-badge ${badge}">PART 6</span>
            <span class="part-title">Template Social Links</span>
            <span class="part-status" style="background:${color}">${escHtml(label)}</span>
          </div>
          <div class="part-subtitle" style="margin-top:6px">
            Detects social media links pointing to generic/template URLs
          </div>
        </div>
      </div>
      <div class="part-body">
        <div class="summary-grid">
          <div class="summary-card"><div class="num">${result.totalCount}</div><div class="lbl">Social Links</div></div>
          <div class="summary-card"><div class="num ${result.templateCount > 0 ? 'num-red' : 'num-green'}">${result.templateCount}</div><div class="lbl">Template/Default</div></div>
        </div>
        ${result.links.length > 0 ? `
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
            <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ddd">Platform</th><th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ddd">URL</th><th style="padding:6px 10px;text-align:center;border-bottom:2px solid #ddd">Status</th></tr></thead>
            <tbody>
              ${result.links.map((l) => `
                <tr style="border-bottom:1px solid #eee">
                  <td style="padding:6px 10px">${escHtml(l.platform)}</td>
                  <td style="padding:6px 10px;word-break:break-all;max-width:400px"><a href="${escHtml(l.href)}" target="_blank">${escHtml(l.href.length > 60 ? l.href.substring(0, 60) + '...' : l.href)}</a></td>
                  <td style="padding:6px 10px;text-align:center">${l.isTemplate ? '<span style="color:#c62828;font-weight:600">&#10007; Template</span>' : '<span style="color:#2e7d32">&#10003; OK</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : '<div style="padding:8px;color:#888">No social media links found</div>'}
      </div>
    </div>`;
}

function renderImageValidation(result: ImageValidationResult | undefined): string {
  if (!result) return '';
  const badge = result.severity === 'ok' ? 'badge-pass' : result.severity === 'critical' ? 'badge-fail' : 'badge-warn';
  const color = result.severity === 'ok' ? '#2e7d32' : result.severity === 'critical' ? '#c62828' : '#e65100';
  const label = result.severity === 'ok' ? 'PASS' : `${result.issues.length} ISSUE${result.issues.length !== 1 ? 'S' : ''}`;
  return `
    <div class="part">
      <div class="part-header">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="part-badge ${badge}">PART 7</span>
            <span class="part-title">BR JSON Image URLs</span>
            <span class="part-status" style="background:${color}">${escHtml(label)}</span>
          </div>
          <div class="part-subtitle" style="margin-top:6px">
            Validates image src paths in BR source JSON (double slashes, missing prefixes)
          </div>
        </div>
      </div>
      <div class="part-body">
        <div class="summary-grid">
          <div class="summary-card"><div class="num">${result.totalImages}</div><div class="lbl">Images Scanned</div></div>
          <div class="summary-card"><div class="num ${result.issues.length > 0 ? 'num-red' : 'num-green'}">${result.issues.length}</div><div class="lbl">Issues Found</div></div>
        </div>
        ${result.issues.length > 0 ? `
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
            <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ddd">Field</th><th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ddd">Issue</th><th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ddd">Details</th></tr></thead>
            <tbody>
              ${result.issues.map((i) => `
                <tr style="border-bottom:1px solid #eee">
                  <td style="padding:6px 10px">${escHtml(i.fieldName)}</td>
                  <td style="padding:6px 10px"><span style="background:#fce4ec;color:#c62828;padding:2px 6px;border-radius:3px;font-size:11px">${escHtml(i.issue)}</span></td>
                  <td style="padding:6px 10px;word-break:break-all;max-width:400px">${escHtml(i.details)}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : '<div style="padding:8px;color:#2e7d32">&#10003; All image URLs look valid</div>'}
      </div>
    </div>`;
}

function renderTemplateSubtitle(result: TemplateSubtitleResult | undefined): string {
  if (!result) return '';
  const badge = result.severity === 'ok' ? 'badge-pass' : 'badge-fail';
  const color = result.severity === 'ok' ? '#2e7d32' : '#c62828';
  const label = result.isTemplate ? 'TEMPLATE DETECTED' : 'PASS';
  return `
    <div class="part">
      <div class="part-header">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="part-badge ${badge}">PART 8</span>
            <span class="part-title">Subtitle / Tagline</span>
            <span class="part-status" style="background:${color}">${escHtml(label)}</span>
          </div>
          <div class="part-subtitle" style="margin-top:6px">
            Checks if the hero subtitle still shows template default text
          </div>
        </div>
      </div>
      <div class="part-body">
        ${result.found ? `
          <div style="padding:12px 16px;background:${result.isTemplate ? '#fce4ec' : '#e8f5e9'};border:1px solid ${result.isTemplate ? '#ef9a9a' : '#a5d6a7'};border-radius:6px;font-size:14px">
            ${result.isTemplate
              ? `<span style="color:#c62828;font-weight:600">&#10007;</span> Template subtitle: <strong>"${escHtml(result.migratedSubtitle)}"</strong>`
              : `<span style="color:#2e7d32;font-weight:600">&#10003;</span> Subtitle: "${escHtml(result.migratedSubtitle.substring(0, 120))}"`
            }
          </div>` : '<div style="padding:8px;color:#888">No hero subtitle found on page</div>'}
      </div>
    </div>`;
}

function renderSiteHealth(siteHealth: SiteHealthResult | undefined): string {
  if (!siteHealth) return '';

  const { brokerCheck, domainCheck } = siteHealth;

  // Part 4: BrokerCheck
  const p4Color = !brokerCheck.found ? '#757575'
    : brokerCheck.severity === 'ok' ? '#2e7d32'
    : brokerCheck.severity === 'critical' ? '#d32f2f' : '#e65100';
  const p4Label = !brokerCheck.found ? 'NOT FOUND'
    : brokerCheck.severity === 'ok' ? 'PASS (SVG)'
    : brokerCheck.severity === 'critical' ? 'WRONG TYPE' : 'CHECK NEEDED';
  const p4Badge = !brokerCheck.found ? 'badge-skip'
    : brokerCheck.severity === 'ok' ? 'badge-pass'
    : brokerCheck.severity === 'critical' ? 'badge-bug' : 'badge-warn';

  // Part 5: Domain
  const p5Color = domainCheck.hasCustomDomain ? '#2e7d32' : '#e65100';
  const p5Label = domainCheck.hasCustomDomain ? 'CONNECTED' : 'NOT CONNECTED';
  const p5Badge = domainCheck.hasCustomDomain ? 'badge-pass' : 'badge-warn';

  return `
    <!-- PART 4: BrokerCheck Banner -->
    <div class="part">
      <div class="part-header">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="part-badge ${p4Badge}">PART 4</span>
            <span class="part-title">BrokerCheck Banner</span>
            <span class="part-status" style="background:${p4Color}">${p4Label}</span>
          </div>
          <div class="part-subtitle" style="margin-top:6px">
            Validates the FINRA BrokerCheck banner type &nbsp;·&nbsp;
            Expected: <strong>Top and Bottom (SVG)</strong>
          </div>
        </div>
      </div>
      <div class="part-body">
        <div class="summary-grid">
          <div class="summary-card">
            <div class="num ${brokerCheck.found ? (brokerCheck.type === 'svg' ? 'num-green' : 'num-red') : ''}">${brokerCheck.found ? (brokerCheck.type === 'svg' ? 'SVG' : 'Non-SVG') : 'None'}</div>
            <div class="lbl">Banner Type</div>
          </div>
          <div class="summary-card">
            <div class="num">${brokerCheck.position !== 'none' ? brokerCheck.position.replace(/-/g, ' ') : 'N/A'}</div>
            <div class="lbl">Position</div>
          </div>
          <div class="summary-card">
            <div class="num ${brokerCheck.found ? 'num-green' : ''}">${brokerCheck.found ? 'Yes' : 'No'}</div>
            <div class="lbl">Banner Present</div>
          </div>
        </div>
        <div style="padding:12px 16px;background:#fafafa;border:1px solid #e0e0e0;border-radius:6px;font-size:13px">
          ${brokerCheck.severity === 'critical'
            ? `<span style="color:#d32f2f;font-weight:600">&#10007;</span> ${escHtml(brokerCheck.details)}`
            : brokerCheck.severity === 'ok'
              ? `<span style="color:#2e7d32;font-weight:600">&#10003;</span> ${escHtml(brokerCheck.details)}`
              : `<span style="color:#757575">&#8212;</span> ${escHtml(brokerCheck.details)}`
          }
        </div>
      </div>
    </div>

    <!-- PART 5: Domain Connection -->
    <div class="part">
      <div class="part-header">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="part-badge ${p5Badge}">PART 5</span>
            <span class="part-title">Domain Connection</span>
            <span class="part-status" style="background:${p5Color}">${p5Label}</span>
          </div>
          <div class="part-subtitle" style="margin-top:6px">
            Checks whether a custom domain is connected (vs default brprodaccount.com)
          </div>
        </div>
      </div>
      <div class="part-body">
        <div class="summary-grid">
          <div class="summary-card">
            <div class="num ${domainCheck.hasCustomDomain ? 'num-green' : 'num-orange'}">${domainCheck.hasCustomDomain ? 'Yes' : 'No'}</div>
            <div class="lbl">Custom Domain</div>
          </div>
          <div class="summary-card">
            <div class="num" style="font-size:14px;word-break:break-all">${escHtml(domainCheck.hostname)}</div>
            <div class="lbl">Current Hostname</div>
          </div>
        </div>
        <div style="padding:12px 16px;background:#fafafa;border:1px solid #e0e0e0;border-radius:6px;font-size:13px">
          ${domainCheck.hasCustomDomain
            ? `<span style="color:#2e7d32;font-weight:600">&#10003;</span> ${escHtml(domainCheck.details)}`
            : `<span style="color:#e65100;font-weight:600">&#9888;</span> ${escHtml(domainCheck.details)}`
          }
        </div>
      </div>
    </div>

    ${renderTemplateSocial(siteHealth.templateSocial)}
    ${renderImageValidation(siteHealth.imageValidation)}
    ${renderTemplateSubtitle(siteHealth.templateSubtitle)}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function generateMenuHtmlReport(result: MenuCheckResult, outputPath: string): void {
  const {
    originalDomain, migratedDomain, capturedAt,
    issues, summary, liveIssues, liveSummary,
    brNavItems, originalItems, migratedItems,
    originalCrawlFailed, originalCrawlError,
    contentCheck,
    siteHealth,
  } = result;

  // Part 1 status
  const p1Color = sectionStatusColor(summary);
  const p1Label = sectionStatusLabel(summary);

  // Part 2 status
  const p2Color = originalCrawlFailed ? '#757575' : sectionStatusColor(liveSummary);
  const p2Label = originalCrawlFailed ? 'SKIPPED' : sectionStatusLabel(liveSummary);

  // Part 3 status
  const p3Critical = contentCheck?.mismatches.filter((m) => m.severity === 'critical').length ?? 0;
  const p3Warning = contentCheck?.mismatches.filter((m) => m.severity === 'warning').length ?? 0;
  const p3Color = !contentCheck || contentCheck.error ? '#757575' : p3Critical > 0 ? '#d32f2f' : p3Warning > 0 ? '#e65100' : '#2e7d32';
  const p3Label = !contentCheck || contentCheck.error ? 'SKIPPED' : p3Critical > 0 ? 'MISMATCH' : p3Warning > 0 ? 'WARNINGS' : 'PASS';

  // Parts 4-8 status
  const p4Label = !siteHealth?.brokerCheck.found ? 'N/A'
    : siteHealth.brokerCheck.severity === 'ok' ? 'SVG OK'
    : siteHealth.brokerCheck.severity === 'critical' ? 'WRONG TYPE' : 'CHECK';
  const p5Label = siteHealth?.domainCheck.hasCustomDomain ? 'CONNECTED' : 'NOT CONNECTED';
  const p6Label = !siteHealth?.templateSocial ? 'N/A'
    : siteHealth.templateSocial.templateCount > 0 ? `${siteHealth.templateSocial.templateCount} TEMPLATE` : 'PASS';
  const p7Label = !siteHealth?.imageValidation ? 'N/A'
    : siteHealth.imageValidation.issues.length > 0 ? `${siteHealth.imageValidation.issues.length} ISSUES` : 'PASS';
  const p8Label = !siteHealth?.templateSubtitle ? 'N/A'
    : siteHealth.templateSubtitle.isTemplate ? 'TEMPLATE' : 'PASS';

  // Overall worst status
  const hasBrokerCheckBug = siteHealth?.brokerCheck.found && siteHealth.brokerCheck.severity === 'critical';
  const hasTemplateSocial = (siteHealth?.templateSocial?.templateCount ?? 0) > 0;
  const hasImageIssues = (siteHealth?.imageValidation?.issues.length ?? 0) > 0;
  const hasTemplateSubtitle = siteHealth?.templateSubtitle?.isTemplate ?? false;
  const overallColor = (bugCount(summary) > 0 || bugCount(liveSummary) > 0 || p3Critical > 0 || hasBrokerCheckBug || hasTemplateSocial || hasTemplateSubtitle)
    ? '#d32f2f'
    : (summary.structureChanges > 0 || liveSummary.structureChanges > 0 || p3Warning > 0 || !siteHealth?.domainCheck.hasCustomDomain || hasImageIssues)
      ? '#1565c0'
      : '#2e7d32';

  const p1Bugs = issues.filter((i) => i.kind === 'missing' || i.kind === 'broken-link');
  const p1Warnings = issues.filter((i) => i.kind === 'structure-change');
  const p1Extra = issues.filter((i) => i.kind === 'extra');
  const p1Ok = issues.filter((i) => i.kind === 'ok');

  const p2Bugs = liveIssues.filter((i) => i.kind === 'missing' || i.kind === 'broken-link');
  const p2Warnings = liveIssues.filter((i) => i.kind === 'structure-change');
  const p2Extra = liveIssues.filter((i) => i.kind === 'extra');
  const p2Ok = liveIssues.filter((i) => i.kind === 'ok');

  const renderBRNav = (items: MenuCheckResult['brNavItems']) => {
    return items.map((item) => {
      const children = item.children.length > 0
        ? `<ul class="sub-list">${item.children.map((c) => `<li><code>${c.title}</code> <span class="path">${c.href}</span></li>`).join('')}</ul>`
        : '';
      return `<li><code>${item.title}</code> <span class="path">${item.href}</span>${children}</li>`;
    }).join('');
  };

  const renderWixNav = (items: MenuCheckResult['migratedItems']) => {
    return items.map((item) => {
      const subs = item.subItems.length > 0
        ? `<ul class="sub-list">${item.subItems.map((s) => `<li><code>${s.text}</code> <span class="path">${s.path}</span></li>`).join('')}</ul>`
        : '';
      return `<li><code>${item.text}</code> <span class="path">${item.path}</span>${subs}</li>`;
    }).join('');
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Menu Check — ${originalDomain}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #1a1a1a; background: #f5f5f5; }
  .header { background: #1a237e; color: white; padding: 24px 32px; }
  .header h1 { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
  .header .meta { font-size: 12px; opacity: 0.7; }
  .overall-bar { background: ${overallColor}; color: white; padding: 8px 32px; font-size: 12px; font-weight: 600; letter-spacing: 1px; display: flex; gap: 32px; }
  .container { max-width: 1100px; margin: 24px auto; padding: 0 24px; }
  /* Part tabs */
  .part { background: white; border-radius: 8px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.1); overflow: hidden; }
  .part-header { padding: 16px 24px; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; gap: 12px; }
  .part-badge { padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 700; letter-spacing: .5px; }
  .part-title { font-size: 16px; font-weight: 600; }
  .part-subtitle { font-size: 12px; color: #666; margin-top: 2px; }
  .part-status { margin-left: auto; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 700; color: white; }
  .part-body { padding: 20px 24px; }
  .badge-pass { background: #e8f5e9; color: #2e7d32; }
  .badge-bug  { background: #ffebee; color: #c62828; }
  .badge-warn { background: #e3f2fd; color: #1565c0; }
  .badge-skip { background: #f5f5f5; color: #757575; }
  /* Summary cards */
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .summary-card { background: #fafafa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px; text-align: center; }
  .summary-card .num { font-size: 28px; font-weight: 700; }
  .summary-card .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #666; margin-top: 4px; }
  .num-red { color: #d32f2f; } .num-orange { color: #e65100; }
  .num-blue { color: #1565c0; } .num-green { color: #2e7d32; }
  /* Issue tables */
  details { background: #fafafa; border: 1px solid #e0e0e0; border-radius: 6px; margin-bottom: 10px; overflow: hidden; }
  summary.section-title { padding: 12px 16px; font-weight: 600; font-size: 13px; cursor: pointer; user-select: none; list-style: none; display: flex; align-items: center; gap: 8px; }
  summary.section-title::-webkit-details-marker { display: none; }
  summary.section-title .count { background: #e0e0e0; border-radius: 12px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
  .issue-table { width: 100%; border-collapse: collapse; }
  .issue-table tr { border-top: 1px solid #f0f0f0; }
  .issue-table tr:hover { background: #f5f5f5; }
  .badge-cell { width: 160px; padding: 10px 16px; vertical-align: top; }
  .detail-cell { padding: 10px 16px; line-height: 1.6; }
  .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .badge-missing  { background: #ffebee; color: #c62828; }
  .badge-broken   { background: #ffebee; color: #c62828; }
  .badge-duplicate    { background: #fff3e0; color: #e65100; }
  .badge-href-mismatch{ background: #fce4ec; color: #ad1457; }
  .badge-structure{ background: #e3f2fd; color: #1565c0; }
  .badge-extra    { background: #e8f5e9; color: #2e7d32; }
  .badge-ok       { background: #e8f5e9; color: #2e7d32; }
  code { background: #f5f5f5; border-radius: 3px; padding: 1px 5px; font-size: 13px; }
  .path { color: #666; font-size: 12px; font-family: monospace; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #999; }
  .note { margin-top: 4px; font-size: 12px; color: #555; font-style: italic; }
  .http { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 700; }
  .http-200 { background: #e8f5e9; color: #2e7d32; }
  .http-404 { background: #ffebee; color: #c62828; }
  .http-301, .http-302 { background: #fff8e1; color: #e65100; }
  /* Raw nav panels */
  .raw-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .raw-nav-box { background: #fafafa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px; }
  .raw-nav-box h3 { font-size: 12px; font-weight: 600; margin-bottom: 8px; color: #444; text-transform: uppercase; letter-spacing: .5px; }
  .raw-nav-box ul { padding-left: 16px; }
  .raw-nav-box li { padding: 3px 0; font-size: 13px; }
  .sub-list { padding-left: 20px; margin-top: 4px; }
  .sub-list li { font-size: 12px; color: #555; }
  .muted { color: #bbb; }
  .skipped-notice { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 6px; padding: 20px; text-align: center; color: #757575; font-size: 13px; }
  @media (max-width: 700px) { .raw-nav { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(3, 1fr); } }
</style>
</head>
<body>
<div class="header">
  <h1>Menu Check Report — ${originalDomain}</h1>
  <div class="meta">
    Migrated: ${migratedDomain} &nbsp;·&nbsp;
    Scanned: ${new Date(capturedAt).toLocaleString()}
  </div>
</div>
<div class="overall-bar">
  <span>Part 1 (BR JSON vs Migrated): ${p1Label}</span>
  <span>Part 2 (Original vs Migrated): ${p2Label}</span>
  <span>Part 3 (Content Identity): ${p3Label}</span>
  <span>Part 4 (BrokerCheck): ${p4Label}</span>
  <span>Part 5 (Domain): ${p5Label}</span>
  <span>Part 6 (Social): ${p6Label}</span>
  <span>Part 7 (Images): ${p7Label}</span>
  <span>Part 8 (Subtitle): ${p8Label}</span>
</div>

<div class="container">

  <!-- ═══ PART 1: BR JSON vs Migrated ═══ -->
  <div class="part">
    <div class="part-header">
      <div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="part-badge ${bugCount(summary) > 0 ? 'badge-bug' : summary.structureChanges > 0 ? 'badge-warn' : 'badge-pass'}">PART 1</span>
          <span class="part-title">BR JSON vs Migrated Site</span>
          <span class="part-status" style="background:${p1Color}">${p1Label}</span>
        </div>
        <div class="part-subtitle" style="margin-top:6px">
          Source of truth: BR Source API navigation spec &nbsp;·&nbsp;
          Answers: <em>"Was everything in the migration spec actually migrated?"</em>
        </div>
      </div>
    </div>
    <div class="part-body">
      ${renderSummaryCards(summary, 'BR JSON')}

      <div class="raw-nav">
        <div class="raw-nav-box">
          <h3>BR JSON Navigation (source of truth)</h3>
          <ul>${renderBRNav(brNavItems)}</ul>
        </div>
        <div class="raw-nav-box">
          <h3>Migrated Site Menu (crawled)</h3>
          <ul>${renderWixNav(migratedItems)}</ul>
        </div>
      </div>

      ${renderSection('❌ Bugs — Missing Items & Broken Links', issues, true, true)}
      ${renderSection('🔀 Structure Changes (flat→nested or nested→flat)', p1Warnings, true)}
      ${renderSection('➕ Extra Items (in migrated, not in BR JSON)', p1Extra, false)}
      ${renderSection('✅ Matched Items', p1Ok, false)}
    </div>
  </div>

  <!-- ═══ PART 2: Original Live Site vs Migrated ═══ -->
  <div class="part">
    <div class="part-header">
      <div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="part-badge ${originalCrawlFailed ? 'badge-skip' : bugCount(liveSummary) > 0 ? 'badge-bug' : liveSummary.structureChanges > 0 ? 'badge-warn' : 'badge-pass'}">PART 2</span>
          <span class="part-title">Original Live Site vs Migrated Site</span>
          <span class="part-status" style="background:${p2Color}">${p2Label}</span>
        </div>
        <div class="part-subtitle" style="margin-top:6px">
          Source of truth: crawled menu from <strong>${originalDomain}</strong> &nbsp;·&nbsp;
          Answers: <em>"Does the migrated site look the same as the original?"</em>
        </div>
      </div>
    </div>
    <div class="part-body">
      ${originalCrawlFailed
        ? `<div class="skipped-notice">
            ⚠ Original site could not be crawled (may be Cloudflare-blocked or unreachable).<br>
            <small>${originalCrawlError ?? ''}</small>
          </div>`
        : `
          ${renderSummaryCards(liveSummary, 'Original')}

          <div class="raw-nav">
            <div class="raw-nav-box">
              <h3>Original Live Site Menu (crawled)</h3>
              <ul>${renderWixNav(originalItems)}</ul>
            </div>
            <div class="raw-nav-box">
              <h3>Migrated Site Menu (crawled)</h3>
              <ul>${renderWixNav(migratedItems)}</ul>
            </div>
          </div>

          ${renderSection('❌ Bugs — Missing Items & Broken Links', liveIssues, true, true)}
          ${renderSection('🔀 Structure Changes (flat→nested or nested→flat)', p2Warnings, true)}
          ${renderSection('➕ Extra Items (in migrated, not on original)', p2Extra, false)}
          ${renderSection('✅ Matched Items', p2Ok, false)}
        `
      }
    </div>
  </div>

  <!-- ═══ PART 3: Content Identity Check ═══ -->
  ${renderContentCheck(contentCheck, originalDomain)}

  <!-- ═══ PARTS 4-5: Site Health Checks ═══ -->
  ${renderSiteHealth(siteHealth)}

</div>
</body>
</html>`;

  writeFileSync(outputPath, html, 'utf-8');
  console.log(`\n  Report: ${outputPath}`);
}
