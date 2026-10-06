import { useEffect, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/qr';

interface Validation {
  id: string;
  company_id: string;
  source_ip: string | null;
  result: string;
  created_at: string;
  company: { company_name: string } | null;
}

const resultColors: Record<string, string> = {
  active: 'bg-accent-500/10 text-accent-600',
  expired: 'bg-warning-500/10 text-warning-500',
  suspended: 'bg-error-500/10 text-error-500',
  deactivated: 'bg-neutral-500/10 text-neutral-500',
};

export function ValidationsPage() {
  const [validations, setValidations] = useState<Validation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('license_validations')
        .select('*, company:companies(company_name)')
        .order('created_at', { ascending: false })
        .limit(200);
      setValidations(data ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = validations.filter((v) => (v.company?.company_name ?? '').toLowerCase().includes(search.toLowerCase()) || v.result.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Validation History</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Every license validation ping from customer instances.</p>
      </div>

      {validations.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by company or result..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20" />
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <ScrollText className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No validation records yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Validations appear when customer instances check their license.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-4 py-3.5 hover:bg-[var(--surface-hover)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/10">
                    <ScrollText className="h-4.5 w-4.5 text-primary-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">{v.company?.company_name ?? 'Unknown company'}</p>
                    <p className="text-xs text-[var(--text-muted)]">{v.source_ip ?? 'IP not recorded'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${resultColors[v.result] ?? resultColors.active}`}>{v.result}</span>
                  <span className="text-xs text-[var(--text-subtle)]">{formatDateTime(v.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
