import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  Search,
  Check,
  XCircle,
  Loader2,
  Settings2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/qr';
import { fetchCriticalSystemRisk } from '@/lib/alerts';
import { useAuth } from '@/lib/auth';

type AlertType = 'individual' | 'collective';
type AlertStatus = 'active' | 'acknowledged' | 'resolved';

interface RiskAlert {
  id: string;
  alert_type: AlertType;
  risk_rule_id: string | null;
  process_run_id: string | null;
  stage_index: number;
  employee_id: string;
  severity_level: string;
  process_category: string;
  action_taken: string | null;
  message: string;
  status: AlertStatus;
  created_at: string;
}

interface ProcessRun {
  id: string;
  process_definition_id: string;
}

interface ProcessDefinition {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<AlertStatus, string> = {
  active: 'Active',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
};

const STATUS_BADGES: Record<AlertStatus, string> = {
  active: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  acknowledged: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

const SEVERITY_BADGES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  pass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  fail: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

const severityBadge = (level: string | null) =>
  level ? SEVERITY_BADGES[level.toLowerCase()] ?? 'bg-[var(--surface-hover)] text-[var(--text-muted)]' : '';

const CATEGORY_BADGES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  moderate: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

const CATEGORY_OPTIONS = ['critical', 'high', 'moderate', 'low'] as const;

const ACTION_BADGES: Record<string, string> = {
  block: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  alert: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

const ACTION_LABELS: Record<string, string> = {
  block: 'Process blocked',
  alert: 'Alert only',
  warn: 'Warning shown',
};

const categoryBadge = (cat: string | null) =>
  cat ? CATEGORY_BADGES[cat.toLowerCase()] ?? 'bg-[var(--surface-hover)] text-[var(--text-muted)]' : '';

export function AlertsPage() {
  const { appUser } = useAuth();
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [definitions, setDefinitions] = useState<ProcessDefinition[]>([]);
  const [runs, setRuns] = useState<Record<string, ProcessRun>>({});
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingCatFor, setEditingCatFor] = useState<string | null>(null);
  const [catDraft, setCatDraft] = useState<string>('moderate');
  const [savingCat, setSavingCat] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [processFilter, setProcessFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<AlertStatus | 'all'>('all');

  // Breach tracking
  const [criticalRisk, setCriticalRisk] = useState<{ breachedProcessCount: number; aggregateScore: string } | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('risk_alerts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) {
      setLoading(false);
      return;
    }
    setAlerts(data as RiskAlert[]);

    // Fetch process runs to map run_id -> definition_id
    const runIds = Array.from(
      new Set(
        (data as RiskAlert[])
          .map((a) => a.process_run_id)
          .filter((id): id is string => id != null)
      )
    );
    let runMap: Record<string, ProcessRun> = {};
    if (runIds.length > 0) {
      const { data: runData } = await supabase
        .from('process_runs')
        .select('id, process_definition_id')
        .in('id', runIds);
      if (runData) {
        (runData as ProcessRun[]).forEach((r) => { runMap[r.id] = r; });
        setRuns(runMap);
      }
    }

    // Fetch process definitions for filter dropdown
    const defIds = Array.from(
      new Set(
        Object.values(runMap).map((r) => r.process_definition_id)
      )
    );
    if (defIds.length > 0) {
      const { data: defData } = await supabase
        .from('process_definitions')
        .select('id, name')
        .in('id', defIds);
      if (defData) setDefinitions(defData as ProcessDefinition[]);
    }
    setLoading(false);
  }, []);

  const fetchBreachCount = useCallback(async () => {
    const risk = await fetchCriticalSystemRisk();
    setCriticalRisk(risk);
  }, []);

  useEffect(() => {
    fetchAlerts();
    fetchBreachCount();
  }, [fetchAlerts, fetchBreachCount]);

  // Unique employee IDs for filter
  const employeeIds = useMemo(() => {
    const ids = new Set(
      alerts
        .filter((a) => a.alert_type === 'individual' && a.employee_id)
        .map((a) => a.employee_id)
    );
    return Array.from(ids).sort();
  }, [alerts]);

  const individualAlerts = useMemo(() => alerts.filter((a) => a.alert_type === 'individual'), [alerts]);
  const collectiveAlerts = useMemo(() => alerts.filter((a) => a.alert_type === 'collective'), [alerts]);

  const filteredIndividual = useMemo(() => {
    const q = search.trim().toLowerCase();
    return individualAlerts.filter((a) => {
      const defId = runs[a.process_run_id ?? '']?.process_definition_id;
      if (processFilter !== 'all' && defId !== processFilter) return false;
      if (employeeFilter !== 'all' && a.employee_id !== employeeFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (!q) return true;
      const dName = defName(defId ?? null);
      return (
        dName.toLowerCase().includes(q) ||
        a.employee_id.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q)
      );
    });
  }, [individualAlerts, search, processFilter, employeeFilter, statusFilter]);

  const hasActiveFilters =
    processFilter !== 'all' || employeeFilter !== 'all' || statusFilter !== 'all' || search.trim().length > 0;

  const updateAlertStatus = async (id: string, status: AlertStatus) => {
    setUpdatingId(id);
    const { error } = await supabase
      .from('risk_alerts')
      .update({ status })
      .eq('id', id);
    if (!error) {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
      await supabase.from('customer_activity_logs').insert({
        actor_id: appUser?.id ?? '',
        actor_email: appUser?.email ?? '',
        actor_role: appUser?.role ?? 'admin',
        action: status === 'acknowledged' ? 'alert_acknowledged' : 'alert_resolved',
        details: { alert_id: id, status },
      });
    }
    setUpdatingId(null);
  };

  const updateAlertCategory = async (id: string, category: string) => {
    setSavingCat(true);
    const { error } = await supabase
      .from('risk_alerts')
      .update({ process_category: category })
      .eq('id', id);
    if (!error) {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, process_category: category } : a)));
    }
    setSavingCat(false);
    setEditingCatFor(null);
  };

  const renderCategoryBadge = (a: RiskAlert) => {
    if (editingCatFor === a.id) {
      return (
        <div className="flex items-center gap-1">
          <select
            value={catDraft}
            onChange={(e) => setCatDraft(e.target.value)}
            disabled={savingCat}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text)] outline-none focus:border-primary-500"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <button
            onClick={() => updateAlertCategory(a.id, catDraft)}
            disabled={savingCat}
            className="rounded bg-primary-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-700"
          >Save</button>
          <button onClick={() => setEditingCatFor(null)} disabled={savingCat} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">Cancel</button>
        </div>
      );
    }
    return (
      <button
        onClick={() => { setEditingCatFor(a.id); setCatDraft(a.process_category ?? 'moderate'); }}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all hover:ring-2 hover:ring-primary-500/20 ${categoryBadge(a.process_category)}`}
        title="Click to edit category"
      >
        {a.process_category ?? 'moderate'}
        <Settings2 className="h-2.5 w-2.5 opacity-60" />
      </button>
    );
  };

  const defName = (id: string | null) => {
    if (!id) return 'Unknown process';
    return definitions.find((d) => d.id === id)?.name ?? 'Unknown process';
  };

  const alertDefName = (a: RiskAlert) => {
    const defId = runs[a.process_run_id ?? '']?.process_definition_id;
    return defName(defId ?? null);
  };

  const showCriticalBanner = criticalRisk !== null;

  return (
    <div className="space-y-6">
      {/* Critical system risk banner */}
      {showCriticalBanner && criticalRisk && (
        <div className="sticky top-0 z-30 flex items-center gap-3 rounded-xl border border-red-600/40 bg-red-600 px-4 py-3 shadow-lg">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <AlertTriangle className="h-5 w-5 text-white" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">
              CRITICAL SYSTEM RISK: {criticalRisk.breachedProcessCount} Processes Breached Simultaneously.
            </p>
            <p className="text-xs text-red-100">
              Aggregate Risk Score: {criticalRisk.aggregateScore}. Immediate attention required across the organization.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Alerts</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Monitor individual and collective risk alerts across your process runs.
        </p>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading alerts...
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <Check className="mx-auto h-12 w-12 text-emerald-500" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No alerts</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            There are no active risk alerts. Everything looks good.
          </p>
        </div>
      ) : (
        <>
          {/* Individual Alerts */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--text)]">Individual Alerts</h2>
              <span className="rounded-full bg-[var(--surface-hover)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-muted)]">
                {individualAlerts.length}
              </span>
            </div>

            {/* Filters */}
            {individualAlerts.length > 0 && (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="relative flex-1 sm:min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search alerts..."
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                  />
                </div>
                <select
                  value={processFilter}
                  onChange={(e) => setProcessFilter(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value="all">All processes</option>
                  {definitions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <select
                  value={employeeFilter}
                  onChange={(e) => setEmployeeFilter(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value="all">All employees</option>
                  {employeeIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as AlertStatus | 'all')}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="resolved">Resolved</option>
                </select>
                {hasActiveFilters && (
                  <button
                    onClick={() => {
                      setProcessFilter('all');
                      setEmployeeFilter('all');
                      setStatusFilter('all');
                      setSearch('');
                    }}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {/* Individual alert list */}
            {individualAlerts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
                <p className="text-sm text-[var(--text-muted)]">No individual alerts recorded.</p>
              </div>
            ) : filteredIndividual.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
                <Search className="mx-auto h-8 w-8 text-[var(--text-subtle)]" />
                <p className="mt-3 text-sm font-medium text-[var(--text)]">No matching alerts</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">Try adjusting your filters.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredIndividual.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-all hover:shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[var(--text)]">
                            {alertDefName(a)}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGES[a.status]}`}
                          >
                            {STATUS_LABELS[a.status]}
                          </span>
                          {a.severity_level && (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase ${severityBadge(a.severity_level)}`}
                            >
                              {a.severity_level}
                            </span>
                          )}
                          {renderCategoryBadge(a)}
                          {a.action_taken && (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_BADGES[a.action_taken.toLowerCase()] ?? ''}`}
                            >
                              {ACTION_LABELS[a.action_taken.toLowerCase()] ?? a.action_taken}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-muted)]">
                          <span>Stage: {a.stage_index}</span>
                          {a.employee_id && <span>Employee: {a.employee_id}</span>}
                          {a.message && <span className="truncate">{a.message}</span>}
                          <span>{formatDateTime(a.created_at)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-2">
                        {a.status === 'active' && (
                          <button
                            onClick={() => updateAlertStatus(a.id, 'acknowledged')}
                            disabled={updatingId === a.id}
                            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                          >
                            {updatingId === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            Acknowledge
                          </button>
                        )}
                        {a.status !== 'resolved' && (
                          <button
                            onClick={() => updateAlertStatus(a.id, 'resolved')}
                            disabled={updatingId === a.id}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {updatingId === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5" />
                            )}
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Collective Alerts */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--text)]">Collective Alerts</h2>
              <span className="rounded-full bg-[var(--surface-hover)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-muted)]">
                {collectiveAlerts.length}
              </span>
            </div>

            {collectiveAlerts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
                <Check className="mx-auto h-8 w-8 text-emerald-500" />
                <p className="mt-3 text-sm font-medium text-[var(--text)]">No collective alerts</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  System-wide risk patterns will appear here when detected.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {collectiveAlerts.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-all hover:shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[var(--text)]">
                            {alertDefName(a)}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGES[a.status]}`}
                          >
                            {STATUS_LABELS[a.status]}
                          </span>
                          {a.severity_level && (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase ${severityBadge(a.severity_level)}`}
                            >
                              {a.severity_level}
                            </span>
                          )}
                          {renderCategoryBadge(a)}
                          {a.action_taken && (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_BADGES[a.action_taken.toLowerCase()] ?? ''}`}
                            >
                              {ACTION_LABELS[a.action_taken.toLowerCase()] ?? a.action_taken}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-muted)]">
                          {a.message && <span>{a.message}</span>}
                          <span>{formatDateTime(a.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {a.status === 'active' && (
                          <button
                            onClick={() => updateAlertStatus(a.id, 'acknowledged')}
                            disabled={updatingId === a.id}
                            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                          >
                            {updatingId === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            Acknowledge
                          </button>
                        )}
                        {a.status !== 'resolved' && (
                          <button
                            onClick={() => updateAlertStatus(a.id, 'resolved')}
                            disabled={updatingId === a.id}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {updatingId === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5" />
                            )}
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
