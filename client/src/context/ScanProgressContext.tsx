import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { listScans, subscribeScanProgress, type ScanListItem } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';

export interface RunningEntry {
  scan: ScanListItem;
  lines: string[];
  done: boolean;
}

interface ScanProgressCtx {
  running: RunningEntry[];
  dismiss: (id: string) => void;
}

const Ctx = createContext<ScanProgressCtx>({ running: [], dismiss: () => {} });

export function useScanProgress() {
  return useContext(Ctx);
}

export function ScanProgressProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Map<string, RunningEntry>>(new Map());
  const subscriptions = useRef<Map<string, () => void>>(new Map());
  const queryClient = useQueryClient();

  const addLine = useCallback((id: string, line: string) => {
    setEntries((prev) => {
      const next = new Map(prev);
      const entry = next.get(id);
      if (!entry) return prev;
      next.set(id, { ...entry, lines: [...entry.lines.slice(-49), line] });
      return next;
    });
  }, []);

  const markDone = useCallback((id: string) => {
    setEntries((prev) => {
      const next = new Map(prev);
      const entry = next.get(id);
      if (!entry) return prev;
      next.set(id, { ...entry, done: true });
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ['scans'] });
    queryClient.invalidateQueries({ queryKey: ['comparisons'] });
  }, [queryClient]);

  // Poll for running scans every 3s
  useEffect(() => {
    let alive = true;

    const poll = async () => {
      if (!alive) return;
      try {
        const scans = await listScans();
        const running = scans.filter((s) => s.status === 'running' || s.status === 'queued');

        for (const scan of running) {
          if (subscriptions.current.has(scan.id)) continue; // already subscribed

          // Register entry
          setEntries((prev) => {
            if (prev.has(scan.id)) return prev;
            const next = new Map(prev);
            next.set(scan.id, { scan, lines: [], done: false });
            return next;
          });

          // Subscribe to SSE
          const unsub = subscribeScanProgress(
            scan.id,
            (data) => {
              const msg = (data.message as string) ?? '';
              if (msg) addLine(scan.id, msg);
            },
            () => {
              markDone(scan.id);
              subscriptions.current.delete(scan.id);
            }
          );
          subscriptions.current.set(scan.id, unsub);
        }
      } catch {
        // server might be briefly unavailable — ignore
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(interval);
      subscriptions.current.forEach((unsub) => unsub());
      subscriptions.current.clear();
    };
  }, [addLine, markDone]);

  const dismiss = useCallback((id: string) => {
    setEntries((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const running = [...entries.values()];

  return (
    <Ctx.Provider value={{ running, dismiss }}>
      {children}
    </Ctx.Provider>
  );
}
