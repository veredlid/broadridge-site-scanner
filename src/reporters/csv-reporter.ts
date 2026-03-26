import type { SnapshotDiff } from '../types/index.js';
import { saveReport } from '../utils/fs-helpers.js';

export async function generateCsvReport(
  diff: SnapshotDiff,
  outputPath: string
): Promise<void> {
  const headers = [
    'Page',
    'Section',
    'Check ID',
    'Severity',
    'Status',
    'Description',
    'Original Value',
    'Migrated Value',
  ];

  const rows = diff.items.map((item) => [
    escapeCsv(item.page),
    escapeCsv(item.section),
    escapeCsv(item.checkId),
    escapeCsv(item.severity),
    escapeCsv(item.changeType),
    escapeCsv(item.description),
    escapeCsv(String(item.original ?? '')),
    escapeCsv(String(item.migrated ?? '')),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  await saveReport(csv, outputPath);
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
