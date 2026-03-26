import type { SnapshotDiff, SiteSnapshot, DiffItem } from '../types/index.js';
import { saveReport } from '../utils/fs-helpers.js';

export async function generateHtmlReport(
  diff: SnapshotDiff,
  originalSnapshot: SiteSnapshot,
  migratedSnapshot: SiteSnapshot,
  outputPath: string
): Promise<void> {
  const html = buildHtml(diff, originalSnapshot, migratedSnapshot);
  await saveReport(html, outputPath);
}

function buildHtml(
  diff: SnapshotDiff,
  original: SiteSnapshot,
  migrated: SiteSnapshot
): string {
  const { summary, items, pages } = diff;
  const critical = items.filter((i) => i.severity === 'critical');
  const major = items.filter((i) => i.severity === 'major');
  const minor = items.filter((i) => i.severity === 'minor');
  const info = items.filter((i) => i.severity === 'info');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BR Site Scanner — ${diff.originalDomain} vs ${diff.migratedDomain}</title>
  <style>
    :root {
      --bg: #0f172a; --surface: #1e293b; --border: #334155;
      --text: #e2e8f0; --text-muted: #94a3b8;
      --green: #22c55e; --red: #ef4444; --yellow: #eab308; --blue: #3b82f6;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 1.8rem; margin-bottom: 8px; }
    .subtitle { color: var(--text-muted); margin-bottom: 32px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .summary-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; text-align: center; }
    .summary-card .value { font-size: 2rem; font-weight: 700; }
    .summary-card .label { color: var(--text-muted); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .filters { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .filter-btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; }
    .filter-btn.active { background: var(--blue); border-color: var(--blue); }
    .filter-btn:hover { border-color: var(--blue); }
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    th { background: var(--surface); padding: 12px 16px; text-align: left; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); border-bottom: 2px solid var(--border); }
    td { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
    tr:hover { background: rgba(59, 130, 246, 0.05); }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-critical { background: rgba(239, 68, 68, 0.15); color: var(--red); }
    .badge-major { background: rgba(234, 179, 8, 0.15); color: var(--yellow); }
    .badge-minor { background: rgba(168, 85, 247, 0.15); color: var(--purple); }
    .badge-info { background: rgba(59, 130, 246, 0.15); color: var(--blue); }
    .badge-match { background: rgba(34, 197, 94, 0.15); color: var(--green); }
    .badge-mismatch { background: rgba(239, 68, 68, 0.15); color: var(--red); }
    .badge-missing { background: rgba(234, 179, 8, 0.15); color: var(--yellow); }
    .badge-new { background: rgba(59, 130, 246, 0.15); color: var(--blue); }
    .page-section { margin-bottom: 40px; }
    .page-title { font-size: 1.2rem; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
    .detail-cell { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .expand-btn { background: none; border: none; color: var(--blue); cursor: pointer; font-size: 0.8rem; }
    footer { text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Broadridge Site Scanner Report</h1>
    <p class="subtitle">
      <strong>Original:</strong> ${diff.originalDomain} &nbsp;→&nbsp;
      <strong>Migrated:</strong> ${diff.migratedDomain} &nbsp;|&nbsp;
      Mode: ${diff.mode} &nbsp;|&nbsp;
      ${new Date(diff.migratedTimestamp).toLocaleString()}
    </p>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="value">${summary.totalChecks}</div>
        <div class="label">Total Checks</div>
      </div>
      <div class="summary-card">
        <div class="value" style="color: var(--green)">${summary.passed}</div>
        <div class="label">Matches</div>
      </div>
      <div class="summary-card">
        <div class="value" style="color: var(--red)">${summary.failed}</div>
        <div class="label">Mismatches</div>
      </div>
      <div class="summary-card">
        <div class="value" style="color: var(--blue)">${summary.newIssues}</div>
        <div class="label">New in Migrated</div>
      </div>
    </div>

    <div class="filters">
      <button class="filter-btn active" onclick="filterRows('all')">All (${items.length})</button>
      <button class="filter-btn" onclick="filterRows('critical')">Critical (${critical.length})</button>
      <button class="filter-btn" onclick="filterRows('major')">Major (${major.length})</button>
      <button class="filter-btn" onclick="filterRows('minor')">Minor (${minor.length})</button>
      <button class="filter-btn" onclick="filterRows('info')">Info (${info.length})</button>
    </div>

    ${pages.map((p) => `
    <div class="page-section">
      <h2 class="page-title">${p.originalUrl || ''} → ${p.migratedUrl || p.url}</h2>
      ${p.items.length === 0 ? '<p style="color: var(--green)">No differences found for this page.</p>' : `
      <table>
        <thead>
          <tr>
            <th>Section</th>
            <th>Check</th>
            <th>Severity</th>
            <th>Status</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${p.items.map((item) => renderRow(item)).join('\n')}
        </tbody>
      </table>`}
    </div>`).join('\n')}

    <footer>
      Generated by broadridge-site-scanner &nbsp;|&nbsp; ${new Date().toISOString()}
    </footer>
  </div>

  <script>
    function filterRows(severity) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      document.querySelectorAll('tbody tr').forEach(row => {
        row.style.display = severity === 'all' || row.dataset.severity === severity ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

function renderRow(item: DiffItem): string {
  return `<tr data-severity="${item.severity}" data-change="${item.changeType}">
  <td>${item.section}</td>
  <td><code>${item.checkId}</code></td>
  <td><span class="badge badge-${item.severity}">${item.severity}</span></td>
  <td><span class="badge badge-${item.changeType === 'match' ? 'match' : item.changeType === 'mismatch' || item.changeType === 'missing-in-migrated' ? 'mismatch' : item.changeType === 'new-in-migrated' ? 'new' : 'mismatch'}">${item.changeType}</span></td>
  <td class="detail-cell" title="${escapeHtml(item.description)}">${escapeHtml(item.description)}</td>
</tr>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
