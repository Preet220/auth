import { useEffect, useState, useCallback, useMemo } from 'react';
import { ScrollText, Search, Download, ListFilter as Filter, Image as ImageIcon, Loader as Loader2, FileSpreadsheet, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { formatDate, formatDateTime } from '@/lib/qr';

type ScanType = 'checkpoint' | 'item' | 'trolley' | 'seal';

interface ScanRecord {
  id: string;
  scan_type: ScanType;
  qr_value: string;
  employee_id: string | null;
  employee_name: string | null;
  employee_email: string | null;
  weight: number | null;
  weight_source: string | null;
  photo_url: string | null;
  checkpoint_name: string | null;
  item_type: string | null;
  trolley_id: string | null;
  seal_serial: string | null;
  process_run_id: string | null;
  created_at: string;
}

const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  checkpoint: 'Checkpoint',
  item: 'Item',
  trolley: 'Trolley',
  seal: 'Seal',
};

const SCAN_TYPE_BADGES: Record<ScanType, string> = {
  checkpoint: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  item: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  trolley: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  seal: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};

const FILTER_OPTIONS: { value: ScanType | 'all'; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'checkpoint', label: 'Checkpoint' },
  { value: 'item', label: 'Item' },
  { value: 'trolley', label: 'Trolley' },
  { value: 'seal', label: 'Seal' },
];

interface EmployeeOption {
  id: string;
  name: string;
}

interface ProcessRunOption {
  id: string;
  process_name: string;
  started_at: string | null;
}

