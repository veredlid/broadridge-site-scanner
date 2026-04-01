import { writeFileSync } from 'fs';
import path from 'path';
import type { BatchResult } from './batch-runner.js';
import type { MenuItemIssue, MenuCheckResult } from './menu-checker.js';
import type { SiteHealthResult } from './site-health-checker.js';

interface FlatBug {
  site: string;
  migratedUrl: string;
  part: 1 | 2;
  type: 'Missing' | 'Broken Link' | 'Duplicate' | 'Href Mismatch';
  item: string;
  note: string;
  reportFile: string;
}

function collectBugs(results: BatchResult[]): FlatBug[] {
  const bugs: FlatBug[] = [];

  const bugKinds = new Set(['missing', 'broken-link', 'duplicate', 'href-mismatch']);
  const bugTypeLabel = (kind: string): FlatBug['type'] =>
    kind === 'missing' ? 'Missing' : kind === 'duplicate' ? 'Duplicate' : kind === 'href-mismatch' ? 'Href Mismatch' : 'Broken Link';

  const extractBugs = (
    issues: MenuItemIssue[],
    site: string,
    migratedUrl: string,
    part: 1 | 2,
    reportFile: string,
  ) => {
    for (const issue of issues) {
      if (bugKinds.has(issue.kind)) {
        bugs.push({ site, migratedUrl, part, type: bugTypeLabel(issue.kind), item: issue.brTitle ?? issue.migratedText ?? '?', note: issue.note ?? '', reportFile });
      }
      for (const sub of issue.subIssues ?? []) {
        if (bugKinds.has(sub.kind)) {
          bugs.push({ site, migratedUrl, part, type: bugTypeLabel(sub.kind), item: sub.brTitle ?? sub.migratedText ?? '?', note: sub.note ?? '', reportFile });
        }
      }
    }
  };

  for (const r of results) {
    if (!r.result || !r.reportPath) continue;
    const reportFile = path.basename(path.dirname(r.reportPath)) + '/menu-report.html';
    extractBugs(r.result.issues, r.site.original, r.site.migrated, 1, reportFile);
    if (!r.result.originalCrawlFailed) {
      extractBugs(r.result.liveIssues, r.site.original, r.site.migrated, 2, reportFile);
    }
  }

  return bugs;
}

