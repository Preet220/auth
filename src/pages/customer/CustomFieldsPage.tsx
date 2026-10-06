import { useEffect, useState, useCallback } from 'react';
import {
  FileText,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/qr';
import { useAuth } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type InputType = 'short_text' | 'number' | 'multiple_choice' | 'date' | 'photo' | 'signature' | 'boolean';
type ScanType = 'checkpoint' | 'item' | 'trolley' | 'seal' | 'none' | string;

interface CustomField {
  id: string;
  label: string;
  input_type: InputType;
  options: string[] | null;
  scan_type: ScanType;
  required: boolean;
  created_at: string;
}

const INPUT_TYPES: { value: InputType; label: string }[] = [
  { value: 'short_text', label: 'Short text' },
  { value: 'number', label: 'Number' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'date', label: 'Date' },
  { value: 'photo', label: 'Photo' },
  { value: 'signature', label: 'Signature' },
  { value: 'boolean', label: 'Boolean (yes/no)' },
];

const PREDEFINED_SCAN_TYPES: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'checkpoint', label: 'Checkpoint' },
  { value: 'item', label: 'Item' },
  { value: 'trolley', label: 'Trolley' },
  { value: 'seal', label: 'Seal' },
];

const INPUT_TYPE_LABELS: Record<InputType, string> = {
  short_text: 'Short text',
  number: 'Number',
  multiple_choice: 'Multiple choice',
  date: 'Date',
  photo: 'Photo',
  signature: 'Signature',
  boolean: 'Boolean',
};

interface CustomQrTypeLite {
  id: string;
  type_key: string;
  label: string;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CustomFieldsPage() {
  const { appUser } = useAuth();
  const [fields, setFields] = useState<CustomField[]>([]);
  const [customQrTypes, setCustomQrTypes] = useState<CustomQrTypeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomField | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Form state
  const [label, setLabel] = useState('');
  const [inputType, setInputType] = useState<InputType>('short_text');
  const [options, setOptions] = useState('');
  const [scanType, setScanType] = useState<ScanType>('checkpoint');
  const [required, setRequired] = useState(false);

  /* -------------------- Data fetching -------------------- */

  const fetchFields = useCallback(async () => {
    const { data } = await supabase
      .from('custom_fields')
      .select('*')
      .order('created_at', { ascending: false });
    setFields(data ?? []);
    setLoading(false);
  }, []);

  const fetchCustomQrTypes = useCallback(async () => {
    const { data } = await supabase
      .from('custom_qr_types')
      .select('id, type_key, label')
      .order('created_at', { ascending: true });
    setCustomQrTypes(data ?? []);
  }, []);

  useEffect(() => {
    fetchFields();
    fetchCustomQrTypes();
  }, [fetchFields, fetchCustomQrTypes]);

  /* -------------------- Form helpers -------------------- */

  const resetForm = () => {
    setLabel('');
    setInputType('short_text');
    setOptions('');
    setScanType('checkpoint');
    setRequired(false);
    setErrorMsg('');
  };

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setShowForm(true);
  };

