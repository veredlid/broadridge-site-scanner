import type { Response } from 'express';

export interface Job {
  id: string;
  type: 'scan' | 'comparison';
  execute: () => Promise<void>;
}

const MAX_CONCURRENT = 2;

const pending: Job[] = [];
const running = new Set<string>();

// SSE subscribers keyed by job id
const subscribers = new Map<string, Set<Response>>();

export function enqueue(job: Job): void {
  pending.push(job);
  processNext();
}

export function getQueueStatus(): { running: string[]; pending: number } {
  return { running: [...running], pending: pending.length };
}

export function subscribe(jobId: string, res: Response): void {
  if (!subscribers.has(jobId)) subscribers.set(jobId, new Set());
  subscribers.get(jobId)!.add(res);
  res.on('close', () => {
    subscribers.get(jobId)?.delete(res);
  });
}

export function emitProgress(jobId: string, data: Record<string, unknown>): void {
  const subs = subscribers.get(jobId);
  if (!subs) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) {
    res.write(payload);
  }
}

export function emitDone(jobId: string): void {
  emitProgress(jobId, { type: 'done' });
  const subs = subscribers.get(jobId);
  if (subs) {
    for (const res of subs) res.end();
    subscribers.delete(jobId);
  }
}

function processNext(): void {
  while (running.size < MAX_CONCURRENT && pending.length > 0) {
    const job = pending.shift()!;
    running.add(job.id);
    job.execute()
      .catch(() => { /* errors handled inside execute() */ })
      .finally(() => {
        running.delete(job.id);
        processNext();
      });
  }
}
