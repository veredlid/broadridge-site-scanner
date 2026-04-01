import { Routes, Route, NavLink } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { ScanPage } from './pages/ScanPage';
import { ReportPage } from './pages/ReportPage';
import { ComparePage } from './pages/ComparePage';
import { DeliveriesPage } from './pages/DeliveriesPage';

function Nav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition ${
      isActive ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
    }`;

  return (
    <nav className="border-b border-[var(--border)] mb-8">
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center gap-6">
        <span className="font-bold text-lg mr-4">BR Scanner</span>
        <NavLink to="/"            end className={linkClass}>Dashboard</NavLink>
        <NavLink to="/scans"           className={linkClass}>Scans</NavLink>
        <NavLink to="/comparisons"     className={linkClass}>Compare</NavLink>
        <NavLink to="/deliveries"      className={linkClass}>Deliveries</NavLink>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-[1400px] mx-auto px-6 pb-12">
        <Routes>
          <Route path="/"                   element={<DashboardPage />} />
          <Route path="/scans"              element={<ScanPage />} />
          <Route path="/scans/:id"          element={<ReportPage />} />
          <Route path="/comparisons"        element={<ComparePage />} />
          <Route path="/comparisons/:id"    element={<ComparePage />} />
          <Route path="/deliveries"         element={<DeliveriesPage />} />
        </Routes>
      </main>
    </div>
  );
}