export function ScansPage() {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scanType, setScanType] = useState<ScanType | 'all'>('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [processRunFilter, setProcessRunFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<ScanRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [processRuns, setProcessRuns] = useState<ProcessRunOption[]>([]);

  const fetchScans = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('scan_records')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setScans(data as ScanRecord[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

  useEffect(() => {
    if (scans.length === 0) return;
    const uniqueEmployees = Array.from(
      new Map(
        scans
          .filter((s) => s.employee_id)
          .map((s) => [s.employee_id!, { id: s.employee_id!, name: s.employee_name ?? s.employee_id! }]),
      ).values(),
    ).sort((a, b) => a.name.localeCompare(b.name));
    setEmployees(uniqueEmployees);
  }, [scans]);

  useEffect(() => {
    if (scans.length === 0) return;
    const runIds = Array.from(new Set(scans.map((s) => s.process_run_id).filter(Boolean))) as string[];
    if (runIds.length === 0) return;
    supabase
      .from('process_runs')
      .select('id, process_definition_id, started_at')
      .in('id', runIds)
      .then(({ data }) => {
        if (!data) return;
        const defIds = Array.from(new Set(data.map((r) => r.process_definition_id).filter(Boolean))) as string[];
        if (defIds.length === 0) {
          setProcessRuns(data.map((r) => ({ id: r.id, process_name: 'Unknown', started_at: r.started_at })));
          return;
        }
        supabase
          .from('process_definitions')
          .select('id, name')
          .in('id', defIds)
          .then(({ data: defs }) => {
            const defMap = new Map((defs ?? []).map((d) => [d.id, d.name]));
            setProcessRuns(
              data.map((r) => ({
                id: r.id,
                process_name: defMap.get(r.process_definition_id) ?? 'Unknown',
                started_at: r.started_at,
              })),
            );
          });
      });
  }, [scans]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTime = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
    const toTime = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : null;
    return scans.filter((s) => {
      if (scanType !== 'all' && s.scan_type !== scanType) return false;
      if (employeeFilter !== 'all' && s.employee_id !== employeeFilter) return false;
      if (processRunFilter !== 'all' && s.process_run_id !== processRunFilter) return false;
      if (fromTime !== null && new Date(s.created_at).getTime() < fromTime) return false;
      if (toTime !== null && new Date(s.created_at).getTime() > toTime) return false;
      if (!q) return true;
      return (
        s.qr_value.toLowerCase().includes(q) ||
        (s.employee_name ?? '').toLowerCase().includes(q) ||
        (s.employee_id ?? '').toLowerCase().includes(q) ||
        (s.checkpoint_name ?? '').toLowerCase().includes(q) ||
        (s.trolley_id ?? '').toLowerCase().includes(q) ||
        (s.seal_serial ?? '').toLowerCase().includes(q)
      );
    });
  }, [scans, search, scanType, employeeFilter, processRunFilter, dateFrom, dateTo]);

  const hasActiveFilters =
    scanType !== 'all' ||
    employeeFilter !== 'all' ||
    processRunFilter !== 'all' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    search.trim().length > 0;

  const activeFilterCount =
    (scanType !== 'all' ? 1 : 0) +
    (employeeFilter !== 'all' ? 1 : 0) +
    (processRunFilter !== 'all' ? 1 : 0) +
    (dateFrom !== '' ? 1 : 0) +
    (dateTo !== '' ? 1 : 0);

  const clearAllFilters = () => {
    setScanType('all');
    setEmployeeFilter('all');
    setProcessRunFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  };

  const buildExportData = () =>
    filtered.map((s) => ({
      'Scan Type': SCAN_TYPE_LABELS[s.scan_type] ?? s.scan_type,
      'QR Value': s.qr_value,
      'Employee Name': s.employee_name ?? '',
      'Employee ID': s.employee_id ?? '',
      'Employee Email': s.employee_email ?? '',
      'Checkpoint': s.checkpoint_name ?? '',
      'Item Type': s.item_type ?? '',
      'Trolley ID': s.trolley_id ?? '',
      'Seal Serial': s.seal_serial ?? '',
      'Weight': s.weight != null ? s.weight : '',
      'Manual Weight': s.weight_source === 'manual' ? 'Yes' : 'No',
      'Photo URL': s.photo_url ?? '',
      'Process Run ID': s.process_run_id ?? '',
      'Timestamp': s.created_at,
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
      link.download = `scans-${new Date().toISOString().slice(0, 10)}.csv`;
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
      XLSX.utils.book_append_sheet(wb, ws, 'Scan Records');
      XLSX.writeFile(wb, `scans-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Scan Records</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            View and export all QR scans recorded across checkpoints.
          </p>
        </div>
        {scans.length > 0 && (
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

      {/* Search + Filters */}
      {scans.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by QR value or employee..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
              hasActiveFilters
                ? 'border-primary-500/40 bg-primary-500/10 text-primary-700 dark:text-primary-300'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            <Filter className="h-4 w-4" />
            Filter
            {activeFilterCount > 0 && (
              <span className="ml-1 inline-flex h-5 items-center rounded-full bg-primary-500/20 px-2 text-xs font-semibold text-primary-700 dark:text-primary-300">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Filter panel */}
      {showFilters && scans.length > 0 && (
        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {/* Scan type chips */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Scan type</p>
            <div className="flex flex-wrap gap-2">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setScanType(opt.value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    scanType === opt.value
                      ? 'bg-primary-600 text-white'
                      : 'border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Employee filter */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Employee</p>
              <select
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="all">All employees</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Process run filter */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Process run</p>
              {processRuns.length > 0 ? (
                <select
                  value={processRunFilter}
                  onChange={(e) => setProcessRunFilter(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value="all">All process runs</option>
                  {processRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.process_name}{run.started_at ? ` — ${formatDate(run.started_at)}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-[var(--text-subtle)]">No process runs linked to scans</p>
              )}
            </div>
          </div>

          {/* Date range filter */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Date range</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-[var(--text-subtle)]">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
              <div className="hidden pt-6 text-[var(--text-subtle)] sm:block">—</div>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-[var(--text-subtle)]">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
              {(dateFrom !== '' || dateTo !== '') && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="mt-6 flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
                >
                  <X className="h-3.5 w-3.5" /> Clear dates
                </button>
              )}
            </div>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Results count */}
      {!loading && scans.length > 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          Showing <span className="font-semibold text-[var(--text)]">{filtered.length}</span> of{' '}
          <span className="font-semibold text-[var(--text)]">{scans.length}</span> records
        </p>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading scan records...
        </div>
      ) : scans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <ScrollText className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No scan records yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Scans will appear here once employees start scanning QR codes.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <Search className="mx-auto h-10 w-10 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No matching records</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-hover)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">QR Value</th>
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Checkpoint</th>
                  <th className="px-4 py-3 font-semibold">Details</th>
                  <th className="px-4 py-3 font-semibold">Weight</th>
                  <th className="px-4 py-3 font-semibold">Photo</th>
                  <th className="px-4 py-3 font-semibold">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((s) => (
                  <tr key={s.id} className="transition-colors hover:bg-[var(--surface-hover)]">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SCAN_TYPE_BADGES[s.scan_type]}`}
                      >
                        {SCAN_TYPE_LABELS[s.scan_type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text)]">{s.qr_value}</td>
                    <td className="px-4 py-3 text-[var(--text)]">
                      <div>{s.employee_name ?? '—'}</div>
                      {s.employee_email && (
                        <div className="text-xs text-[var(--text-subtle)]">{s.employee_email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{s.checkpoint_name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                      {s.item_type && <div>Item: {s.item_type}</div>}
                      {s.trolley_id && <div>Trolley: {s.trolley_id}</div>}
                      {s.seal_serial && <div>Seal: {s.seal_serial}</div>}
                      {!s.item_type && !s.trolley_id && !s.seal_serial && <span className="text-[var(--text-subtle)]">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {s.weight != null ? (
                        <span
                          className={`font-medium ${
                            s.weight_source === 'manual'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-[var(--text)]'
                          }`}
                        >
                          {s.weight} kg
                          {s.weight_source === 'manual' && (
                            <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">manual</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--text-subtle)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.photo_url ? (
                        <button
                          onClick={() => setPhotoPreview(s)}
                          className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] transition-colors hover:border-primary-500/40"
                          title="View photo"
                        >
                          <img
                            src={s.photo_url}
                            alt="Scan thumbnail"
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ) : (
                        <ImageIcon className="h-4 w-4 text-[var(--text-subtle)]" />
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">
                      {formatDateTime(s.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SCAN_TYPE_BADGES[s.scan_type]}`}
                    >
                      {SCAN_TYPE_LABELS[s.scan_type]}
                    </span>
                    <p className="mt-2 truncate font-mono text-sm text-[var(--text)]">{s.qr_value}</p>
                  </div>
                  {s.photo_url && (
                    <button
                      onClick={() => setPhotoPreview(s)}
                      className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-[var(--border)]"
                    >
                      <img src={s.photo_url} alt="Scan" className="h-full w-full object-cover" />
                    </button>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-[var(--text-subtle)]">Employee</dt>
                    <dd className="text-[var(--text)]">
                      {s.employee_name ?? '—'}
                      {s.employee_email && (
                        <div className="text-xs text-[var(--text-subtle)]">{s.employee_email}</div>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--text-subtle)]">Checkpoint</dt>
                    <dd className="text-[var(--text-muted)]">{s.checkpoint_name ?? '—'}</dd>
                  </div>
                  {(s.trolley_id || s.seal_serial || s.item_type) && (
                    <div className="col-span-2">
                      <dt className="text-xs text-[var(--text-subtle)]">Details</dt>
                      <dd className="text-xs text-[var(--text-muted)]">
                        {s.item_type && <span className="mr-3">Item: {s.item_type}</span>}
                        {s.trolley_id && <span className="mr-3">Trolley: {s.trolley_id}</span>}
                        {s.seal_serial && <span>Seal: {s.seal_serial}</span>}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-[var(--text-subtle)]">Weight</dt>
                    <dd>
                      {s.weight != null ? (
                        <span
                          className={
                            s.weight_source === 'manual'
                              ? 'font-medium text-amber-600 dark:text-amber-400'
                              : 'text-[var(--text)]'
                          }
                        >
                          {s.weight} kg{s.weight_source === 'manual' ? ' (manual)' : ''}
                        </span>
                      ) : (
                        <span className="text-[var(--text-subtle)]">—</span>
                      )}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-[var(--text-subtle)]">Timestamp</dt>
                    <dd className="text-[var(--text-muted)]">{formatDateTime(s.created_at)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Photo preview modal */}
      {photoPreview && photoPreview.photo_url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setPhotoPreview(null)}
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold text-[var(--text)]">
                  Scan Photo
                </h3>
                <p className="mt-0.5 truncate font-mono text-xs text-[var(--text-muted)]">
                  {photoPreview.qr_value}
                </p>
              </div>
              <button
                onClick={() => setPhotoPreview(null)}
                className="ml-4 shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                ✕
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-black/5">
              <img
                src={photoPreview.photo_url}
                alt={`Photo for ${photoPreview.qr_value}`}
                className="mx-auto max-h-[60vh] w-auto object-contain"
              />
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-[var(--text-muted)]">
              <span>{SCAN_TYPE_LABELS[photoPreview.scan_type]}</span>
              <span>{formatDateTime(photoPreview.created_at)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
