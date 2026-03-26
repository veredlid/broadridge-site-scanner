import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SiteSnapshot, SnapshotDiff } from '../types/index.js';

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function saveSnapshot(snapshot: SiteSnapshot, path: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf-8');
}

export async function loadSnapshot(path: string): Promise<SiteSnapshot> {
  const data = await readFile(path, 'utf-8');
  return JSON.parse(data);
}

export async function saveDiff(diff: SnapshotDiff, path: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(diff, null, 2), 'utf-8');
}

export async function saveReport(content: string, path: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, 'utf-8');
}
