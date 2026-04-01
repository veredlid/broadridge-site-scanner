import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const DB_PATH = resolve(PROJECT_ROOT, 'data', 'scanner.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    migrate(_db);
  }
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'scan',
      status TEXT NOT NULL DEFAULT 'queued',
      viewports TEXT NOT NULL DEFAULT 'desktop',
      site_type TEXT NOT NULL DEFAULT 'flex',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      snapshot_json TEXT,
      report_json TEXT,
      page_count INTEGER DEFAULT 0,
      passed INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS comparisons (
      id TEXT PRIMARY KEY,
      original_domain TEXT NOT NULL,
      migrated_domain TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      viewports TEXT NOT NULL DEFAULT 'desktop',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      original_snapshot_json TEXT,
      migrated_snapshot_json TEXT,
      diff_json TEXT,
      total_checks INTEGER DEFAULT 0,
      passed INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comparisons_created ON comparisons(created_at DESC);
  `);

  // Migration: add site_type column if it doesn't exist (for existing databases)
  const cols = db.prepare(`PRAGMA table_info(scans)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'site_type')) {
    db.exec(`ALTER TABLE scans ADD COLUMN site_type TEXT NOT NULL DEFAULT 'flex'`);
  }

  // Migration: add label column to comparisons if it doesn't exist
  const compCols = db.prepare(`PRAGMA table_info(comparisons)`).all() as Array<{ name: string }>;
  if (!compCols.some((c) => c.name === 'label')) {
    db.exec(`ALTER TABLE comparisons ADD COLUMN label TEXT NOT NULL DEFAULT ''`);
  }

  // ── Deliveries feature ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      delivery_date TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      site_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'processing',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS site_versions (
      id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL REFERENCES deliveries(id),
      domain TEXT NOT NULL,
      site_id TEXT,
      json_data TEXT NOT NULL,
      delivery_date TEXT NOT NULL,
      is_latest INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_site_versions_domain ON site_versions(domain);
    CREATE INDEX IF NOT EXISTS idx_site_versions_delivery ON site_versions(delivery_id);
  `);

  // Migrations for deliveries feature columns
  const dvCols = db.prepare(`PRAGMA table_info(deliveries)`).all() as Array<{ name: string }>;
  if (!dvCols.some((c) => c.name === 'stats_json')) {
    db.exec(`ALTER TABLE deliveries ADD COLUMN stats_json TEXT`);
  }

  const svCols = db.prepare(`PRAGMA table_info(site_versions)`).all() as Array<{ name: string }>;
  if (!svCols.some((c) => c.name === 'phase')) {
    db.exec(`ALTER TABLE site_versions ADD COLUMN phase INTEGER`);
  }
  if (!svCols.some((c) => c.name === 'wave')) {
    db.exec(`ALTER TABLE site_versions ADD COLUMN wave INTEGER`);
  }

  // Migration: add label column to deliveries
  if (!dvCols.some((c) => c.name === 'label')) {
    db.exec(`ALTER TABLE deliveries ADD COLUMN label TEXT NOT NULL DEFAULT ''`);
  }
}