  const openEdit = (field: CustomField) => {
    setEditing(field);
    setLabel(field.label);
    setInputType(field.input_type);
    setOptions(field.options?.join(', ') ?? '');
    setScanType(field.scan_type);
    setRequired(field.required);
    setErrorMsg('');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    setErrorMsg('');

    const payload: {
      label: string;
      input_type: InputType;
      options: string[];
      scan_type: ScanType;
      required: boolean;
    } = {
      label: label.trim(),
      input_type: inputType,
      options: inputType === 'multiple_choice'
        ? options
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : [],
      scan_type: scanType,
      required,
    };

    if (editing) {
      const { data, error } = await supabase
        .from('custom_fields')
        .update(payload)
        .eq('id', editing.id)
        .select()
        .single();

      if (error) {
        setErrorMsg(error.message);
        setSaving(false);
        return;
      }
      if (data) {
        setFields((prev) => prev.map((f) => (f.id === editing.id ? (data as CustomField) : f)));
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: appUser?.role ?? 'admin',
          action: 'custom_field_updated',
          details: { id: editing.id, label: label.trim() },
        });
      }
    } else {
      const { data, error } = await supabase
        .from('custom_fields')
        .insert(payload)
        .select()
        .single();

      if (error) {
        setErrorMsg(error.message);
        setSaving(false);
        return;
      }
      if (data) {
        setFields((prev) => [data as CustomField, ...prev]);
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: appUser?.role ?? 'admin',
          action: 'custom_field_created',
          details: { id: (data as CustomField).id, label: label.trim(), scan_type: scanType },
        });
      }
    }

    setShowForm(false);
    resetForm();
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await supabase.from('custom_fields').delete().eq('id', deleteTarget.id);
    setFields((prev) => prev.filter((f) => f.id !== deleteTarget.id));
    await supabase.from('customer_activity_logs').insert({
      actor_id: appUser?.id ?? '',
      actor_email: appUser?.email ?? '',
      actor_role: appUser?.role ?? 'admin',
      action: 'custom_field_deleted',
      details: { id: deleteTarget.id, label: deleteTarget.label },
    });
    setDeleteTarget(null);
  };

  /* -------------------- Render -------------------- */

  const inputClass =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Custom Fields</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Define additional data fields captured during scans of checkpoints, items, trolleys, and seals.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          New field
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--text-subtle)]" />
          <p className="mt-2">Loading custom fields...</p>
        </div>
      ) : fields.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No custom fields yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Create custom fields to capture additional information during scans.
          </p>
          <button
            onClick={openCreate}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Create field
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-hover)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-4 py-3 font-medium">Label</th>
                  <th className="px-4 py-3 font-medium">Input type</th>
                  <th className="px-4 py-3 font-medium">Scan type</th>
                  <th className="px-4 py-3 font-medium">Required</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {fields.map((field) => (
                  <tr key={field.id} className="transition-colors hover:bg-[var(--surface-hover)]">
                    <td className="px-4 py-3">
                      <span className="font-medium text-[var(--text)]">{field.label}</span>
                      {field.options && field.options.length > 0 && (
                        <p className="mt-0.5 text-xs text-[var(--text-subtle)]">
                          Options: {field.options.join(', ')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {INPUT_TYPE_LABELS[field.input_type]}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-xs font-medium capitalize text-primary-700">
                        {customQrTypes.find((t) => t.type_key === field.scan_type)?.label ?? field.scan_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {field.required ? (
                        <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-xs font-medium text-accent-700">
                          Required
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-subtle)]">Optional</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{formatDateTime(field.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(field)}
                          className="flex items-center justify-center rounded-lg border border-[var(--border)] px-2.5 py-2 text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(field)}
                          className="flex items-center justify-center rounded-lg border border-[var(--border)] px-2.5 py-2 text-error-500 transition-colors hover:bg-error-500/10 hover:border-error-500/30"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !saving && setShowForm(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text)]">
                {editing ? 'Edit custom field' : 'New custom field'}
              </h3>
              <button
                onClick={() => !saving && setShowForm(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text)]"
                disabled={saving}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                  Label <span className="text-error-500">*</span>
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Temperature reading"
                  required
                  autoFocus
                  disabled={saving}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Input type</label>
                <select
                  value={inputType}
                  onChange={(e) => setInputType(e.target.value as InputType)}
                  disabled={saving}
                  className={inputClass}
                >
                  {INPUT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {inputType === 'multiple_choice' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                    Options <span className="text-[var(--text-subtle)]">(comma-separated)</span>
                  </label>
                  <input
                    type="text"
                    value={options}
                    onChange={(e) => setOptions(e.target.value)}
                    placeholder="e.g. Pass, Fail, N/A"
                    disabled={saving}
                    className={inputClass}
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Scan type</label>
                <select
                  value={scanType}
                  onChange={(e) => setScanType(e.target.value as ScanType)}
                  disabled={saving}
                  className={inputClass}
                >
                  {PREDEFINED_SCAN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                  {customQrTypes.length > 0 && (
                    <optgroup label="Custom QR Types">
                      {customQrTypes.map((t) => (
                        <option key={t.type_key} value={t.type_key}>
                          {t.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                  disabled={saving}
                  className="h-4 w-4 rounded border-[var(--border)] text-primary-600 focus:ring-2 focus:ring-primary-500/20"
                />
                <span className="text-sm text-[var(--text)]">Required field</span>
              </label>

              {errorMsg && (
                <p className="text-sm text-error-500">{errorMsg}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !label.trim()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    editing ? 'Save changes' : 'Create field'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-500/10">
                <Trash2 className="h-6 w-6 text-error-500" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)]">Delete custom field?</h3>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                "{deleteTarget.label}" will be permanently removed. This cannot be undone.
              </p>
              <div className="mt-6 flex w-full gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 rounded-lg bg-error-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-600"
                >
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
