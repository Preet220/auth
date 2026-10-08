import { useEffect, useState } from 'react';
import { Building2, Plus, Search, X, Loader as Loader2, Users, ShieldOff, Power, RefreshCw, Pencil, Trash2, TriangleAlert as AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/qr';

interface Company {
  id: string;
  company_name: string;
  license_key: string;
  license_status: string;
  subscription_tier: string;
  subscription_start: string;
  subscription_end: string;
  admin_cap: number;
  employee_cap: number;
  current_admin_count: number;
  current_employee_count: number;
  risk_management_enabled: boolean;
  created_at: string;
}

const statusColors: Record<string, string> = {
  active: 'bg-accent-500/10 text-accent-600',
  expired: 'bg-warning-500/10 text-warning-500',
  suspended: 'bg-error-500/10 text-error-500',
  deactivated: 'bg-neutral-500/10 text-neutral-500',
};

function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments: string[] = [];
  for (let s = 0; s < 4; s++) {
    let seg = '';
    for (let i = 0; i < 5; i++) seg += chars[Math.floor(Math.random() * chars.length)];
    segments.push(seg);
  }
  return segments.join('-');
}

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Form state
  const [fName, setFName] = useState('');
  const [fAdminCap, setFAdminCap] = useState(5);
  const [fEmployeeCap, setFEmployeeCap] = useState(50);
  const [fTier, setFTier] = useState('starter');
  const [fDuration, setFDuration] = useState(12);
  const [fKey, setFKey] = useState('');
  const [fRiskEnabled, setFRiskEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchCompanies = async () => {
    const { data } = await supabase.from('companies').select('*').order('created_at', { ascending: false });
    setCompanies(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchCompanies(); }, []);

  const filtered = companies.filter(
    (c) => c.company_name.toLowerCase().includes(search.toLowerCase()) || c.license_key.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setFName(''); setFAdminCap(5); setFEmployeeCap(50); setFTier('starter'); setFDuration(12);
    setFKey(generateLicenseKey()); setFRiskEnabled(true);
    setShowCreate(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fName.trim()) return;
    setSaving(true);
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + fDuration);

    const { data } = await supabase
      .from('companies')
      .insert({
        company_name: fName.trim(),
        license_key: fKey,
        license_status: 'active',
        subscription_tier: fTier,
        subscription_end: endDate.toISOString(),
        admin_cap: fAdminCap,
        employee_cap: fEmployeeCap,
        risk_management_enabled: fRiskEnabled,
      })
      .select()
      .single();

    if (data) {
      await supabase.from('license_keys').insert({
        key_value: fKey,
        company_id: data.id,
        status: 'available',
      });
      setCompanies((prev) => [data, ...prev]);
    }
    setShowCreate(false);
    setSaving(false);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    const endDate = new Date(editTarget.subscription_start);
    endDate.setMonth(endDate.getMonth() + fDuration);

    const { data } = await supabase
      .from('companies')
      .update({
        admin_cap: fAdminCap,
        employee_cap: fEmployeeCap,
        subscription_tier: fTier,
        subscription_end: endDate.toISOString(),
        risk_management_enabled: fRiskEnabled,
      })
      .eq('id', editTarget.id)
      .select()
      .single();

    if (data) {
      setCompanies((prev) => prev.map((c) => (c.id === data.id ? data : c)));
    }
    setEditTarget(null);
    setSaving(false);
  };

  const changeStatus = async (company: Company, status: string) => {
    const { data } = await supabase.from('companies').update({ license_status: status, updated_at: new Date().toISOString() }).eq('id', company.id).select().single();
    if (data) setCompanies((prev) => prev.map((c) => (c.id === data.id ? data : c)));
  };

  const openEdit = (c: Company) => {
    setEditTarget(c);
    setFAdminCap(c.admin_cap); setFEmployeeCap(c.employee_cap); setFTier(c.subscription_tier);
    setFRiskEnabled(c.risk_management_enabled ?? true);
    const monthsLeft = Math.max(1, Math.round((new Date(c.subscription_end).getTime() - new Date(c.subscription_start).getTime()) / (1000 * 60 * 60 * 24 * 30)));
    setFDuration(monthsLeft);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    const { error } = await supabase.rpc('delete_company', { p_company_id: deleteTarget.id });
    if (error) {
      setDeleteError(error.message || 'Failed to delete company. Please try again.');
      setDeleting(false);
      return;
    }
    setCompanies((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Companies</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Manage all customer companies, license keys, and caps.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700">
          <Plus className="h-4 w-4" />
          New company
        </button>
      </div>

      {companies.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or license key..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">Loading companies...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <Building2 className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">{search ? 'No companies found' : 'No companies yet'}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{search ? 'Try a different search.' : 'Create your first company to generate a license key.'}</p>
          {!search && (
            <button onClick={openCreate} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
              <Plus className="h-4 w-4" /> Create company
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-hover)]">
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Company</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">License Key</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Status</th>
                  <th className="px-4 py-3 text-center font-medium text-[var(--text-muted)]">Admins</th>
                  <th className="px-4 py-3 text-center font-medium text-[var(--text-muted)]">Employees</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Tier</th>
                  <th className="px-4 py-3 text-center font-medium text-[var(--text-muted)]">Risk Mgmt</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Expires</th>
                  <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-[var(--surface-hover)]">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--text)]">{c.company_name}</p>
                      <p className="text-xs text-[var(--text-subtle)]">{formatDate(c.created_at)}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">{c.license_key}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[c.license_status] ?? statusColors.active}`}>
                        {c.license_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-[var(--text)]">{c.current_admin_count}/{c.admin_cap}</td>
                    <td className="px-4 py-3 text-center text-[var(--text)]">{c.current_employee_count}/{c.employee_cap}</td>
                    <td className="px-4 py-3 capitalize text-[var(--text)]">{c.subscription_tier}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.risk_management_enabled ? 'bg-accent-500/10 text-accent-600' : 'bg-neutral-500/10 text-neutral-500'}`}>
                        <AlertTriangle className="h-3 w-3" />
                        {c.risk_management_enabled ? 'On' : 'Off'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{formatDate(c.subscription_end)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(c)} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-primary-600" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </button>
                        {c.license_status === 'active' ? (
                          <>
                            <button onClick={() => changeStatus(c, 'suspended')} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-warning-500/10 hover:text-warning-500" title="Suspend">
                              <ShieldOff className="h-4 w-4" />
                            </button>
                            <button onClick={() => changeStatus(c, 'deactivated')} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-error-500/10 hover:text-error-500" title="Deactivate">
                              <Power className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <button onClick={() => changeStatus(c, 'active')} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-accent-500/10 hover:text-accent-600" title="Reactivate">
                            <RefreshCw className="h-4 w-4" />
                          </button>
                        )}
                        <button onClick={() => { setDeleteTarget(c); setDeleteError(''); }} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-error-500/10 hover:text-error-500" title="Delete company">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCreate(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text)]">New Company</h3>
              <button onClick={() => setShowCreate(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Company name <span className="text-error-500">*</span></label>
                <input type="text" value={fName} onChange={(e) => setFName(e.target.value)} required autoFocus disabled={saving}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">License key</label>
                <div className="flex gap-2">
                  <input type="text" value={fKey} readOnly className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2.5 font-mono text-sm text-[var(--text)] outline-none" />
                  <button type="button" onClick={() => setFKey(generateLicenseKey())} className="rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text)] hover:bg-[var(--surface-hover)]">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Admin cap</label>
                  <input type="number" value={fAdminCap} onChange={(e) => setFAdminCap(Number(e.target.value))} min={1} disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Employee cap</label>
                  <input type="number" value={fEmployeeCap} onChange={(e) => setFEmployeeCap(Number(e.target.value))} min={1} disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Tier</label>
                  <select value={fTier} onChange={(e) => setFTier(e.target.value)} disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 disabled:opacity-50">
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Duration (months)</label>
                  <input type="number" value={fDuration} onChange={(e) => setFDuration(Number(e.target.value))} min={1} disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-500" />
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">Risk Management</p>
                    <p className="text-xs text-[var(--text-muted)]">Enable risk rules and alerts</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFRiskEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${fRiskEnabled ? 'bg-accent-600' : 'bg-neutral-400'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${fRiskEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} disabled={saving} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={saving || !fName.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : 'Create company'}
                </button>
              </div>
            </form>
          </div>
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
              <h3 className="text-lg font-semibold text-[var(--text)]">Delete {deleteTarget.company_name}?</h3>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                This will permanently delete the company and <strong className="text-[var(--text)]">all related data</strong>:
                admins, employees, process definitions, process runs, scan records, QR codes,
                seals, risk rules, risk alerts, activity logs, and all associated user accounts.
                This action cannot be undone.
              </p>
              {deleteError && (
                <p className="mt-3 w-full rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-500">{deleteError}</p>
              )}
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
                  Delete everything
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditTarget(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text)]">Edit {editTarget.company_name}</h3>
              <button onClick={() => setEditTarget(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Admin cap</label>
                  <input type="number" value={fAdminCap} onChange={(e) => setFAdminCap(Number(e.target.value))} min={0} disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Employee cap</label>
                  <input type="number" value={fEmployeeCap} onChange={(e) => setFEmployeeCap(Number(e.target.value))} min={0} disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Tier</label>
                  <select value={fTier} onChange={(e) => setFTier(e.target.value)} disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 disabled:opacity-50">
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Extend (months from start)</label>
                  <input type="number" value={fDuration} onChange={(e) => setFDuration(Number(e.target.value))} min={1} disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                </div>
              </div>
              <div className="rounded-lg bg-[var(--surface-hover)] p-3 text-xs text-[var(--text-muted)]">
                <p>Current: {editTarget.current_admin_count} admins, {editTarget.current_employee_count} employees</p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-500" />
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">Risk Management</p>
                    <p className="text-xs text-[var(--text-muted)]">Enable risk rules and alerts</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFRiskEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${fRiskEnabled ? 'bg-accent-600' : 'bg-neutral-400'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${fRiskEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditTarget(null)} disabled={saving} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
