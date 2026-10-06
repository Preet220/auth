import { useEffect, useState, useCallback, useRef } from 'react';
import { Users, Upload, Download, Trash2, X, Loader as Loader2, FileSpreadsheet, Search, Check, Building2, UserCheck, Plus, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/qr';

interface Employee {
  id: string;
  user_id: string | null;
  work_email: string;
  employee_name: string;
  employee_id: string;
  status: string;
  first_sign_in_completed: boolean;
  created_at: string;
  company_id: string | null;
}

export function EmployeesPage() {
  const { appUser } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [licenseCache, setLicenseCache] = useState<{ employee_cap: number } | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Individual add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addEmployeeId, setAddEmployeeId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);

  const fetchEmployees = useCallback(async () => {
    const { data: companyData } = await supabase
      .from('companies')
      .select('id, employee_cap')
      .eq('user_id', appUser?.id ?? '')
      .maybeSingle();

    let cId = companyData?.id ?? null;
    if (!cId && appUser?.companyId) {
      cId = appUser.companyId;
    }
    setCompanyId(cId);

    const empQuery = supabase.from('employees').select('*').order('created_at', { ascending: false });
    if (cId) empQuery.eq('company_id', cId);
    const { data: empData } = await empQuery;

    setEmployees(empData ?? []);
    setLicenseCache(companyData ?? null);
    setLoading(false);
  }, [appUser?.id, appUser?.companyId]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const removedEmployees = employees.filter((e) => e.status === 'removed');
  const activeEmployees = employees.filter((e) => e.status === 'active');
  const pendingEmployees = employees.filter((e) => e.status === 'pending');
  const employeeCap = licenseCache?.employee_cap ?? 50;
  const capReached = activeEmployees.length >= employeeCap;

  const filtered = employees.filter((e) => {
    if (!showRemoved && e.status === 'removed') return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return e.employee_name.toLowerCase().includes(q) || e.work_email.toLowerCase().includes(q) || e.employee_id.toLowerCase().includes(q);
  });

  const parseCsv = (text: string): { name: string; work_email: string; employee_id: string }[] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const results: { name: string; work_email: string; employee_id: string }[] = [];
    const skipHeaders = new Set(['name', 'work_email', 'employee_id', 'email']);
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
        setUploadMsg({ type: 'error', text: 'No valid rows found. Ensure your file has columns: employee_name, work_email, employee_id' });
        setUploading(false);
        return;
      }

      const existingEmails = new Set(employees.map((emp) => emp.work_email.toLowerCase()));
      const newRows = parsed.filter((p) => !existingEmails.has(p.work_email.toLowerCase()));
      const skipped = parsed.length - newRows.length;

      if (newRows.length === 0) {
        setUploadMsg({ type: 'error', text: 'All employees in the file already exist.' });
        setUploading(false);
        return;
      }

      const availableSlots = employeeCap - activeEmployees.length;
      if (newRows.length > availableSlots) {
        setUploadMsg({
          type: 'error',
          text: `Employee cap reached. You can add ${availableSlots} more employee(s), but the file contains ${newRows.length} new ones. ${newRows.length - availableSlots} employee(s) could not be added.`,
        });
      }

      const toInsert = newRows.slice(0, availableSlots);
      const { error } = await supabase.from('employees').insert(
        toInsert.map((r) => ({
          employee_name: r.name,
          work_email: r.work_email,
          employee_id: r.employee_id,
          status: 'active',
          first_sign_in_completed: false,
          company_id: companyId,
        }))
      );

      if (error) {
        setUploadMsg({ type: 'error', text: error.message });
      } else {
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: 'admin',
          action: 'employee_excel_upload',
          details: { added: toInsert.length, skipped },
        });
        setUploadMsg({
          type: 'success',
          text: `Added ${toInsert.length} employee(s)${skipped > 0 ? `, ${skipped} already existed` : ''}${toInsert.length < newRows.length ? `, ${newRows.length - toInsert.length} skipped due to cap` : ''}. All are pre-approved and active.`,
        });
        fetchEmployees();
      }
    } catch {
      setUploadMsg({ type: 'error', text: 'Failed to read the file. Please use a valid CSV.' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddIndividual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim() || !addEmail.trim() || !addEmployeeId.trim()) return;
    if (capReached) return;
    setAdding(true);
    setAddMsg(null);

    const existingEmails = new Set(employees.map((emp) => emp.work_email.toLowerCase()));
    if (existingEmails.has(addEmail.trim().toLowerCase())) {
      setAddMsg({ type: 'error', text: 'An employee with this email already exists.' });
      setAdding(false);
      return;
    }

    const { data, error } = await supabase.from('employees').insert({
      employee_name: addName.trim(),
      work_email: addEmail.trim(),
      employee_id: addEmployeeId.trim(),
      status: 'active',
      first_sign_in_completed: false,
      company_id: companyId,
    }).select().single();

    if (error) {
      setAddMsg({ type: 'error', text: error.message });
      setAdding(false);
      return;
    }

    if (data) {
      setEmployees((prev) => [data as Employee, ...prev]);
      await supabase.from('customer_activity_logs').insert({
        actor_id: appUser?.id ?? '',
        actor_email: appUser?.email ?? '',
        actor_role: 'admin',
        action: 'employee_added_individual',
        details: { email: addEmail.trim(), name: addName.trim() },
      });
      setAddMsg({ type: 'success', text: `Employee "${addName.trim()}" added successfully.` });
      setAddName('');
      setAddEmail('');
      setAddEmployeeId('');
      fetchEmployees();
    }
    setAdding(false);
  };

  const downloadTemplate = () => {
    const csv = 'employee_name,work_email,employee_id\nJohn Doe,john@company.com,EMP001\nJane Smith,jane@company.com,EMP002\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'employee-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleApprove = async (emp: Employee) => {
    await supabase.from('employees').update({ status: 'active' }).eq('id', emp.id);
    setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, status: 'active' } : e)));
    await supabase.from('customer_activity_logs').insert({
      actor_id: appUser?.id ?? '',
      actor_email: appUser?.email ?? '',
      actor_role: 'admin',
      action: 'employee_approved',
      details: { email: emp.work_email },
    });
  };

  const handleRemove = async (emp: Employee) => {
    setDeleting(true);
    await supabase.from('employees').update({ status: 'removed' }).eq('id', emp.id);
    setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, status: 'removed' } : e)));
    await supabase.from('customer_activity_logs').insert({
      actor_id: appUser?.id ?? '',
      actor_email: appUser?.email ?? '',
      actor_role: appUser?.role ?? 'admin',
      action: 'employee_deleted',
      details: { email: emp.work_email, name: emp.employee_name, soft_delete: true },
    });
    setDeleting(false);
    setDeleteTarget(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-muted)]"><Loader2 className="h-5 w-5 animate-spin" /> Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Employees</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Onboard employees via Excel upload or individually, and manage their access.</p>
        </div>
        {!capReached && (
          <button onClick={() => { setShowAddModal(true); setAddMsg(null); }} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700">
            <Plus className="h-4 w-4" /> Add employee
          </button>
        )}
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
          <p className="ml-auto text-xs text-[var(--text-subtle)]">Share this ID with employees for sign-up</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/10">
              <Users className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text)]">{activeEmployees.length}<span className="text-base font-normal text-[var(--text-muted)]"> / {employeeCap}</span></p>
              <p className="text-xs text-[var(--text-muted)]">Active employees</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-500/10">
              <UserCheck className="h-5 w-5 text-warning-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text)]">{pendingEmployees.length}</p>
              <p className="text-xs text-[var(--text-muted)]">Pending approval</p>
            </div>
          </div>
        </div>
      </div>

      {capReached && (
        <div className="rounded-lg border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm text-warning-500">
          Employee cap reached ({activeEmployees.length}/{employeeCap}). Contact your provider to increase the limit.
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h3 className="text-base font-semibold text-[var(--text)]">Excel Upload</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Upload a CSV with columns: employee_name, work_email, employee_id. Uploaded employees are pre-approved and active immediately.</p>
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

      {employees.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20" />
          </div>
          {removedEmployees.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-muted)]">
              <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} className="h-4 w-4 rounded border-[var(--border)]" />
              Show removed ({removedEmployees.length})
            </label>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <FileSpreadsheet className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">{search ? 'No employees found' : 'No employees yet'}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{search ? 'Try a different search.' : 'Add an employee individually or upload an Excel sheet to onboard employees.'}</p>
          {!search && !capReached && (
            <button onClick={() => { setShowAddModal(true); setAddMsg(null); }} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
              <Plus className="h-4 w-4" /> Add employee
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-hover)]">
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Employee ID</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">Added</th>
                  <th className="px-4 py-3 text-right font-medium text-[var(--text-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((emp) => (
                  <tr key={emp.id} className="hover:bg-[var(--surface-hover)]">
                    <td className="px-4 py-3 font-medium text-[var(--text)]">{emp.employee_name}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{emp.work_email}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{emp.employee_id}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${emp.status === 'active' ? 'bg-accent-500/10 text-accent-600' : emp.status === 'pending' ? 'bg-warning-500/10 text-warning-500' : emp.status === 'removed' ? 'bg-neutral-500/10 text-neutral-500' : 'bg-neutral-500/10 text-neutral-500'}`}>{emp.status}</span>
                      {!emp.first_sign_in_completed && emp.status === 'active' && (
                        <span className="ml-1 rounded-full bg-warning-500/10 px-2 py-0.5 text-xs text-warning-500">Not signed in</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-subtle)]">{formatDate(emp.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {emp.status === 'pending' && (
                          <button onClick={() => handleApprove(emp)} className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-500/10" title="Approve">
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        {emp.status !== 'removed' && (
                          <button onClick={() => setDeleteTarget(emp)} className="rounded-lg p-1.5 text-error-500 hover:bg-error-500/10" title="Delete employee">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add individual employee modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !adding && setShowAddModal(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text)]">Add Employee</h3>
              <button onClick={() => !adding && setShowAddModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]" disabled={adding}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddIndividual} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Employee name <span className="text-error-500">*</span></label>
                <input type="text" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. John Doe" required autoFocus disabled={adding}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Work email <span className="text-error-500">*</span></label>
                <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="you@company.com" required disabled={adding}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Employee ID <span className="text-error-500">*</span></label>
                <input type="text" value={addEmployeeId} onChange={(e) => setAddEmployeeId(e.target.value)} placeholder="e.g. EMP001" required disabled={adding}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
              {addMsg && (
                <div className={`rounded-lg px-3 py-2 text-sm ${addMsg.type === 'success' ? 'bg-accent-500/10 text-accent-600' : 'bg-error-500/10 text-error-500'}`}>
                  {addMsg.text}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} disabled={adding} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={adding || !addName.trim() || !addEmail.trim() || !addEmployeeId.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                  {adding ? <><Loader2 className="h-4 w-4 animate-spin" /> Adding...</> : <>Add employee</>}
                </button>
              </div>
            </form>
            <p className="mt-4 text-center text-xs text-[var(--text-subtle)]">The employee will be pre-approved and can sign up immediately.</p>
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
              <h3 className="text-lg font-semibold text-[var(--text)]">Delete employee account?</h3>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              You are about to delete <span className="font-medium text-[var(--text)]">{deleteTarget.employee_name}</span> ({deleteTarget.work_email}).
              Their account will be deactivated and they will no longer be able to sign in.
            </p>
            <div className="mt-3 rounded-lg bg-primary-500/5 p-3 text-xs text-[var(--text-muted)]">
              All activity history for this employee will be preserved in the Activity Log. Only their login access is removed.
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => handleRemove(deleteTarget)} disabled={deleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-error-500 py-2.5 text-sm font-semibold text-white hover:bg-error-600 disabled:opacity-50">
                {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting...</> : <>Delete employee</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
