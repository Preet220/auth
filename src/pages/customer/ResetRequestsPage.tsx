import { useEffect, useState, useCallback } from 'react';
import { Users, Check, X, Loader2, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/qr';

interface ResetRequest {
  id: string;
  employee_id: string;
  employee_email: string;
  status: string;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export function ResetRequestsPage() {
  const { appUser } = useAuth();
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    const { data } = await supabase
      .from('password_reset_requests')
      .select('*')
      .order('requested_at', { ascending: false });
    setRequests(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleResolve = async (req: ResetRequest, status: 'approved' | 'denied') => {
    setUpdating(req.id);
    await supabase
      .from('password_reset_requests')
      .update({ status, resolved_at: new Date().toISOString(), resolved_by: appUser?.email ?? '' })
      .eq('id', req.id);
    setRequests((prev) => prev.map((r) => (r.id === req.id ? { ...r, status, resolved_at: new Date().toISOString(), resolved_by: appUser?.email ?? '' } : r)));
    await supabase.from('customer_activity_logs').insert({
      actor_id: appUser?.id ?? '',
      actor_email: appUser?.email ?? '',
      actor_role: 'admin',
      action: `password_reset_${status}`,
      details: { employee_email: req.employee_email },
    });
    setUpdating(null);
  };

  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');

  if (loading) {
    return <div className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-muted)]"><Loader2 className="h-5 w-5 animate-spin" /> Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Reset Requests</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Approve or deny employee password reset requests.</p>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <Users className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No reset requests</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Employee password reset requests will appear here.</p>
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-[var(--text)]">Pending ({pending.length})</h2>
              <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="divide-y divide-[var(--border)]">
                  {pending.map((req) => (
                    <div key={req.id} className="flex items-center justify-between px-4 py-3.5">
                      <div>
                        <p className="text-sm font-medium text-[var(--text)]">{req.employee_email}</p>
                        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Clock className="h-3 w-3" /> Requested {formatDateTime(req.requested_at)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleResolve(req, 'approved')} disabled={updating === req.id}
                          className="flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50">
                          <Check className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button onClick={() => handleResolve(req, 'denied')} disabled={updating === req.id}
                          className="flex items-center gap-1.5 rounded-lg border border-error-500/30 px-3 py-1.5 text-xs font-semibold text-error-500 hover:bg-error-500/10 disabled:opacity-50">
                          <X className="h-3.5 w-3.5" /> Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {resolved.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-[var(--text)]">Resolved</h2>
              <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="divide-y divide-[var(--border)]">
                  {resolved.map((req) => (
                    <div key={req.id} className="flex items-center justify-between px-4 py-3.5">
                      <div>
                        <p className="text-sm font-medium text-[var(--text)]">{req.employee_email}</p>
                        <p className="text-xs text-[var(--text-muted)]">Resolved {req.resolved_at ? formatDateTime(req.resolved_at) : ''} by {req.resolved_by}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${req.status === 'approved' ? 'bg-accent-500/10 text-accent-600' : 'bg-neutral-500/10 text-neutral-500'}`}>{req.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
