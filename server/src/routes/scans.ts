import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { insertScan, listScans, getScan, deleteScan } from '../db/queries.js';
import { enqueue, subscribe } from '../jobs/queue.js';
import { executeScan } from '../jobs/scan-worker.js';

export const scanRoutes = Router();

scanRoutes.post('/', (req, res) => {
  const { domain, label = 'scan', viewports = 'desktop', headed = false, siteType = 'flex' } = req.body;
  if (!domain || typeof domain !== 'string') {
    res.status(400).json({ error: 'domain is required' });
    return;
  }
  if (!['vanilla', 'flex', 'deprecated'].includes(siteType)) {
    res.status(400).json({ error: 'siteType must be one of: vanilla, flex, deprecated' });
    return;
  }

  const id = uuid();
  insertScan({ id, domain: domain.trim(), label, viewports, site_type: siteType });

  enqueue({
    id,
    type: 'scan',
    execute: () => executeScan(id, domain.trim(), label, viewports, Boolean(headed), siteType),
  });

  res.status(201).json({ id, status: 'queued' });
});

scanRoutes.get('/', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const scans = listScans(limit, offset);
  res.json(scans);
});

scanRoutes.get('/:id', (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }
  res.json({
    ...scan,
    snapshot: scan.snapshot_json ? JSON.parse(scan.snapshot_json) : null,
    report: scan.report_json ? JSON.parse(scan.report_json) : null,
  });
});

scanRoutes.delete('/:id', (req, res) => {
  const deleted = deleteScan(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }
  res.json({ ok: true });
});

scanRoutes.get('/:id/progress', (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }

  // Always use SSE format so EventSource doesn't fire onerror on content-type mismatch.
  // If the scan already finished (e.g. it failed before the client subscribed),
  // send the result immediately and close — don't leave the client hanging.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  if (scan.status === 'done') {
    res.write(`data: ${JSON.stringify({ type: 'status', status: 'done' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    return;
  }

  if (scan.status === 'failed') {
    res.write(`data: ${JSON.stringify({ type: 'error', error: scan.error || 'Scan failed' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    return;
  }

  res.write(`data: ${JSON.stringify({ type: 'status', status: scan.status })}\n\n`);
  subscribe(req.params.id, res);
});
