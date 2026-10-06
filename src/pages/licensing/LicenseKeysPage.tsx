import { useEffect, useState } from 'react';
import { KeyRound, Search, Copy, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/qr';

interface LicenseKeyRow {
  id: string;
  key_value: string;
  company_id: string | null;
  issued_at: string;
  revoked_at: string | null;
  status: string;
  company: { company_name: string } | null;
}

export function LicenseKeysPage() {
  const [keys, setKeys] = useState<LicenseKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('license_keys')
        .select('*, company:companies(company_name)')
        .order('issued_at', { ascending: false });
      setKeys(data ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = keys.filter((k) => k.key_value.toLowerCase().includes(search.toLowerCase()) || (k.company?.company_name ?? '').toLowerCase().includes(search.toLowerCase()));

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">License Keys</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">All license keys issued to companies.</p>
      </div>

      {keys.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by key or company..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20" />
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <KeyRound className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No license keys yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Keys are generated when you create a company.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-hover)]">
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">License Key</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Company</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Issued</th>
                  <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">Copy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((k) => (
                  <tr key={k.id} className="hover:bg-[var(--surface-hover)]">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text)]">{k.key_value}</td>
                    <td className="px-4 py-3 text-[var(--text)]">{k.company?.company_name ?? 'Unassigned'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${k.status === 'active' ? 'bg-accent-500/10 text-accent-600' : 'bg-neutral-500/10 text-neutral-500'}`}>{k.status}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{formatDate(k.issued_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => copyKey(k.key_value)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-primary-600">
                        {copied === k.key_value ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
