import { useEffect, useState, useCallback, useMemo } from 'react';
import { FileText, Search, Download, FileSpreadsheet, ChevronDown, ChevronRight, Loader as Loader2, Trash2, Clock, AlertTriangle, X, Truck, Camera } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { formatDate, formatDateTime } from '@/lib/qr';
import { useAuth } from '@/lib/auth';

type RunStatus = 'in_progress' | 'completed' | 'breached';

interface ProcessDefinition {
  id: string;
  name: string;
  category: string;
}

interface BatchItem {
  id: string;
  qr_value: string;
  description: string | null;
  weight: number | null;
  scanned_at: string | null;
  start_weight: number | null;
  end_weight: number | null;
  weight_source: string | null;
  end_weight_source: string | null;
  item_type: string | null;
}

  interface ProcessRun {
  id: string;
  process_definition_id: string;
  employee_name: string | null;
  employee_id: string | null;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  start_total_weight: number | null;
  end_total_weight: number | null;
  reconciliation_result: Record<string, unknown> | string | null;
  batch_items: BatchItem[] | null;
  trolley_qr_value: string | null;
  batch_photo_url: string | null;
}

const STATUS_LABELS: Record<RunStatus, string> = {
  in_progress: 'In Progress',
  completed: 'Completed',
  breached: 'Breached',
};

