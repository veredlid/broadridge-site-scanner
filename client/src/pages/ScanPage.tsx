import { ScanForm } from '../components/ScanForm';
import { ScanTable } from '../components/ScanTable';

export function ScanPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Site Scanner</h1>
      <p className="text-[var(--text-muted)] mb-8">Scan a Broadridge FA site and audit links, CTAs, layout, and 61 ground rules.</p>
      <ScanForm />
      <h2 className="text-lg font-semibold mb-4">Scan History</h2>
      <ScanTable />
    </div>
  );
}
