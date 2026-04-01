import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createScan, subscribeScanProgress } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { Tooltip } from './Tooltip';

const SITE_TYPES = [
  { value: 'vanilla', label: 'Vanilla Bean', description: '1-1 match to original site — strict rules' },
  { value: 'flex', label: 'Flex', description: 'Template-based with creative freedom' },
  { value: 'deprecated', label: 'Deprecated', description: 'Older template base, same rules as Flex' },
] as const;

type ScanProgress = {
  id: string;
  domain: string;
  log: string[];
  done: boolean;
  error: string | null;
};

export function ScanForm() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [domain, setDomain] = useState(searchParams.get('retry') ?? '');
  const [label, setLabel] = useState(searchParams.get('label') ?? '');
  const retryViewports = searchParams.get('viewports') ?? '';
  const [viewports, setViewports] = useState({
    desktop: retryViewports ? retryViewports.includes('desktop') : true,
    tablet: retryViewports.includes('tablet'),
    mobile: retryViewports.includes('mobile'),
  });
  const [headed, setHeaded] = useState(false);
  const [siteType, setSiteType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const queryClient = useQueryClient();

  // Clear retry params from URL after they've been read
  useEffect(() => {
    if (searchParams.has('retry')) {
      setSearchParams({}, { replace: true });
    }
  }, []);

  // Auto-scroll progress log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progress?.log]);

  // Cleanup SSE on unmount
  useEffect(() => () => { unsubRef.current?.(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim() || !siteType) return;
    setLoading(true);

    // Clear any previous progress
    unsubRef.current?.();
    setProgress(null);

    try {
      const vps = Object.entries(viewports).filter(([, v]) => v).map(([k]) => k).join(',') || 'desktop';
      const { id } = await createScan({ domain: domain.trim(), label: label.trim() || undefined, viewports: vps, headed, siteType });
      queryClient.invalidateQueries({ queryKey: ['scans'] });

      const scannedDomain = domain.trim();
      setDomain('');
      setLabel('');
      setSiteType('');

      // Start live progress panel
      const initialProgress: ScanProgress = { id, domain: scannedDomain, log: [], done: false, error: null };
      setProgress(initialProgress);

      const unsub = subscribeScanProgress(
        id,
        (data) => {
          if (data.type === 'error') {
            const errMsg = data.error as string;
            setProgress((p) => p ? { ...p, error: errMsg, log: [...p.log, `❌ ${errMsg}`] } : p);
          } else if (data.message) {
            setProgress((p) => p ? { ...p, log: [...p.log, data.message as string] } : p);
          }
        },
        () => {
          setProgress((p) => p ? { ...p, done: true, log: [...p.log, ...(p.error ? [] : ['✓ Scan complete'])] } : p);
          queryClient.invalidateQueries({ queryKey: ['scans'] });
          setLoading(false);
        }
      );
      unsubRef.current = unsub;
    } catch (err) {
      setLoading(false);
    }
  };

  return (
    <div className="mb-8">
      <form onSubmit={handleSubmit} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">New Scan</h2>
        {/* Row 1: domain + site type + viewports + submit */}
        <div className="flex flex-wrap gap-4 items-end mb-3">
          <div className="flex-1 min-w-[250px]">
            <label className="block text-sm text-[var(--text-muted)] mb-1">Domain</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="www.blankequity.com"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--blue)]"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">
              <span className="text-[var(--text-muted)]">Site Type</span>
              <span className="text-red-400 ml-1">*</span>
            </label>
            <div className="flex gap-2">
              {SITE_TYPES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  title={st.description}
                  onClick={() => setSiteType(st.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                    siteType === st.value
                      ? st.value === 'vanilla'
                        ? 'bg-purple-500/20 border-purple-500/60 text-purple-300'
                        : st.value === 'deprecated'
                          ? 'bg-orange-500/20 border-orange-500/60 text-orange-300'
                          : 'bg-blue-500/20 border-blue-500/60 text-blue-300'
                      : 'bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
            {!siteType && (
              <p className="text-xs text-[var(--text-muted)] mt-1">Select site type to enable scan</p>
            )}
          </div>
          <div className="flex gap-3 items-center">
            {(['desktop', 'tablet', 'mobile'] as const).map((vp) => (
              <label key={vp} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={viewports[vp]}
                  onChange={(e) => setViewports({ ...viewports, [vp]: e.target.checked })}
                  className="accent-[var(--blue)]"
                />
                {vp}
              </label>
            ))}
            <Tooltip content="Opens a visible Chrome window on the server so you can watch the scan in real time. Useful for debugging. Leave unchecked for normal scans — headless mode is faster.">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-2 border-l border-[var(--border)] pl-3">
                <input
                  type="checkbox"
                  checked={headed}
                  onChange={(e) => setHeaded(e.target.checked)}
                  className="accent-[var(--blue)]"
                />
                <span className={headed ? 'text-[var(--blue)]' : 'text-[var(--text-muted)]'}>👁 Headed</span>
              </label>
            </Tooltip>
          </div>
          <button
            type="submit"
            disabled={loading || !domain.trim() || !siteType}
            className="px-6 py-2 bg-[var(--blue)] text-white rounded-lg font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition"
            title={!siteType ? 'Select a site type to enable scanning' : undefined}
          >
            {loading ? 'Scanning...' : 'Scan'}
          </button>
        </div>
        {/* Row 2: optional label */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--text-muted)] shrink-0">Label <span className="opacity-60">(optional)</span></label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. pre-launch"
            className="w-48 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--blue)]"
          />
        </div>
      </form>

      {/* Live progress panel — appears while scan is running */}
      {progress && (
        <div className="mt-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
            <div className="flex items-center gap-2">
              {!progress.done ? (
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
              ) : progress.error ? (
                <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
              )}
              <span className="text-sm font-medium text-[var(--text)]">{progress.domain}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-muted)]">
                {!progress.done ? 'scanning...' : progress.error ? 'failed' : 'done'}
              </span>
              {progress.done && (
                <button
                  onClick={() => setProgress(null)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition"
                >
                  ✕ dismiss
                </button>
              )}
            </div>
          </div>
          <div className="p-4 h-48 overflow-y-auto font-mono text-xs text-[var(--text-muted)] space-y-0.5">
            {progress.log.length === 0 && (
              <p className="text-[var(--text-muted)] italic">Starting scan...</p>
            )}
            {progress.log.map((line, i) => (
              <p key={i} className={
                line.startsWith('❌') ? 'text-red-400' :
                line.startsWith('✓') ? 'text-green-400' :
                line.startsWith('⚠') ? 'text-yellow-400' :
                'text-[var(--text-muted)]'
              }>{line}</p>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