function countMalformedHrefs(result: MenuCheckResult): number {
  let count = 0;
  for (const item of result.brNavItems ?? []) {
    if (/^\/https?:\/\//.test(item.href ?? '')) count++;
    for (const child of item.children ?? []) {
      if (/^\/https?:\/\//.test(child.href ?? '')) count++;
    }
  }
  return count;
}

function bugCount(result: MenuCheckResult, part: 1 | 2): number {
  const s = part === 1 ? result.summary : result.liveSummary;
  return s.missing + s.brokenLinks + s.duplicates + s.hrefMismatches;
}

function contentMismatchCount(result: MenuCheckResult): { critical: number; warning: number } {
  if (!result.contentCheck?.mismatches) return { critical: 0, warning: 0 };
  const critical = result.contentCheck.mismatches.filter((m) => m.severity === 'critical').length;
  const warning = result.contentCheck.mismatches.filter((m) => m.severity === 'warning').length;
  return { critical, warning };
}

interface ContentMismatchBug {
  site: string;
  migratedUrl: string;
  field: string;
  severity: 'critical' | 'warning';
  originalValue: string;
  migratedValue: string;
  note: string;
  reportFile: string;
}

function collectContentMismatches(results: BatchResult[]): ContentMismatchBug[] {
  const bugs: ContentMismatchBug[] = [];
  for (const r of results) {
    if (!r.result?.contentCheck?.mismatches || !r.reportPath) continue;
    const reportFile = path.basename(path.dirname(r.reportPath)) + '/menu-report.html';
    for (const m of r.result.contentCheck.mismatches) {
      bugs.push({
        site: r.site.original,
        migratedUrl: r.site.migrated,
        field: m.field,
        severity: m.severity,
        originalValue: m.originalValue,
        migratedValue: m.migratedValue,
        note: m.note,
        reportFile,
      });
    }
  }
  return bugs;
}

/** Format a content-mismatch value for display, e.g. phone digits → (xxx) xxx-xxxx */
function fmtMismatchValue(field: string, value: string): string {
  if (field !== 'phone') return value;
  // Each token may be a 10-digit normalized phone or already formatted
  return value.split(/,\s*/).map((token) => {
    const digits = token.replace(/\D/g, '');
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return token;
  }).join(', ');
}

export function generateIndexReport(results: BatchResult[], outputDir: string): string {
  const succeeded = results.filter((r) => r.result);
  const failed = results.filter((r) => r.error);
  const allBugs = collectBugs(results);
  const p1Bugs = allBugs.filter((b) => b.part === 1);
  const p2Bugs = allBugs.filter((b) => b.part === 2);
  const sitesWithP1Bugs = new Set(p1Bugs.map((b) => b.site)).size;
  const sitesWithP2Bugs = new Set(p2Bugs.map((b) => b.site)).size;
  const sitesWithAnyBug = new Set(allBugs.map((b) => b.site)).size;
  const skippedSites = succeeded.filter((r) => r.result!.originalCrawlFailed).length;
  const cleanSites = succeeded.filter((r) => bugCount(r.result!, 1) === 0 && (r.result!.originalCrawlFailed || bugCount(r.result!, 2) === 0)).length;
  const sitesWithMalformed = succeeded.filter((r) => countMalformedHrefs(r.result!) > 0).length;
  const capturedAt = new Date().toLocaleString();

  // Content mismatch stats
  const p3Bugs = collectContentMismatches(results);
  const p3Critical = p3Bugs.filter((b) => b.severity === 'critical');
  const sitesWithContentMismatch = new Set(p3Critical.map((b) => b.site)).size;

  // Site health stats (Parts 4-5)
  const sitesWithBrokerCheck = succeeded.filter((r) => r.result!.siteHealth?.brokerCheck.found).length;
  const sitesWithWrongBrokerCheck = succeeded.filter((r) =>
    r.result!.siteHealth?.brokerCheck.found && r.result!.siteHealth.brokerCheck.type !== 'svg'
  ).length;
  const sitesWithoutCustomDomain = succeeded.filter((r) =>
    r.result!.siteHealth && !r.result!.siteHealth.domainCheck.hasCustomDomain
  ).length;

  // ── Build site rows ──────────────────────────────────────────────────────
  const siteRows = results.map((r) => {
    const reportFile = r.reportPath
      ? path.basename(path.dirname(r.reportPath)) + '/menu-report.html'
      : '';
    if (r.error) {
      return { domain: r.site.original, reportFile, p1Status: 'ERROR', p2Status: 'ERROR', p3Status: 'ERROR', p4Status: 'ERROR', p5Status: 'ERROR', p1Bugs: 0, p2Bugs: 0, p3Critical: 0, totalBugs: 0, malformedHrefs: 0, status: 'error' as const, error: r.error };
    }
    const res = r.result!;
    const p1 = bugCount(res, 1);
    const p2 = res.originalCrawlFailed ? null : bugCount(res, 2);
    const p1Status = p1 > 0 ? 'BUGS' : res.summary.structureChanges > 0 ? 'CHANGES' : 'PASS';
    const p2Status = res.originalCrawlFailed ? 'SKIP' : (p2! > 0 ? 'BUGS' : res.liveSummary.structureChanges > 0 ? 'CHANGES' : 'PASS');
    const cm = contentMismatchCount(res);
    const p3Status = res.originalCrawlFailed ? 'SKIP' : cm.critical > 0 ? 'MISMATCH' : cm.warning > 0 ? 'WARN' : 'PASS';
    const bc = res.siteHealth?.brokerCheck;
    const p4Status = !bc?.found ? 'N/A' : bc.type === 'svg' ? 'SVG' : 'NON-SVG';
    const dc = res.siteHealth?.domainCheck;
    const p5Status = dc?.hasCustomDomain ? 'YES' : 'NO';
    const totalBugs = p1 + (p2 ?? 0);
    const status = (totalBugs > 0 || cm.critical > 0) ? 'bugs' as const : p2Status === 'SKIP' ? 'skip' as const : 'pass' as const;
    return { domain: r.site.original, reportFile, p1Status, p2Status, p3Status, p4Status, p5Status, p1Bugs: p1, p2Bugs: p2 ?? 0, p3Critical: cm.critical, totalBugs, malformedHrefs: countMalformedHrefs(res), status };
  });

  // Sort: bugs first (by count desc), then pass alphabetical, skip at bottom
  const statusOrder: Record<string, number> = { bugs: 0, error: 1, pass: 2, skip: 3 };
  const sorted = [...siteRows].sort((a, b) => {
    const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (so !== 0) return so;
    if (a.status === 'bugs' && b.status === 'bugs') return b.totalBugs - a.totalBugs;
    return a.domain.localeCompare(b.domain);
  });

  // ── All Sites rows ────────────────────────────────────────────────────────
  const allSiteRows = sorted.map((r) => {
    if ('error' in r && r.error) {
      return `<tr class="tr-fail" data-domain="${escHtml(r.domain)}" data-status="error">
        <td class="cell-domain">${escHtml(r.domain)}</td>
        <td><span class="st st-fail">ERROR</span></td>
        <td><span class="st st-fail">ERROR</span></td>
        <td><span class="st st-fail">ERROR</span></td>
        <td><span class="st st-skip">—</span></td>
        <td><span class="st st-skip">—</span></td>
        <td class="tc">—</td>
        <td>—</td></tr>`;
    }
    const hasBugs = r.status === 'bugs';
    const p3Cls = r.p3Status === 'MISMATCH' ? 'st-bugs' : r.p3Status === 'WARN' ? 'st-changes' : r.p3Status === 'SKIP' ? 'st-skip' : 'st-pass';
    const p4Cls = r.p4Status === 'SVG' ? 'st-pass' : r.p4Status === 'NON-SVG' ? 'st-bugs' : 'st-skip';
    const p5Cls = r.p5Status === 'YES' ? 'st-pass' : 'st-bugs';
    return `<tr class="${hasBugs ? 'tr-bug' : ''}" data-domain="${escHtml(r.domain)}" data-status="${r.status}">
      <td class="cell-domain"><a href="${r.reportFile}">${escHtml(r.domain)}</a></td>
      <td><span class="st st-${r.p1Status.toLowerCase()}">${r.p1Status}</span>${r.p1Bugs > 0 ? ` <span class="bub">${r.p1Bugs}</span>` : ''}</td>
      <td><span class="st st-${r.p2Status.toLowerCase()}">${r.p2Status}</span>${r.p2Bugs > 0 ? ` <span class="bub">${r.p2Bugs}</span>` : ''}</td>
      <td><span class="st ${p3Cls}">${r.p3Status}</span>${r.p3Critical > 0 ? ` <span class="bub">${r.p3Critical}</span>` : ''}</td>
      <td><span class="st ${p4Cls}">${r.p4Status}</span></td>
      <td><span class="st ${p5Cls}">${r.p5Status === 'YES' ? 'DOMAIN' : 'NO DOMAIN'}</span></td>
      <td class="tc">${hasBugs ? `<span class="bub bub-total">${r.totalBugs}</span>` : '<span class="muted">—</span>'}</td>
      <td class="tc"><a href="${r.reportFile}" class="link-report">View →</a></td>
    </tr>`;
  }).join('\n');

  // ── P1 Bug rows (flat list, one row per bug) ─────────────────────────────
  const p1Rows = p1Bugs.map((b) =>
    `<tr data-domain="${escHtml(b.site)}" data-type="${escHtml(b.type)}">
      <td class="cell-domain"><a href="${b.reportFile}">${escHtml(b.site)}</a></td>
      <td><span class="tag tag-${tagClass(b.type)}">${b.type}</span></td>
      <td class="cell-item">${escHtml(b.item)}</td>
      <td class="cell-note">${b.note ? escHtml(b.note) : '<span class="muted">—</span>'}</td>
      <td class="tc"><a href="${b.reportFile}" class="link-report">View →</a></td>
    </tr>`
  ).join('\n');

  // ── P2 Bug rows (flat list, one row per bug) ─────────────────────────────
  const p2Rows = p2Bugs.map((b) =>
    `<tr data-domain="${escHtml(b.site)}" data-type="${escHtml(b.type)}">
      <td class="cell-domain"><a href="${b.reportFile}">${escHtml(b.site)}</a></td>
      <td><span class="tag tag-${tagClass(b.type)}">${b.type}</span></td>
      <td class="cell-item">${escHtml(b.item)}</td>
      <td class="cell-note">${b.note ? escHtml(b.note) : '<span class="muted">—</span>'}</td>
      <td class="tc"><a href="${b.reportFile}" class="link-report">View →</a></td>
    </tr>`
  ).join('\n');

  // ── Skip rows ─────────────────────────────────────────────────────────────
  const skipRows = succeeded
    .filter((r) => r.result!.originalCrawlFailed)
    .sort((a, b) => a.site.original.localeCompare(b.site.original))
    .map((r) => {
      const reportFile = path.basename(path.dirname(r.reportPath!)) + '/menu-report.html';
      const p1 = bugCount(r.result!, 1);
      return `<tr data-domain="${escHtml(r.site.original)}">
        <td class="cell-domain"><a href="${reportFile}">${escHtml(r.site.original)}</a></td>
        <td>${p1 > 0 ? `<span class="st st-bugs">BUGS (${p1})</span>` : `<span class="st st-pass">PASS</span>`}</td>
        <td class="cell-note">SSL certificate mismatch — domain DNS already points to Wix; original site unreachable for Part 2</td>
        <td class="tc"><a href="${reportFile}" class="link-report">View →</a></td>
      </tr>`;
    }).join('\n');

  // ── Bug type filter toolbar ───────────────────────────────────────────────
  const bugFilterBar = (id: string) => `
    <div class="toolbar">
      <input type="text" id="search-${id}" placeholder="Search domain...">
      <button class="fbtn on" data-filter="all" data-p="${id}">All</button>
      <button class="fbtn" data-filter="Missing" data-p="${id}">Missing</button>
      <button class="fbtn" data-filter="Broken Link" data-p="${id}">Broken Link</button>
      <button class="fbtn" data-filter="Href Mismatch" data-p="${id}">Href Mismatch</button>
      <button class="fbtn" data-filter="Duplicate" data-p="${id}">Duplicate</button>
      <span class="count-lbl" id="count-${id}"></span>
    </div>`;

  const bugTable = (id: string, rows: string) => `
    <div class="table-scroll">
      <table id="table-${id}">
        <thead><tr>
          <th style="min-width:220px">Original Domain</th>
          <th style="width:120px">Issue Type</th>
          <th style="min-width:200px">Menu Item</th>
          <th>Note</th>
          <th style="width:60px"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BR Menu QA — Wave 1 Phase 1</title>
<style>
  :root {
    --blue: #1a237e; --blue2: #3949ab;
    --red: #c62828; --green: #2e7d32; --orange: #e65100; --amber: #f57c00;
    --bg: #f4f5f9; --card: #fff; --border: #e0e0e0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 13px; color: #1a1a1a; background: var(--bg); }

  /* ── Header ─── */
  .header {
    background: linear-gradient(135deg, #1a237e 0%, #303f9f 100%); color: #fff;
    padding: 22px 32px; display: flex; align-items: center; justify-content: space-between; gap: 24px;
  }
  .header h1 { font-size: 17px; font-weight: 700; letter-spacing: -.2px; }
  .header .sub { font-size: 11px; opacity: .6; margin-top: 3px; }
  .hstats { display: flex; gap: 24px; }
  .hstat { text-align: center; }
  .hstat .n { font-size: 26px; font-weight: 800; line-height: 1; }
  .hstat .l { font-size: 10px; opacity: .6; margin-top: 3px; text-transform: uppercase; letter-spacing: .5px; }
  .nr { color: #ff8a80; } .ng { color: #b9f6ca; } .na { color: #ffd180; } .nx { color: rgba(255,255,255,.35); }

  /* ── Layout ─── */
  .wrap { max-width: 1400px; margin: 0 auto; padding: 20px 24px 56px; }

  /* ── Tabs ─── */
  .tabs { display: flex; }
  .tab {
    padding: 10px 20px; font-size: 12px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--border); border-bottom: none;
    background: #eaeaf2; color: #666; border-radius: 8px 8px 0 0; margin-right: -1px;
    user-select: none; display: flex; align-items: center; gap: 6px; white-space: nowrap;
  }
  .tab .pill { background: rgba(0,0,0,.1); color: #666; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; }
  .tab.active { background: var(--card); color: var(--blue); border-bottom-color: var(--card); position: relative; z-index: 1; }
  .tab.active .pill { background: var(--blue); color: #fff; }
  .tab-panel { display: none; background: var(--card); border: 1px solid var(--border); border-radius: 0 8px 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,.04); overflow: hidden; margin-bottom: 24px; }
  .tab-panel.active { display: block; }

  /* ── Intro band ─── */
  .intro { padding: 12px 16px; font-size: 12px; color: #555; background: #f9faff; border-bottom: 1px solid #eef0f8; }
  .intro strong { color: #1a1a1a; }

  /* ── Toolbar ─── */
  .toolbar { padding: 10px 16px; border-bottom: 1px solid #f0f0f0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; background: #fafafa; }
  .toolbar input[type=text] { padding: 6px 10px; border: 1px solid var(--border); border-radius: 5px; font-size: 12px; width: 210px; outline: none; }
  .toolbar input[type=text]:focus { border-color: var(--blue); box-shadow: 0 0 0 2px rgba(26,35,126,.1); }
  .fbtn { padding: 5px 11px; border: 1px solid var(--border); border-radius: 5px; background: white; cursor: pointer; font-size: 11px; font-weight: 600; color: #555; }
  .fbtn:hover { background: #f5f5f5; }
  .fbtn.on { background: var(--blue); color: white; border-color: var(--blue); }
  .count-lbl { margin-left: auto; font-size: 11px; color: #999; }

  /* ── Table ─── */
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { padding: 9px 12px; text-align: left; background: #f8f8fb; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #888; border-bottom: 2px solid var(--border); position: sticky; top: 0; z-index: 2; white-space: nowrap; }
  td { padding: 8px 12px; border-bottom: 1px solid #f3f3f3; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f7f8ff; }
  .tr-bug td { background: #fff9f9; }
  .tr-bug:hover td { background: #ffefef; }
  .tr-fail td { background: #fffde7; }
  .cell-domain { font-weight: 600; white-space: nowrap; max-width: 270px; overflow: hidden; text-overflow: ellipsis; }
  .cell-domain a { color: var(--blue); text-decoration: none; }
  .cell-domain a:hover { text-decoration: underline; }
  .cell-item { font-weight: 600; max-width: 280px; }
  .cell-note { font-size: 11px; color: #666; max-width: 380px; }
  .cell-error { font-size: 11px; color: var(--orange); }
  .tc { text-align: center; white-space: nowrap; }
  .muted { color: #ccc; }
  .warn-text { color: var(--amber); font-weight: 600; font-size: 11px; }
  .table-scroll { overflow-x: auto; max-height: 72vh; overflow-y: auto; }

  /* ── Badges ─── */
  .st { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; letter-spacing: .3px; white-space: nowrap; }
  .st-pass    { background: #e8f5e9; color: var(--green); }
  .st-bugs    { background: #ffebee; color: var(--red); }
  .st-changes { background: #e3f2fd; color: #1565c0; }
  .st-skip    { background: #f5f5f5; color: #aaa; }
  .st-fail    { background: #fff3e0; color: var(--orange); }
  .tag { display: inline-block; padding: 2px 7px; border-radius: 3px; font-size: 10px; font-weight: 700; white-space: nowrap; }
  .tag-missing { background: #ffebee; color: var(--red); }
  .tag-broken  { background: #fff3e0; color: var(--amber); }
  .tag-href    { background: #fce4ec; color: #ad1457; }
  .tag-dup     { background: #f3e5f5; color: #6a1b9a; }
  .bub { display: inline-block; background: #ffebee; color: var(--red); font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 10px; margin-left: 4px; }
  .bub-total { background: var(--red); color: #fff; font-size: 12px; padding: 2px 9px; border-radius: 12px; }
  .link-report { color: var(--blue); font-weight: 700; text-decoration: none; font-size: 12px; }
  .link-report:hover { text-decoration: underline; }

  /* ── Legend ─── */
  .legend { padding: 10px 16px; font-size: 11px; color: #999; border-top: 1px solid #f0f0f0; background: #fafafa; display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }

  .empty { padding: 40px; text-align: center; color: var(--green); font-size: 14px; font-weight: 600; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>Broadridge Menu QA — Wave 1 Phase 1</h1>
    <div class="sub">Generated: ${capturedAt}</div>
  </div>
  <div class="hstats">
    <div class="hstat"><div class="n">${results.length}</div><div class="l">Total</div></div>
    <div class="hstat"><div class="n nr">${sitesWithAnyBug}</div><div class="l">With Bugs</div></div>
    <div class="hstat"><div class="n ng">${cleanSites}</div><div class="l">Clean</div></div>
    <div class="hstat"><div class="n na">${skippedSites}</div><div class="l">SSL Skip</div></div>
    <div class="hstat"><div class="n nr">${p1Bugs.length}</div><div class="l">P1 Issues</div></div>
    <div class="hstat"><div class="n nr">${p2Bugs.length}</div><div class="l">P2 Issues</div></div>
    <div class="hstat"><div class="n ${sitesWithContentMismatch > 0 ? 'nr' : 'ng'}">${sitesWithContentMismatch}</div><div class="l">Content Mix-ups</div></div>
    <div class="hstat"><div class="n ${sitesWithWrongBrokerCheck > 0 ? 'nr' : 'ng'}">${sitesWithWrongBrokerCheck}</div><div class="l">Wrong BrokerCheck</div></div>
    <div class="hstat"><div class="n ${sitesWithoutCustomDomain > 0 ? 'na' : 'ng'}">${sitesWithoutCustomDomain}</div><div class="l">No Domain</div></div>
  </div>
</div>

<div class="wrap">
  <div class="tabs">
    <div class="tab active" data-tab="all">All Sites <span class="pill">${results.length}</span></div>
    <div class="tab" data-tab="p1">P1 — BR JSON vs Migrated <span class="pill">${p1Bugs.length}</span></div>
    <div class="tab" data-tab="p2">P2 — Live vs Migrated <span class="pill">${p2Bugs.length}</span></div>
    <div class="tab" data-tab="p3">P3 — Content Identity <span class="pill">${p3Critical.length}</span></div>
    <div class="tab" data-tab="skip">SSL Skipped <span class="pill">${skippedSites}</span></div>
  </div>

  <!-- Tab 1: All Sites -->
  <div class="tab-panel active" id="panel-all">
    <div class="intro">
      <strong>${sitesWithAnyBug} sites</strong> have bugs &nbsp;·&nbsp;
      <strong>${cleanSites}</strong> clean &nbsp;·&nbsp;
      <strong>${skippedSites}</strong> skipped Part 2 (SSL) &nbsp;·&nbsp;
      <strong style="color:var(--red)">${sitesWithContentMismatch}</strong> content mix-ups &nbsp;·&nbsp;
      <strong style="color:var(--red)">${sitesWithWrongBrokerCheck}</strong> wrong BrokerCheck &nbsp;·&nbsp;
      <strong style="color:var(--orange)">${sitesWithoutCustomDomain}</strong> no custom domain
      ${failed.length > 0 ? `&nbsp;·&nbsp; <strong style="color:var(--orange)">${failed.length} scan errors</strong>` : ''}
    </div>
    <div class="toolbar">
      <input type="text" id="search-all" placeholder="Search domain...">
      <button class="fbtn on" data-filter="all">All</button>
      <button class="fbtn" data-filter="bugs">Bugs</button>
      <button class="fbtn" data-filter="pass">Pass</button>
      <button class="fbtn" data-filter="skip">Skip</button>
      <span class="count-lbl" id="count-all">${results.length} sites</span>
    </div>
    <div class="table-scroll">
      <table id="table-all">
        <thead><tr>
          <th style="min-width:200px">Original Domain</th>
          <th style="min-width:100px">P1 — BR JSON</th>
          <th style="min-width:100px">P2 — Live Site</th>
          <th style="min-width:100px">P3 — Content</th>
          <th style="min-width:90px">P4 — BrokerCheck</th>
          <th style="min-width:90px">P5 — Domain</th>
          <th style="width:70px; text-align:center">Total Issues</th>
          <th style="width:55px"></th>
        </tr></thead>
        <tbody id="tbody-all">${allSiteRows}</tbody>
      </table>
    </div>
    <div class="legend">
      <span class="st st-pass">PASS</span> No issues &nbsp;
      <span class="st st-bugs">BUGS</span> Missing / broken / href-mismatch / duplicate &nbsp;
      <span class="st st-bugs">MISMATCH</span> Wrong content (data mix-up) &nbsp;
      <span class="st st-changes">CHANGES</span> Structure only &nbsp;
      <span class="st st-skip">SKIP</span> P2/P3 skipped (SSL)
    </div>
  </div>

  <!-- Tab 2: P1 Bugs -->
  <div class="tab-panel" id="panel-p1">
    <div class="intro">
      <strong>Part 1 — BR JSON vs Migrated Wix site.</strong>
      Items in Broadridge <code>user-navigation</code> JSON that are missing or broken on the migrated site.
      &nbsp;·&nbsp; <strong>${sitesWithP1Bugs} sites</strong> affected &nbsp;·&nbsp; <strong>${p1Bugs.length} issues</strong>
    </div>
    ${p1Bugs.length === 0
      ? '<div class="empty">✓ No Part 1 bugs found</div>'
      : bugFilterBar('p1') + bugTable('p1', p1Rows)
    }
  </div>

  <!-- Tab 3: P2 Bugs -->
  <div class="tab-panel" id="panel-p2">
    <div class="intro">
      <strong>Part 2 — Original live site vs Migrated Wix site.</strong>
      Items visible on the original site that are missing or broken on the migrated site.
      &nbsp;·&nbsp; <strong>${sitesWithP2Bugs} sites</strong> affected &nbsp;·&nbsp; <strong>${p2Bugs.length} issues</strong>
      &nbsp;·&nbsp; ${skippedSites} sites skipped (SSL)
    </div>
    ${p2Bugs.length === 0
      ? '<div class="empty">✓ No Part 2 bugs found</div>'
      : bugFilterBar('p2') + bugTable('p2', p2Rows)
    }
  </div>

  <!-- Tab 4: P3 Content Identity -->
  <div class="tab-panel" id="panel-p3">
    <div class="intro">
      <strong>Part 3 — Content Identity Check.</strong>
      Compares company names, phone numbers, emails, and person names between original and migrated sites to detect data mix-ups.
      &nbsp;·&nbsp; <strong>${sitesWithContentMismatch} sites</strong> with critical mismatches &nbsp;·&nbsp; <strong>${p3Critical.length} critical issues</strong>
    </div>
    ${p3Critical.length === 0
      ? '<div class="empty">✓ No content identity mismatches found</div>'
      : `
      <div class="toolbar">
        <input type="text" id="search-p3" placeholder="Search domain...">
        <button class="fbtn on" data-filter="all" data-p="p3">All</button>
        <button class="fbtn" data-filter="phone" data-p="p3">Phone</button>
        <button class="fbtn" data-filter="email" data-p="p3">Email</button>
        <button class="fbtn" data-filter="person-name" data-p="p3">Person Name</button>
        <button class="fbtn" data-filter="company-name" data-p="p3">Company</button>
        <button class="fbtn" data-filter="address" data-p="p3">Address</button>
        <span class="count-lbl" id="count-p3"></span>
      </div>
      <div class="table-scroll">
        <table id="table-p3">
          <thead><tr>
            <th style="min-width:200px">Original Domain</th>
            <th style="width:100px">Severity</th>
            <th style="width:120px">Field</th>
            <th style="min-width:200px">Original Value</th>
            <th style="min-width:200px">Migrated Value</th>
            <th style="width:60px"></th>
          </tr></thead>
          <tbody>${p3Bugs.map((b) => {
            const sevBadge = b.severity === 'critical'
              ? '<span class="tag tag-missing">CRITICAL</span>'
              : '<span class="tag tag-broken">WARNING</span>';
            return `<tr data-domain="${escHtml(b.site)}" data-type="${escHtml(b.field)}">
              <td class="cell-domain"><a href="${b.reportFile}">${escHtml(b.site)}</a></td>
              <td>${sevBadge}</td>
              <td style="font-weight:600">${escHtml(b.field)}</td>
              <td class="cell-note">${escHtml(fmtMismatchValue(b.field, b.originalValue).substring(0, 80))}</td>
              <td class="cell-note" style="color:var(--red)">${escHtml(fmtMismatchValue(b.field, b.migratedValue).substring(0, 80))}</td>
              <td class="tc"><a href="${b.reportFile}" class="link-report">View →</a></td>
            </tr>`;
          }).join('\n')}</tbody>
        </table>
      </div>`
    }
  </div>

  <!-- Tab 5: Skip -->
  <div class="tab-panel" id="panel-skip">
    <div class="intro">
      <strong>${skippedSites} sites</strong> could not be crawled for Part 2 — the original domain's SSL certificate no longer matches the hostname.
      This occurs when a site's DNS has already been migrated to Wix. Part 1 (BR JSON check) was still performed for all of them.
    </div>
    <div class="toolbar">
      <input type="text" id="search-skip" placeholder="Search domain...">
      <span class="count-lbl">${skippedSites} sites</span>
    </div>
    <div class="table-scroll">
      <table id="table-skip">
        <thead><tr>
          <th style="min-width:220px">Original Domain</th>
          <th style="width:120px">P1 Status</th>
          <th>Reason</th>
          <th style="width:60px"></th>
        </tr></thead>
        <tbody>${skipRows}</tbody>
      </table>
    </div>
  </div>
</div>

<script>
// Tab switching
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// Generic table filter/search setup
function setupTable(tableId, searchId, countId, filterAttr) {
  var tbl = document.getElementById(tableId);
  var inp = document.getElementById(searchId);
  if (!tbl || !inp) return;
  var panelId = 'panel-' + tableId.replace('table-', '');
  var panel = document.getElementById(panelId);
  var activeFilter = 'all';

  function refresh() {
    var q = inp.value.toLowerCase();
    var vis = 0;
    tbl.querySelectorAll('tbody tr').forEach(function(tr) {
      var domain = (tr.dataset.domain || '').toLowerCase();
      var attr = tr.dataset[filterAttr] || '';
      var ok = (!q || domain.includes(q)) && (activeFilter === 'all' || attr === activeFilter);
      tr.style.display = ok ? '' : 'none';
      if (ok) vis++;
    });
    var el = document.getElementById(countId);
    if (el) el.textContent = vis + (filterAttr === 'status' ? ' sites' : ' issues');
  }

  inp.addEventListener('input', refresh);
  if (panel) {
    panel.querySelectorAll('.fbtn[data-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        panel.querySelectorAll('.fbtn[data-filter]').forEach(function(b) { b.classList.remove('on'); });
        btn.classList.add('on');
        activeFilter = btn.dataset.filter;
        refresh();
      });
    });
  }
  refresh();
}

setupTable('table-all',  'search-all',  'count-all',  'status');
setupTable('table-p1',   'search-p1',   'count-p1',   'type');
setupTable('table-p2',   'search-p2',   'count-p2',   'type');
setupTable('table-p3',   'search-p3',   'count-p3',   'type');
setupTable('table-skip', 'search-skip', null,          'domain');
</script>
</body>
</html>`;

  const indexPath = path.join(outputDir, 'index.html');
  writeFileSync(indexPath, html, 'utf-8');
  return indexPath;
}

function tagClass(type: string): string {
  if (type === 'Missing') return 'missing';
  if (type === 'Duplicate') return 'dup';
  if (type === 'Href Mismatch') return 'href';
  return 'broken';
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
