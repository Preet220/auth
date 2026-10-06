import { useEffect, useState, useCallback } from 'react';
import { Users, QrCode, ScrollText, GitBranch, TriangleAlert as AlertTriangle, ShieldCheck, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { fetchCriticalSystemRisk } from '@/lib/alerts';

export function AdminOverviewPage({ riskManagementEnabled = true }: { riskManagementEnabled?: boolean }) {
  const { appUser } = useAuth();
  const [stats, setStats] = useState({
    employees: 0,
    qrCodes: 0,
    scans: 0,
    processes: 0,
    activeAlerts: 0,
    seals: 0,
    completedRuns: 0,
    activeRuns: 0,
  });
  const [loading, setLoading] = useState(true);
  const [criticalRisk, setCriticalRisk] = useState<{ breachedProcessCount: number; aggregateScore: string } | null>(null);

  const fetchStats = useCallback(async () => {
    const [emp, qr, scans, procs, alerts, seals, completedRuns, activeRuns] = await Promise.all([
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('qr_codes').select('id', { count: 'exact', head: true }),
      supabase.from('scan_records').select('id', { count: 'exact', head: true }),
      supabase.from('process_definitions').select('id', { count: 'exact', head: true }),
      supabase.from('risk_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('seals').select('id', { count: 'exact', head: true }),
      supabase.from('process_runs').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('process_runs').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
    ]);
    setStats({
      employees: emp.count ?? 0,
      qrCodes: qr.count ?? 0,
      scans: scans.count ?? 0,
      processes: procs.count ?? 0,
      activeAlerts: alerts.count ?? 0,
      seals: seals.count ?? 0,
      completedRuns: completedRuns.count ?? 0,
      activeRuns: activeRuns.count ?? 0,
    });
    setLoading(false);

    if (riskManagementEnabled) {
      const risk = await fetchCriticalSystemRisk();
      setCriticalRisk(risk);
    }
  }, [riskManagementEnabled]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const cards = [
    { label: 'Employees', value: stats.employees, icon: Users, color: 'text-primary-600', bg: 'bg-primary-500/10' },
    { label: 'QR Codes', value: stats.qrCodes, icon: QrCode, color: 'text-accent-600', bg: 'bg-accent-500/10' },
    { label: 'Seals', value: stats.seals, icon: ShieldCheck, color: 'text-error-500', bg: 'bg-error-500/10' },
    { label: 'Scan Records', value: stats.scans, icon: ScrollText, color: 'text-warning-500', bg: 'bg-warning-500/10' },
    { label: 'Completed Runs', value: stats.completedRuns, icon: GitBranch, color: 'text-accent-600', bg: 'bg-accent-500/10' },
    { label: 'Active Runs', value: stats.activeRuns, icon: Activity, color: 'text-primary-600', bg: 'bg-primary-500/10' },
    ...(riskManagementEnabled ? [{ label: 'Active Alerts', value: stats.activeAlerts, icon: AlertTriangle, color: 'text-error-500', bg: 'bg-error-500/10' }] : []),
  ];

  return (
    <div className="space-y-6">
      {criticalRisk && (
        <div className="sticky top-0 z-30 flex items-center gap-3 rounded-xl border border-red-600/40 bg-red-600 px-4 py-3 shadow-lg">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <AlertTriangle className="h-5 w-5 text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">
              CRITICAL SYSTEM RISK: {criticalRisk.breachedProcessCount} Processes Breached Simultaneously.
            </p>
            <p className="text-xs text-red-100">
              Aggregate Risk Score: {criticalRisk.aggregateScore}. Immediate attention required across the organization.
            </p>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Overview</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Welcome back, {appUser?.name}. Here's your system at a glance.</p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: riskManagementEnabled ? 8 : 7 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:bg-[var(--surface-hover)]">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--text)]">{value}</p>
                  <p className="text-xs text-[var(--text-muted)]">{label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}


    </div>
  );
}

export function EmployeeOverviewPage() {
  const { appUser } = useAuth();
  const [stats, setStats] = useState({ myScans: 0, activeProcesses: 0 });
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<{ employee_name: string; work_email: string; employee_id: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: empData } = await supabase
        .from('employees')
        .select('employee_name, work_email, employee_id')
        .eq('user_id', appUser?.id ?? '')
        .maybeSingle();
      setEmployee(empData);

      const [scans, procs] = await Promise.all([
        supabase.from('scan_records').select('id', { count: 'exact', head: true }).eq('employee_user_id', appUser?.id ?? ''),
        supabase.from('process_runs').select('id', { count: 'exact', head: true }).eq('employee_id', appUser?.id ?? '').eq('status', 'in_progress'),
      ]);
      setStats({ myScans: scans.count ?? 0, activeProcesses: procs.count ?? 0 });
      setLoading(false);
    })();
  }, [appUser]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Home</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Welcome, {employee?.employee_name ?? appUser?.name}.</p>
      </div>

      {employee && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-500 text-lg font-bold text-white">
              {employee.employee_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-lg font-semibold text-[var(--text)]">{employee.employee_name}</p>
              <p className="text-sm text-[var(--text-muted)]">{employee.work_email}</p>
              <p className="text-xs text-[var(--text-subtle)]">Employee ID: {employee.employee_id}</p>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/10">
                <ScrollText className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--text)]">{stats.myScans}</p>
                <p className="text-xs text-[var(--text-muted)]">My scans</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/10">
                <GitBranch className="h-5 w-5 text-accent-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--text)]">{stats.activeProcesses}</p>
                <p className="text-xs text-[var(--text-muted)]">Active processes</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
