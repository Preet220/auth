import { useEffect, useState, useCallback, useRef } from 'react';
import { Users, Plus, X, Check, Trash2, Loader as Loader2, ScrollText, Building2, UserCheck, Upload, Download, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/qr';

interface Admin {
  id: string;
  user_id: string | null;
  work_email: string;
  admin_name: string;
  employee_id: string | null;
  status: string;
  created_by: string;
  created_at: string;
  company_id: string | null;
}

interface LogEntry {
  id: string;
  actor_email: string;
  actor_role: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export function CompanyDashboard() {
  const { appUser } = useAuth();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [adminCap, setAdminCap] = useState(5);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Admin | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    const { data: companyData } = await supabase
      .from('companies')
      .select('id, admin_cap')
      .eq('user_id', appUser?.id ?? '')
      .maybeSingle();

    const cId = companyData?.id ?? null;
    const cap = companyData?.admin_cap ?? 5;
    setCompanyId(cId);
    setAdminCap(cap);

    const [{ data: adminData }, { data: logData }] = await Promise.all([
      supabase.from('admins').select('*').eq('company_id', cId ?? '').order('created_at', { ascending: false }),
      supabase.from('customer_activity_logs').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    setAdmins((adminData as Admin[]) ?? []);
    setLogs(logData ?? []);
    setLoading(false);
  }, [appUser?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const activeAdmins = admins.filter((a) => a.status === 'approved');
  const pendingAdmins = admins.filter((a) => a.status === 'pending');
  const capReached = activeAdmins.length >= adminCap;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    if (activeAdmins.length >= adminCap) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('admins')
      .insert({
        work_email: email.trim(),
        admin_name: adminName.trim() || email.split('@')[0],
        employee_id: employeeId.trim() || null,
        status: 'approved',
        created_by: appUser?.email ?? '',
        company_id: companyId,
      })
      .select()
      .single();

    if (error) {
      setCreating(false);
      return;
    }
    if (data) {
      setAdmins((prev) => [data as Admin, ...prev]);
      await supabase.from('customer_activity_logs').insert({
        actor_id: appUser?.id ?? '',
        actor_email: appUser?.email ?? '',
        actor_role: 'company',
        action: 'admin_created',
        details: { email: email.trim(), name: adminName.trim() },
      });
    }
    setShowCreate(false);
    setEmail('');
    setAdminName('');
    setEmployeeId('');
    setCreating(false);
    fetchData();
  };

  const parseCsv = (text: string): { name: string; work_email: string; employee_id: string }[] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const results: { name: string; work_email: string; employee_id: string }[] = [];
    const skipHeaders = new Set(['admin_name', 'name', 'work_email', 'employee_id', 'email']);
    for (const line of lines) {
      const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^["']|["']$/g, ''));
      if (skipHeaders.has(cells[0]?.toLowerCase())) continue;
      if (cells.length >= 3) {
        results.push({ name: cells[0], work_email: cells[1], employee_id: cells[2] });
      }
    }
    return results;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        setUploadMsg({ type: 'error', text: 'No valid rows found. Ensure your file has columns: admin_name, work_email, employee_id' });
        setUploading(false);
        return;
      }

      const existingEmails = new Set(admins.map((a) => a.work_email.toLowerCase()));
      const newRows = parsed.filter((p) => !existingEmails.has(p.work_email.toLowerCase()));
      const skipped = parsed.length - newRows.length;

      if (newRows.length === 0) {
        setUploadMsg({ type: 'error', text: 'All admins in the file already exist.' });
        setUploading(false);
        return;
      }

      const availableSlots = adminCap - activeAdmins.length;
      const toInsert = newRows.slice(0, availableSlots);
      const { error } = await supabase.from('admins').insert(
        toInsert.map((r) => ({
          admin_name: r.name,
          work_email: r.work_email,
          employee_id: r.employee_id,
          status: 'approved',
          created_by: appUser?.email ?? '',
          company_id: companyId,
        }))
      );

      if (error) {
        setUploadMsg({ type: 'error', text: error.message });
      } else {
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: 'company',
          action: 'admin_excel_upload',
          details: { added: toInsert.length, skipped },
        });
        setUploadMsg({
          type: 'success',
          text: `Added ${toInsert.length} admin(s)${skipped > 0 ? `, ${skipped} already existed` : ''}${toInsert.length < newRows.length ? `, ${newRows.length - toInsert.length} skipped due to cap` : ''}. All are pre-approved and can sign up immediately.`,
        });
        fetchData();
      }
    } catch {
      setUploadMsg({ type: 'error', text: 'Failed to read the file. Please use a valid CSV.' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadTemplate = () => {
    const csv = 'admin_name,work_email,employee_id\nJohn Doe,john@company.com,ADM001\nJane Smith,jane@company.com,ADM002\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'admin-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleApprove = async (admin: Admin) => {
    const { error } = await supabase.from('admins').update({ status: 'approved' }).eq('id', admin.id);
    if (error) return;
    setAdmins((prev) => prev.map((a) => (a.id === admin.id ? { ...a, status: 'approved' } : a)));
    await supabase.from('customer_activity_logs').insert({
      actor_id: appUser?.id ?? '',
      actor_email: appUser?.email ?? '',
      actor_role: 'company',
      action: 'admin_approved',
      details: { email: admin.work_email },
    });
  };

  const handleRemove = async (admin: Admin) => {
    setDeleting(true);
    const { error } = await supabase.from('admins').update({ status: 'removed' }).eq('id', admin.id);
    if (!error) {
      setAdmins((prev) => prev.map((a) => (a.id === admin.id ? { ...a, status: 'removed' } : a)));
      await supabase.from('customer_activity_logs').insert({
        actor_id: appUser?.id ?? '',
        actor_email: appUser?.email ?? '',
        actor_role: 'company',
        action: 'admin_deleted',
        details: { email: admin.work_email, name: admin.admin_name, soft_delete: true },
      });
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Company Overview</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Manage your admins and view company activity.</p>
      </div>

      {companyId && (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/10">
            <Building2 className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--text)]">Company ID</p>
            <p className="font-mono text-sm text-[var(--text-muted)]">{companyId}</p>
          </div>
          <p className="ml-auto text-xs text-[var(--text-subtle)]">Share this ID with your admins and employees for sign-up</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/10">
              <Users className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text)]">{activeAdmins.length}<span className="text-base font-normal text-[var(--text-muted)]"> / {adminCap}</span></p>
              <p className="text-xs text-[var(--text-muted)]">Approved Admins</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-500/10">
              <UserCheck className="h-5 w-5 text-warning-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text)]">{pendingAdmins.length}</p>
              <p className="text-xs text-[var(--text-muted)]">Pending registrations</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/10">
              <ScrollText className="h-5 w-5 text-accent-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text)]">{logs.length}</p>
              <p className="text-xs text-[var(--text-muted)]">Recent activities</p>
            </div>
          </div>
        </div>
      </div>

      {capReached && (
        <div className="rounded-lg border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm text-warning-500">
          Admin cap reached ({activeAdmins.length}/{adminCap}). Contact your provider to increase the limit.
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h3 className="text-base font-semibold text-[var(--text)]">Excel Upload</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Upload a CSV with columns: admin_name, work_email, employee_id. Uploaded admins are pre-approved and can sign up immediately.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <label className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${capReached ? 'cursor-not-allowed bg-neutral-300 text-neutral-500' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
            <Upload className="h-4 w-4" />
            {uploading ? 'Uploading...' : 'Upload CSV'}
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx" onChange={handleUpload} disabled={uploading || capReached} className="hidden" />
          </label>
          <button onClick={downloadTemplate} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]">
            <Download className="h-4 w-4" /> Download template
          </button>
        </div>
        {uploadMsg && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${uploadMsg.type === 'success' ? 'bg-accent-500/10 text-accent-600' : 'bg-error-500/10 text-error-500'}`}>
            {uploadMsg.text}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--text)]">Admins</h2>
        {!capReached && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
            <Plus className="h-4 w-4" /> Add admin
          </button>
        )}
      </div>

      {admins.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <Users className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No admins yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Add your first admin to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="divide-y divide-[var(--border)]">
            {admins.map((admin) => (
              <div key={admin.id} className="flex items-center justify-between px-4 py-3.5 hover:bg-[var(--surface-hover)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-500/10 text-sm font-semibold text-primary-600">
                    {admin.admin_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">{admin.admin_name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{admin.work_email}{admin.employee_id ? ` · ${admin.employee_id}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {admin.status === 'pending' && (
                    <span className="rounded-full bg-warning-500/10 px-2.5 py-0.5 text-xs font-medium text-warning-500">Pending</span>
                  )}
                  {admin.status === 'approved' && (
                    <span className="rounded-full bg-accent-500/10 px-2.5 py-0.5 text-xs font-medium text-accent-600">Approved</span>
                  )}
                  {admin.status === 'removed' && (
                    <span className="rounded-full bg-neutral-500/10 px-2.5 py-0.5 text-xs font-medium text-neutral-500">Removed</span>
                  )}
                  {admin.status === 'pending' && (
                    <button onClick={() => handleApprove(admin)} className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-500/10" title="Approve">
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  {admin.status !== 'removed' && (
                    <button onClick={() => setDeleteTarget(admin)} className="rounded-lg p-1.5 text-error-500 hover:bg-error-500/10" title="Delete admin">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold text-[var(--text)]">Recent Activity</h2>
        {logs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">No activity recorded yet.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="divide-y divide-[var(--border)]">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-hover)]">
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">{log.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-[var(--text-muted)]">{log.actor_email} ({log.actor_role})</p>
                  </div>
                  <span className="text-xs text-[var(--text-subtle)]">{formatDateTime(log.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCreate(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text)]">Add Admin</h3>
              <button onClick={() => setShowCreate(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Admin name</label>
                <input type="text" value={adminName} onChange={(e) => setAdminName(e.target.value)} disabled={creating}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Employee ID</label>
                <input type="text" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={creating}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Work email <span className="text-error-500">*</span></label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus disabled={creating}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} disabled={creating} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={creating || !email.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                  {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : 'Create admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error-500/10">
                <AlertCircle className="h-5 w-5 text-error-500" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)]">Delete admin account?</h3>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              You are about to delete <span className="font-medium text-[var(--text)]">{deleteTarget.admin_name}</span> ({deleteTarget.work_email}).
              Their account will be deactivated and they will no longer be able to sign in.
            </p>
            <div className="mt-3 rounded-lg bg-primary-500/5 p-3 text-xs text-[var(--text-muted)]">
              All activity history for this admin will be preserved in the Activity Log. Only their login access is removed.
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => handleRemove(deleteTarget)} disabled={deleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-error-500 py-2.5 text-sm font-semibold text-white hover:bg-error-600 disabled:opacity-50">
                {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting...</> : <>Delete admin</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