const STATUS_BADGES: Record<RunStatus, string> = {
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  breached: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

export function ProcessRecordsPage({ riskManagementEnabled = true }: { riskManagementEnabled?: boolean }) {
  const { appUser } = useAuth();
  const [runs, setRuns] = useState<ProcessRun[]>([]);
  const [definitions, setDefinitions] = useState<Record<string, ProcessDefinition>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RunStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProcessRun | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    const { data: runData, error } = await supabase
      .from('process_runs')
      .select('*')
      .order('started_at', { ascending: false, nullsFirst: false });

    if (error || !runData) {
      setLoading(false);
      return;
    }
    setRuns(runData as ProcessRun[]);

    // Fetch related process definitions
    const defIds = Array.from(
      new Set((runData as ProcessRun[]).map((r) => r.process_definition_id))
    );
    if (defIds.length > 0) {
      const { data: defData } = await supabase
        .from('process_definitions')
        .select('id, name, category')
        .in('id', defIds);
      if (defData) {
        const map: Record<string, ProcessDefinition> = {};
        (defData as ProcessDefinition[]).forEach((d) => {
          map[d.id] = d;
        });
        setDefinitions(map);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      const defName = definitions[r.process_definition_id]?.name ?? '';
      return (
        defName.toLowerCase().includes(q) ||
        (r.employee_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [runs, search, statusFilter, definitions]);

  const hasActiveFilters = statusFilter !== 'all' || search.trim().length > 0;

  const buildExportData = () =>
    filtered.map((r) => ({
      'Process Name': definitions[r.process_definition_id]?.name ?? 'Unknown',
      'Employee': r.employee_name ?? '',
      'Employee ID': r.employee_id ?? '',
      'Status': STATUS_LABELS[r.status] ?? r.status,
      'Started At': r.started_at ? formatDateTime(r.started_at) : '',
      'Completed At': r.completed_at ? formatDateTime(r.completed_at) : '',
      'Start Weight (kg)': r.start_total_weight != null ? r.start_total_weight : '',
      'End Weight (kg)': r.end_total_weight != null ? r.end_total_weight : '',
      'Reconciliation Result': r.reconciliation_result && riskManagementEnabled
        ? (typeof r.reconciliation_result === 'string'
            ? r.reconciliation_result
            : (r.reconciliation_result as Record<string, unknown>).matched
              ? 'matched'
              : `mismatch (${Number((r.reconciliation_result as Record<string, unknown>).delta).toFixed(2)})`)
        : '',
    }));

  const handleExportCsv = () => {
    setExporting(true);
    try {
      const data = buildExportData();
      const headers = Object.keys(data[0] ?? {});
      const rows = data.map((row) => Object.values(row).map((v) => String(v)));

      const escape = (val: string) => {
        if (/[",\n]/.test(val)) return `"${val.replace(/"/g, '""')}"`;
        return val;
      };
      const csv = [headers, ...rows]
        .map((row) => row.map((c) => escape(String(c))).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `process-records-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handleExportExcel = () => {
    setExporting(true);
    try {
      const data = buildExportData();
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Process Records');
      XLSX.writeFile(wb, `process-records-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const activeRuns = useMemo(() => runs.filter((r) => r.status === 'in_progress'), [runs]);
  const completedRuns = useMemo(() => runs.filter((r) => r.status !== 'in_progress'), [runs]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error: scanError } = await supabase
      .from('scan_records')
      .delete()
      .eq('process_run_id', deleteTarget.id);
    const { error } = await supabase
      .from('process_runs')
      .delete()
      .eq('id', deleteTarget.id);
    if (!error && !scanError) {
      setRuns((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      await supabase.from('customer_activity_logs').insert({
        actor_id: appUser?.id ?? '',
        actor_email: appUser?.email ?? '',
        actor_role: appUser?.role ?? 'admin',
        action: 'process_run_deleted',
        details: { run_id: deleteTarget.id, process_definition_id: deleteTarget.process_definition_id },
      });
      setDeleteTarget(null);
    }
    setDeleting(false);
  };

  const weightDelta = (r: ProcessRun) => {
    if (r.start_total_weight == null || r.end_total_weight == null) return null;
    const delta = r.end_total_weight - r.start_total_weight;
    return delta;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Process Records</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Review completed and in-progress process runs with reconciliation details.
          </p>
        </div>
        {runs.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={exporting || filtered.length === 0}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              CSV
            </button>
            <button
              onClick={handleExportExcel}
              disabled={exporting || filtered.length === 0}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Excel
            </button>
          </div>
        )}
      </div>

      {/* Active runs section */}
      {!loading && activeRuns.length > 0 && (
        <div className="rounded-xl border border-primary-500/30 bg-primary-500/5 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Clock className="h-4 w-4 text-primary-600" /> Active Runs ({activeRuns.length})
          </h2>
          <div className="space-y-2">
            {activeRuns.map((r) => {
              const def = definitions[r.process_definition_id];
              return (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--text)]">{def?.name ?? 'Unknown process'}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {r.employee_name ?? 'Unassigned'}{r.employee_id ? ` · ID: ${r.employee_id}` : ''} • Started {r.started_at ? formatDateTime(r.started_at) : '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => setDeleteTarget(r)}
                    className="flex items-center gap-1.5 rounded-lg border border-error-500/30 px-3 py-1.5 text-xs font-medium text-error-500 hover:bg-error-500/5"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search + status filter */}
      {runs.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by process or employee..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RunStatus | 'all')}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          >
            <option value="all">All statuses</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="breached">Breached</option>
          </select>
          {hasActiveFilters && (
            <button
              onClick={() => {
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

      {/* Count */}
      {!loading && runs.length > 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          Showing <span className="font-semibold text-[var(--text)]">{filtered.length}</span> of{' '}
          <span className="font-semibold text-[var(--text)]">{runs.length}</span> records
        </p>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading process records...
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No process records yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Start a process run from the Processes page to see records here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <Search className="mx-auto h-10 w-10 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No matching records</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const def = definitions[r.process_definition_id];
            const isExpanded = expandedId === r.id;
            const delta = weightDelta(r);
            const items = r.batch_items ?? [];
            return (
              <div
                key={r.id}
                className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"
              >
                {/* Summary row */}
                <button
                  onClick={() => toggleExpand(r.id)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[var(--surface-hover)]"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 shrink-0 text-[var(--text-muted)]" />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-[var(--text-muted)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-[var(--text)]">
                        {def?.name ?? 'Unknown process'}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGES[r.status]}`}
                      >
                        {STATUS_LABELS[r.status]}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                      <span>{r.employee_name ?? 'Unassigned'}{r.employee_id ? ` · ID: ${r.employee_id}` : ''}</span>
                      {r.started_at && <span>Started: {formatDateTime(r.started_at)}</span>}
                      {r.completed_at && <span>Completed: {formatDateTime(r.completed_at)}</span>}
                    </div>
                  </div>
                  {r.reconciliation_result && riskManagementEnabled && (
                    <span
                      className={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium sm:inline ${
                        (typeof r.reconciliation_result === 'string'
                          ? r.reconciliation_result
                          : (r.reconciliation_result as Record<string, unknown>).matched)
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                      }`}
                    >
                      {typeof r.reconciliation_result === 'string'
                        ? r.reconciliation_result
                        : (r.reconciliation_result as Record<string, unknown>).matched
                          ? 'matched'
                          : 'mismatch'}
                    </span>
                  )}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)] p-4">
                    <div className="mb-4 flex justify-end">
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="flex items-center gap-1.5 rounded-lg border border-error-500/30 px-3 py-1.5 text-xs font-medium text-error-500 hover:bg-error-500/5"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete record
                      </button>
                    </div>
                    {riskManagementEnabled && (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div className="rounded-lg bg-[var(--surface-hover)] p-3">
                        <p className="text-xs text-[var(--text-subtle)]">Start Weight</p>
                        <p className="mt-1 text-sm font-semibold text-[var(--text)]">
                          {r.start_total_weight != null ? `${r.start_total_weight} kg` : '—'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-hover)] p-3">
                        <p className="text-xs text-[var(--text-subtle)]">End Weight</p>
                        <p className="mt-1 text-sm font-semibold text-[var(--text)]">
                          {r.end_total_weight != null ? `${r.end_total_weight} kg` : '—'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-hover)] p-3">
                        <p className="text-xs text-[var(--text-subtle)]">Delta</p>
                        <p
                          className={`mt-1 text-sm font-semibold ${
                            delta == null
                              ? 'text-[var(--text-subtle)]'
                              : delta === 0
                                ? 'text-[var(--text)]'
                                : delta > 0
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {delta != null ? `${delta > 0 ? '+' : ''}${delta} kg` : '—'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-hover)] p-3">
                        <p className="text-xs text-[var(--text-subtle)]">Reconciliation</p>
                        <p className="mt-1 text-sm font-semibold text-[var(--text)]">
                          {r.reconciliation_result
                            ? (typeof r.reconciliation_result === 'string'
                                ? r.reconciliation_result
                                : (r.reconciliation_result as Record<string, unknown>).matched
                                  ? 'Matched'
                                  : `Mismatch (${Number((r.reconciliation_result as Record<string, unknown>).delta).toFixed(2)} kg)`)
                            : '—'}
                        </p>
                      </div>
                    </div>
                    )}

                    {/* Trolley QR and batch photo */}
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {r.trolley_qr_value && (
                        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2.5">
                          <Truck className="h-4 w-4 shrink-0 text-primary-600" />
                          <div>
                            <p className="text-xs text-[var(--text-subtle)]">Trolley QR</p>
                            <p className="font-mono text-xs text-[var(--text)]">{r.trolley_qr_value}</p>
                          </div>
                        </div>
                      )}
                      {r.batch_photo_url && (
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-2">
                          <p className="mb-1 flex items-center gap-1 text-xs text-[var(--text-subtle)]"><Camera className="h-3 w-3" /> Batch Photo</p>
                          <img src={r.batch_photo_url} alt="Batch" className="w-full rounded" style={{ maxHeight: '150px', objectFit: 'contain' }} />
                        </div>
                      )}
                    </div>

                    {/* Batch items */}
                    <div className="mt-4">
                      <h4 className="mb-2 text-sm font-semibold text-[var(--text)]">
                        Batch Items ({items.length})
                      </h4>
                      {items.length === 0 ? (
                        <p className="rounded-lg bg-[var(--surface-hover)] px-3 py-2 text-xs text-[var(--text-muted)]">
                          No batch items recorded.
                        </p>
                      ) : (
                        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--surface-hover)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                              <tr>
                                <th className="px-3 py-2 font-semibold">Item</th>
                                <th className="px-3 py-2 font-semibold">Start Weight</th>
                                <th className="px-3 py-2 font-semibold">End Weight</th>
                                <th className="px-3 py-2 font-semibold">Delta</th>
                                <th className="px-3 py-2 font-semibold">Source</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                              {items.map((item, idx) => {
                                const sw = item.start_weight ?? item.weight;
                                const ew = item.end_weight;
                                const delta = (sw != null && ew != null) ? ew - sw : null;
                                return (
                                  <tr key={item.id ?? idx} className="text-[var(--text)]">
                                    <td className="px-3 py-2 font-mono text-xs">
                                      {item.qr_value ?? item.item_type ?? `Item ${idx + 1}`}
                                    </td>
                                    <td className="px-3 py-2">
                                      {sw != null ? (
                                        <span className={item.weight_source === 'manual' ? 'font-medium text-amber-600 dark:text-amber-400' : ''}>
                                          {sw} kg
                                          {item.weight_source === 'manual' && <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">manual</span>}
                                        </span>
                                      ) : <span className="text-[var(--text-subtle)]">—</span>}
                                    </td>
                                    <td className="px-3 py-2">
                                      {ew != null ? (
                                        <span className={item.end_weight_source === 'manual' ? 'font-medium text-amber-600 dark:text-amber-400' : ''}>
                                          {ew} kg
                                          {item.end_weight_source === 'manual' && <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">manual</span>}
                                        </span>
                                      ) : <span className="text-[var(--text-subtle)]">—</span>}
                                    </td>
                                    <td className="px-3 py-2">
                                      {delta != null ? (
                                        <span className={`font-medium ${delta === 0 ? 'text-accent-600 dark:text-accent-400' : 'text-error-500'}`}>
                                          {delta > 0 ? '+' : ''}{delta.toFixed(2)} kg
                                        </span>
                                      ) : <span className="text-[var(--text-subtle)]">—</span>}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                                      {item.weight_source === 'manual' || item.end_weight_source === 'manual' ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                          Manual
                                        </span>
                                      ) : item.weight_source === 'auto' || item.end_weight_source === 'auto' ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                          Auto
                                        </span>
                                      ) : '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-500/10">
                <AlertTriangle className="h-6 w-6 text-error-500" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)]">Delete process run?</h3>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                This will permanently delete the run and all associated scan records. This cannot be undone.
              </p>
              <div className="mt-6 flex w-full gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-error-500 py-2.5 text-sm font-semibold text-white hover:bg-error-600 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
