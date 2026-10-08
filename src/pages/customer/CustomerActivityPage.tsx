import { useEffect, useState, useCallback } from 'react';
import { ScrollText, Search, Download, FileSpreadsheet, Loader as Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/qr';

interface LogEntry {
  id: string;
  actor_id: string;
  actor_email: string;
  actor_role: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export function CustomerActivityPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from('customer_activity_logs')
      .select('*')
      .order('created_at', { ascending: false });
    setLogs(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const filtered = logs.filter((l) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return l.action.toLowerCase().includes(q) || l.actor_email.toLowerCase().includes(q) || l.actor_role.toLowerCase().includes(q);
  });

  const buildExportData = () =>
    filtered.map((l) => ({
      'Action': l.action.replace(/_/g, ' '),
      'Actor Email': l.actor_email,
      'Actor Role': l.actor_role,
      'Actor ID': l.actor_id,
      'Details': l.details ? JSON.stringify(l.details) : '',
      'Timestamp': formatDateTime(l.created_at),
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
      link.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
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
      XLSX.utils.book_append_sheet(wb, ws, 'Activity Log');
      XLSX.writeFile(wb, `activity-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Activity Log</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Every meaningful action recorded in the system.</p>
        </div>
        {logs.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={exporting || filtered.length === 0}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              CSV
            </button>
            <button
              onClick={handleExportExcel}
              disabled={exporting || filtered.length === 0}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Excel
            </button>
          </div>
        )}
      </div>

      {logs.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by action or person..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20" />
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <ScrollText className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No activity yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Actions will appear here as they happen.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((log) => (
              <div key={log.id} className="flex items-center justify-between px-4 py-3.5 hover:bg-[var(--surface-hover)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/10">
                    <ScrollText className="h-4 w-4 text-primary-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--text)] capitalize">{log.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-[var(--text-muted)]">{log.actor_email} ({log.actor_role})</p>
                  </div>
                </div>
                <span className="text-xs text-[var(--text-subtle)]">{formatDateTime(log.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
