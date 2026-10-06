import { useEffect, useState, useCallback } from 'react';
import {
  QrCode,
  Plus,
  Search,
  Download,
  Trash2,
  X,
  Loader2,
  MapPin,
  Package,
  Truck,
  ShieldCheck,
  Settings2,
  RefreshCw,
  Printer,
  Layers,
  Pencil,
  Save,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  generateQrDataUrl,
  downloadDataUrl,
  generateCheckpointCode,
  formatDate,
  printQrSheet,
  downloadMultipleQrs,
} from '@/lib/qr';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface QrCodeRecord {
  id: string;
  type: string;
  value: string;
  details: Record<string, unknown> | null;
  origin: string | null;
  created_by_admin: string;
  created_at: string;
}

interface QrCache {
  [value: string]: string;
}

interface CustomFieldDef {
  key: string;
  label: string;
  required: boolean;
}

interface CustomQrType {
  id: string;
  type_key: string;
  label: string;
  fields: CustomFieldDef[];
  created_at: string;
}

const PREDEFINED_TYPES = ['checkpoint', 'item', 'trolley', 'seal'] as const;
type PredefinedType = (typeof PREDEFINED_TYPES)[number];

const TYPE_META: Record<
  PredefinedType,
  { label: string; icon: typeof QrCode; prefix: string }
> = {
  checkpoint: { label: 'Checkpoint', icon: MapPin, prefix: 'CP' },
  item: { label: 'Item', icon: Package, prefix: 'ITEM' },
  trolley: { label: 'Trolley', icon: Truck, prefix: 'TR' },
  seal: { label: 'Seal', icon: ShieldCheck, prefix: 'SEAL' },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(prefix: string): string {
  const segments: string[] = [];
  for (let s = 0; s < 3; s++) {
    let seg = '';
    for (let i = 0; i < 4; i++) {
      seg += CHARSET[Math.floor(Math.random() * CHARSET.length)];
    }
    segments.push(seg);
  }
  return `${prefix}-${segments.join('-')}`;
}

function getTabLabel(type: string): string {
  const predefined = TYPE_META[type as PredefinedType];
  if (predefined) return predefined.label;
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function getTabIcon(type: string): typeof QrCode {
  const predefined = TYPE_META[type as PredefinedType];
  return predefined ? predefined.icon : QrCode;
}

function generateSealSequence(first: string, last: string): string[] {
  const match = /^(.*?)(\d+)$/.exec(first);
  if (!match) return [];
  const prefix = match[1];
  const startNum = parseInt(match[2], 10);
  const startWidth = match[2].length;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lastMatch = new RegExp(`^${escaped}(\\d+)$`).exec(last);
  if (!lastMatch) return [];
  const endNum = parseInt(lastMatch[1], 10);
  if (endNum < startNum) return [];
  const serials: string[] = [];
  for (let i = startNum; i <= endNum; i++) {
    serials.push(`${prefix}${i.toString().padStart(startWidth, '0')}`);
  }
  return serials;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function QrCodesPage() {
  const { appUser } = useAuth();
  const [records, setRecords] = useState<QrCodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('checkpoint');
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [customTypeDefs, setCustomTypeDefs] = useState<Record<string, CustomQrType>>({});
  const [qrCache, setQrCache] = useState<QrCache>({});
  const [deleteTarget, setDeleteTarget] = useState<QrCodeRecord | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  // Form state
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  // Seal batch creation state
  const [sealCreateMode, setSealCreateMode] = useState<'individual' | 'batch'>('individual');
  const [sealBatchFirst, setSealBatchFirst] = useState('');
  const [sealBatchLast, setSealBatchLast] = useState('');
  const [sealBatchResult, setSealBatchResult] = useState<{ added: number; skipped: number } | null>(null);

  // Custom tab creation/edit state
  const [showTabForm, setShowTabForm] = useState(false);
  const [editingTab, setEditingTab] = useState<CustomQrType | null>(null);
  const [tabLabel, setTabLabel] = useState('');
  const [tabFields, setTabFields] = useState<CustomFieldDef[]>([{ key: '', label: '', required: false }]);
  const [savingTab, setSavingTab] = useState(false);
  const [tabError, setTabError] = useState('');
  const [deleteTabTarget, setDeleteTabTarget] = useState<CustomQrType | null>(null);
  const [editPredefinedTab, setEditPredefinedTab] = useState<string | null>(null);
  const [predefinedLabel, setPredefinedLabel] = useState('');

  /* -------------------- Data fetching -------------------- */

  const fetchRecords = useCallback(async () => {
    const { data } = await supabase
      .from('qr_codes')
      .select('*')
      .order('created_at', { ascending: false });
    setRecords(data ?? []);
    setLoading(false);
  }, []);

  const fetchCustomTypes = useCallback(async () => {
    const { data } = await supabase
      .from('custom_qr_types')
      .select('*')
      .order('created_at', { ascending: true });
    if (data) {
      const map: Record<string, CustomQrType> = {};
      (data as CustomQrType[]).forEach((t) => { map[t.type_key] = t; });
      setCustomTypeDefs(map);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchCustomTypes();
  }, [fetchRecords, fetchCustomTypes]);

  useEffect(() => {
    const types = new Set(records.map((r) => r.type));
    const custom = Array.from(types).filter(
      (t) => !PREDEFINED_TYPES.includes(t as PredefinedType)
    );
    Object.keys(customTypeDefs).forEach((key) => {
      if (!custom.includes(key)) custom.push(key);
    });
    setCustomTypes(custom);
  }, [records, customTypeDefs]);

  useEffect(() => {
    records.forEach((r) => {
      if (!qrCache[r.value]) {
        generateQrDataUrl(r.value, 200).then((url) => {
          setQrCache((prev) => ({ ...prev, [r.value]: url }));
        });
      }
    });
  }, [records, qrCache]);

  /* -------------------- Derived -------------------- */

  const allTabs: string[] = [...PREDEFINED_TYPES, ...customTypes];

  const filtered = records.filter((r) => {
    const matchesTab = r.type === activeTab;
    if (!matchesTab) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.value.toLowerCase().includes(q) ||
      (r.details && JSON.stringify(r.details).toLowerCase().includes(q)) ||
      getTabLabel(r.type).toLowerCase().includes(q)
    );
  });

  /* -------------------- Form helpers -------------------- */

  const resetForm = () => {
    setFormFields({});
    setSealBatchFirst('');
    setSealBatchLast('');
    setSealBatchResult(null);
    setSealCreateMode('individual');
    setFormError('');
  };

  const getQrHeading = (type: string, d: Record<string, unknown>): string => {
    if (type === 'checkpoint') return (d.name as string) ?? '';
    if (type === 'item') return (d.item_type as string) ?? '';
    if (type === 'trolley') return (d.trolley_id as string) ?? '';
    if (type === 'seal') return (d.seal_serial as string) ?? '';
    if (d.label) return d.label as string;
    const def = customTypeDefs[type];
    if (def && def.fields && def.fields.length > 0) {
      const val = d[def.fields[0].key] as string | undefined;
      if (val) return val;
    }
    return '';
  };

  const checkDuplicateHeading = (type: string, heading: string): boolean => {
    if (!heading) return false;
    const lower = heading.toLowerCase();
    return records.some((r) => {
      if (r.type !== type) return false;
      const existingHeading = getQrHeading(r.type, r.details ?? {});
      return existingHeading.toLowerCase() === lower;
    });
  };

  const getFormValue = (key: string) => formFields[key] ?? '';

  const setFormValue = (key: string, value: string) =>
    setFormFields((prev) => ({ ...prev, [key]: value }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFormError('');

    const prefix = TYPE_META[activeTab as PredefinedType]?.prefix ?? activeTab.toUpperCase().slice(0, 4);
    const code = activeTab === 'checkpoint' ? generateCheckpointCode() : generateCode(prefix);

    let details: Record<string, unknown> = {};

    if (activeTab === 'checkpoint') {
      if (!getFormValue('name').trim()) { setCreating(false); return; }
      const heading = getFormValue('name').trim();
      if (checkDuplicateHeading('checkpoint', heading)) {
        setFormError(`A checkpoint named "${heading}" already exists. Delete the existing one first or use a different name.`);
        setCreating(false);
        return;
      }
      details = {
        name: heading,
        location: getFormValue('location').trim() || null,
        description: getFormValue('description').trim() || null,
      };
    } else if (activeTab === 'item') {
      if (!getFormValue('item_type').trim()) { setCreating(false); return; }
      const heading = getFormValue('item_type').trim();
      if (checkDuplicateHeading('item', heading)) {
        setFormError(`An item named "${heading}" already exists. Delete the existing one first or use a different name.`);
        setCreating(false);
        return;
      }
      details = { item_type: heading };
    } else if (activeTab === 'trolley') {
      if (!getFormValue('trolley_id').trim()) { setCreating(false); return; }
      const heading = getFormValue('trolley_id').trim();
      if (checkDuplicateHeading('trolley', heading)) {
        setFormError(`A trolley named "${heading}" already exists. Delete the existing one first or use a different name.`);
        setCreating(false);
        return;
      }
      details = {
        trolley_id: heading,
        checkpoint_name: getFormValue('checkpoint_name').trim() || null,
      };
    } else if (activeTab === 'seal') {
      if (sealCreateMode === 'batch') { setCreating(false); return; }
      if (!getFormValue('seal_serial').trim()) { setCreating(false); return; }
      const heading = getFormValue('seal_serial').trim();
      if (checkDuplicateHeading('seal', heading)) {
        setFormError(`A seal with serial "${heading}" already exists. Delete the existing one first or use a different serial.`);
        setCreating(false);
        return;
      }
      details = { seal_serial: heading };
    } else {
      details = { ...formFields };
      const def = customTypeDefs[activeTab];
      if (def && def.fields && def.fields.length > 0) {
        const heading = (details[def.fields[0].key] as string) ?? '';
        if (heading && checkDuplicateHeading(activeTab, heading)) {
          setFormError(`A ${def.label} with "${heading}" already exists. Delete the existing one first or use a different value.`);
          setCreating(false);
          return;
        }
      }
    }

    const { data, error } = await supabase
      .from('qr_codes')
      .insert({ type: activeTab, value: code, details, origin: 'app_generated', created_by_admin: '' })
      .select()
      .single();

    if (!error && data) {
      setRecords((prev) => [data as QrCodeRecord, ...prev]);
      await supabase.from('customer_activity_logs').insert({
        actor_id: appUser?.id ?? '',
        actor_email: appUser?.email ?? '',
        actor_role: appUser?.role ?? 'admin',
        action: 'qr_code_generated',
        details: { type: activeTab, value: code },
      });
    }
    setShowCreate(false);
    resetForm();
    setCreating(false);
  };

  const handleBatchSealCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const first = sealBatchFirst.trim();
    const last = sealBatchLast.trim();
    if (!first || !last) return;
    setCreating(true);
    setSealBatchResult(null);

    const serials = generateSealSequence(first, last);
    if (serials.length === 0 || serials.length > 5000) {
      setSealBatchResult({ added: 0, skipped: 0 });
      setCreating(false);
      return;
    }

    const existingValues = new Set(
      records.filter((r) => r.type === 'seal').map((r) => r.details?.seal_serial as string).filter(Boolean)
    );
    const newSerials = serials.filter((s) => !existingValues.has(s));

    const rows = newSerials.map((serial) => ({
      type: 'seal',
      value: generateCode(TYPE_META.seal.prefix),
      details: { seal_serial: serial },
      origin: 'app_generated',
      created_by_admin: '',
    }));

    let added = 0;
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { data, error } = await supabase.from('qr_codes').insert(chunk).select();
      if (!error && data) {
        added += data.length;
        setRecords((prev) => [...(data as QrCodeRecord[]), ...prev]);
      }
    }

    setSealBatchResult({ added, skipped: serials.length - newSerials.length });

    if (added > 0) {
      await supabase.from('customer_activity_logs').insert({
        actor_id: appUser?.id ?? '',
        actor_email: appUser?.email ?? '',
        actor_role: appUser?.role ?? 'admin',
        action: 'qr_codes_batch_seal',
        details: { added, skipped: serials.length - newSerials.length, first, last },
      });
    }

    setSealBatchFirst('');
    setSealBatchLast('');
    setCreating(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await supabase.from('qr_codes').delete().eq('id', deleteTarget.id);
    setRecords((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    await supabase.from('customer_activity_logs').insert({
      actor_id: appUser?.id ?? '',
      actor_email: appUser?.email ?? '',
      actor_role: appUser?.role ?? 'admin',
      action: 'qr_code_deleted',
      details: { type: deleteTarget.type, value: deleteTarget.value },
    });
    setDeleteTarget(null);
  };

  /* -------------------- Custom tab creation -------------------- */

  const openTabForm = () => {
    setEditingTab(null);
    setTabLabel('');
    setTabFields([{ key: '', label: '', required: false }]);
    setTabError('');
    setShowTabForm(true);
  };

  const openEditTabForm = (typeKey: string) => {
    const def = customTypeDefs[typeKey];
    if (!def) return;
    setEditingTab(def);
    setTabLabel(def.label);
    setTabFields(def.fields.map((f) => ({ key: f.key, label: f.label, required: f.required })));
    setTabError('');
    setShowTabForm(true);
  };

  const openEditPredefinedTab = (typeKey: string) => {
    setEditPredefinedTab(typeKey);
    setPredefinedLabel(TYPE_META[typeKey as PredefinedType]?.label ?? typeKey);
  };

  const handleSavePredefinedLabel = async () => {
    if (!editPredefinedTab || !predefinedLabel.trim()) return;
    const typeKey = editPredefinedTab;
    const existing = customTypeDefs[typeKey];
    if (existing) {
      const { data, error } = await supabase
        .from('custom_qr_types')
        .update({ label: predefinedLabel.trim() })
        .eq('id', existing.id)
        .select()
        .single();
      if (!error && data) {
        setCustomTypeDefs((prev) => ({ ...prev, [typeKey]: data as CustomQrType }));
      }
    } else {
      const { data, error } = await supabase
        .from('custom_qr_types')
        .insert({ type_key: typeKey, label: predefinedLabel.trim(), fields: [] })
        .select()
        .single();
      if (!error && data) {
        setCustomTypeDefs((prev) => ({ ...prev, [typeKey]: data as CustomQrType }));
      }
    }
    setEditPredefinedTab(null);
    setPredefinedLabel('');
  };

  const handleDeleteTab = async () => {
    if (!deleteTabTarget) return;
    await supabase.from('qr_codes').delete().eq('type', deleteTabTarget.type_key);
    await supabase.from('custom_qr_types').delete().eq('id', deleteTabTarget.id);
    setRecords((prev) => prev.filter((r) => r.type !== deleteTabTarget.type_key));
    setCustomTypeDefs((prev) => {
      const next = { ...prev };
      delete next[deleteTabTarget.type_key];
      return next;
    });
    if (activeTab === deleteTabTarget.type_key) setActiveTab('checkpoint');
    await supabase.from('customer_activity_logs').insert({
      actor_id: appUser?.id ?? '',
      actor_email: appUser?.email ?? '',
      actor_role: appUser?.role ?? 'admin',
      action: 'custom_qr_tab_deleted',
      details: { type_key: deleteTabTarget.type_key, label: deleteTabTarget.label },
    });
    setDeleteTabTarget(null);
  };

  const addTabField = () => setTabFields((prev) => [...prev, { key: '', label: '', required: false }]);

  const updateTabField = (index: number, field: 'key' | 'label' | 'required', value: string | boolean) =>
    setTabFields((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)));

  const removeTabField = (index: number) =>
    setTabFields((prev) => prev.filter((_, i) => i !== index));

  const handleSaveTab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tabLabel.trim()) { setTabError('Tab name is required.'); return; }

    const validFields = tabFields
      .filter((f) => f.label.trim())
      .map((f) => ({
        key: f.label.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
        label: f.label.trim(),
        required: f.required,
      }))
      .filter((f) => f.key.length > 0);

    if (validFields.length === 0) { setTabError('Add at least one field for this QR type.'); return; }

    setSavingTab(true);
    setTabError('');

    if (editingTab) {
      const { data, error } = await supabase
        .from('custom_qr_types')
        .update({ label: tabLabel.trim(), fields: validFields })
        .eq('id', editingTab.id)
        .select()
        .single();
      if (error) { setTabError(error.message); setSavingTab(false); return; }
      if (data) {
        const updated = data as CustomQrType;
        setCustomTypeDefs((prev) => ({ ...prev, [updated.type_key]: updated }));
        setShowTabForm(false);
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '', actor_email: appUser?.email ?? '', actor_role: appUser?.role ?? 'admin',
          action: 'custom_qr_tab_updated', details: { type_key: updated.type_key, label: updated.label, field_count: validFields.length },
        });
      }
    } else {
      const typeKey = tabLabel.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      if (!typeKey) { setTabError('Tab name must contain at least one letter or number.'); setSavingTab(false); return; }
      if (PREDEFINED_TYPES.includes(typeKey as PredefinedType)) { setTabError('This name conflicts with a predefined type. Please choose another.'); setSavingTab(false); return; }
      if (customTypeDefs[typeKey]) { setTabError('A custom tab with this name already exists.'); setSavingTab(false); return; }

      const { data, error } = await supabase
        .from('custom_qr_types')
        .insert({ type_key: typeKey, label: tabLabel.trim(), fields: validFields })
        .select()
        .single();
      if (error) { setTabError(error.message); setSavingTab(false); return; }
      if (data) {
        const newType = data as CustomQrType;
        setCustomTypeDefs((prev) => ({ ...prev, [newType.type_key]: newType }));
        setActiveTab(newType.type_key);
        setShowTabForm(false);
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '', actor_email: appUser?.email ?? '', actor_role: appUser?.role ?? 'admin',
          action: 'custom_qr_tab_created', details: { type_key: newType.type_key, label: newType.label, field_count: validFields.length },
        });
      }
    }
    setSavingTab(false);
  };

  const handleDownload = async (rec: QrCodeRecord) => {
    setDownloadingId(rec.id);
    const url = await generateQrDataUrl(rec.value, 600);
    downloadDataUrl(url, `qr-${rec.value}.png`);
    setDownloadingId(null);
  };

  const handleRegenerate = async (rec: QrCodeRecord) => {
    setRegeneratingId(rec.id);
    const prefix = TYPE_META[rec.type as PredefinedType]?.prefix ?? rec.type.toUpperCase().slice(0, 4);
    const newValue = rec.type === 'checkpoint' ? generateCheckpointCode() : generateCode(prefix);

    const { data, error } = await supabase
      .from('qr_codes')
      .update({ value: newValue })
      .eq('id', rec.id)
      .select()
      .single();

    if (!error && data) {
      const updated = data as QrCodeRecord;
      setRecords((prev) => prev.map((r) => (r.id === rec.id ? updated : r)));
      const newUrl = await generateQrDataUrl(newValue, 200);
      setQrCache((prev) => ({ ...prev, [newValue]: newUrl }));
      await supabase.from('customer_activity_logs').insert({
        actor_id: appUser?.id ?? '', actor_email: appUser?.email ?? '', actor_role: appUser?.role ?? 'admin',
        action: 'qr_code_regenerated', details: { type: rec.type, old_value: rec.value, new_value: newValue },
      });

      // Update all process definitions whose workflow references the old QR value
      try {
        const { data: procDefs } = await supabase
          .from('process_definitions')
          .select('id, name, workflow');

        if (procDefs) {
          for (const def of procDefs) {
            const wf = def.workflow as { nodes?: Array<Record<string, unknown>>; edges?: unknown[] } | null;
            if (!wf || !wf.nodes) continue;

            let modified = false;
            const updatedNodes = wf.nodes.map((node) => {
              if (node.qr_value === rec.value) {
                modified = true;
                return { ...node, qr_value: newValue };
              }
              return node;
            });

            if (modified) {
              const updatedWorkflow = { ...wf, nodes: updatedNodes };
              await supabase
                .from('process_definitions')
                .update({ workflow: updatedWorkflow })
                .eq('id', def.id);
            }
          }
        }
      } catch {
        // Non-critical — the QR value was still updated in qr_codes
      }
    }
    setRegeneratingId(null);
  };

  const handleBatchDownload = async () => {
    if (filtered.length === 0) return;
    setBatchProgress({ current: 0, total: filtered.length });
    const entries: { dataUrl: string; filename: string }[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const rec = filtered[i];
      const url = await generateQrDataUrl(rec.value, 600);
      entries.push({ dataUrl: url, filename: `qr-${rec.type}-${rec.value}.png` });
      setBatchProgress({ current: i + 1, total: filtered.length });
    }
    await downloadMultipleQrs(entries, (current, total) => setBatchProgress({ current, total }));
    setBatchProgress(null);
  };

  const handlePrintSheet = async () => {
    if (filtered.length === 0) return;
    const entries: { dataUrl: string; label: string; value: string }[] = [];
    for (const rec of filtered) {
      const url = await generateQrDataUrl(rec.value, 300);
      entries.push({ dataUrl: url, label: renderDetailSummary(rec), value: rec.value });
    }
    const tabName = customTypeDefs[activeTab]?.label ?? getTabLabel(activeTab);
    printQrSheet(entries, `${tabName} QR Codes`);
  };

  /* -------------------- Render helpers -------------------- */

  const renderFormFields = () => {
    if (activeTab === 'checkpoint') {
      return (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Checkpoint name <span className="text-error-500">*</span></label>
            <input type="text" value={getFormValue('name')} onChange={(e) => setFormValue('name', e.target.value)} placeholder="e.g. Main Entrance" required autoFocus disabled={creating}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Location <span className="text-[var(--text-subtle)]">(optional)</span></label>
            <input type="text" value={getFormValue('location')} onChange={(e) => setFormValue('location', e.target.value)} placeholder="e.g. Building A, Floor 2" disabled={creating}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Description <span className="text-[var(--text-subtle)]">(optional)</span></label>
            <textarea value={getFormValue('description')} onChange={(e) => setFormValue('description', e.target.value)} placeholder="Additional notes..." rows={3} disabled={creating}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
          </div>
        </>
      );
    }

    if (activeTab === 'item') {
      return (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Item type <span className="text-error-500">*</span></label>
          <input type="text" value={getFormValue('item_type')} onChange={(e) => setFormValue('item_type', e.target.value)} placeholder="e.g. Electronics, Document, Parcel" required autoFocus disabled={creating}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
        </div>
      );
    }

    if (activeTab === 'trolley') {
      return (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Trolley ID <span className="text-error-500">*</span></label>
            <input type="text" value={getFormValue('trolley_id')} onChange={(e) => setFormValue('trolley_id', e.target.value)} placeholder="e.g. TR-001" required autoFocus disabled={creating}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Checkpoint name <span className="text-[var(--text-subtle)]">(optional)</span></label>
            <input type="text" value={getFormValue('checkpoint_name')} onChange={(e) => setFormValue('checkpoint_name', e.target.value)} placeholder="e.g. Loading Bay" disabled={creating}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
          </div>
        </>
      );
    }

    if (activeTab === 'seal') {
      const previewSerials = sealBatchFirst.trim() && sealBatchLast.trim()
        ? generateSealSequence(sealBatchFirst.trim(), sealBatchLast.trim())
        : [];
      return (
        <>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSealCreateMode('individual')}
              className={`flex-1 rounded-lg border py-2.5 text-xs font-medium transition-colors ${sealCreateMode === 'individual' ? 'border-primary-500 bg-primary-500/10 text-primary-600' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'}`}>
              Individual
            </button>
            <button type="button" onClick={() => setSealCreateMode('batch')}
              className={`flex-1 rounded-lg border py-2.5 text-xs font-medium transition-colors ${sealCreateMode === 'batch' ? 'border-primary-500 bg-primary-500/10 text-primary-600' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'}`}>
              Batch (range)
            </button>
          </div>

          {sealCreateMode === 'individual' ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Seal serial <span className="text-error-500">*</span></label>
              <input type="text" value={getFormValue('seal_serial')} onChange={(e) => setFormValue('seal_serial', e.target.value)} placeholder="e.g. SL-2024-0001" required autoFocus disabled={creating}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)]">
                Enter the first and last seal serial numbers. The system will generate all QR codes in between. Both serials must share the same text prefix and end with numbers.
              </p>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">First seal <span className="text-error-500">*</span></label>
                <input type="text" value={sealBatchFirst} onChange={(e) => { setSealBatchFirst(e.target.value); setSealBatchResult(null); }} placeholder="e.g. SL-2024-0001" required autoFocus disabled={creating}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Last seal <span className="text-error-500">*</span></label>
                <input type="text" value={sealBatchLast} onChange={(e) => { setSealBatchLast(e.target.value); setSealBatchResult(null); }} placeholder="e.g. SL-2024-0100" required disabled={creating}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
              </div>
              {previewSerials.length > 0 && previewSerials.length <= 5000 && (
                <div className="rounded-lg border border-primary-500/20 bg-primary-500/5 p-3">
                  <p className="text-xs text-[var(--text-muted)]">
                    This will generate <span className="font-medium text-[var(--text)]">{previewSerials.length}</span> seal QR code{previewSerials.length !== 1 ? 's' : ''}.
                  </p>
                  <p className="mt-1 font-mono text-xs text-[var(--text-subtle)]">{previewSerials[0]} → {previewSerials[previewSerials.length - 1]}</p>
                </div>
              )}
              {previewSerials.length > 5000 && (
                <p className="rounded-lg bg-error-500/10 px-3 py-2 text-xs text-error-500">Range too large. Please limit to 5,000 seals at a time.</p>
              )}
              {sealBatchResult && (
                <div className="rounded-lg bg-accent-500/10 p-3 text-sm text-accent-700">
                  <span className="font-medium">{sealBatchResult.added}</span> seal QR code{sealBatchResult.added !== 1 ? 's' : ''} created.
                  {sealBatchResult.skipped > 0 && <> <span className="font-medium">{sealBatchResult.skipped}</span> duplicate{sealBatchResult.skipped !== 1 ? 's' : ''} skipped.</>}
                </div>
              )}
            </div>
          )}
        </>
      );
    }

    const def = customTypeDefs[activeTab];
    if (def && def.fields && def.fields.length > 0) {
      return (
        <>
          {def.fields.map((field) => (
            <div key={field.key}>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">{field.label}{field.required && <span className="text-error-500"> *</span>}</label>
              <input type="text" value={getFormValue(field.key)} onChange={(e) => setFormValue(field.key, e.target.value)} placeholder={`Enter ${field.label.toLowerCase()}`} required={field.required} disabled={creating}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
            </div>
          ))}
        </>
      );
    }

    return (
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Label / value <span className="text-error-500">*</span></label>
        <input type="text" value={getFormValue('label')} onChange={(e) => setFormValue('label', e.target.value)} placeholder="Enter a label for this QR code" required autoFocus disabled={creating}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
      </div>
    );
  };

  const renderDetailSummary = (rec: QrCodeRecord): string => {
    const d = rec.details ?? {};
    if (rec.type === 'checkpoint') return (d.name as string) ?? rec.value;
    if (rec.type === 'item') return (d.item_type as string) ?? rec.value;
    if (rec.type === 'trolley') return (d.trolley_id as string) ?? rec.value;
    if (rec.type === 'seal') return (d.seal_serial as string) ?? rec.value;
    const def = customTypeDefs[rec.type];
    if (def && def.fields && def.fields.length > 0) {
      const firstField = def.fields[0];
      const val = d[firstField.key] as string | undefined;
      if (val) return val;
    }
    if (d.label) return d.label as string;
    return rec.value;
  };

  /* -------------------- Render -------------------- */

  const ActiveIcon = getTabIcon(activeTab);
  const isBatchSealMode = activeTab === 'seal' && sealCreateMode === 'batch';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">QR Codes</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Generate and manage QR codes for checkpoints, items, trolleys, and seals.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filtered.length > 0 && (
            <>
              <button onClick={handleBatchDownload} disabled={batchProgress !== null}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50">
                {batchProgress !== null ? <><Loader2 className="h-4 w-4 animate-spin" /> {batchProgress.current}/{batchProgress.total}</> : <><Layers className="h-4 w-4" /> Download all</>}
              </button>
              <button onClick={handlePrintSheet}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]">
                <Printer className="h-4 w-4" /> Print sheet
              </button>
            </>
          )}
          <button onClick={() => { resetForm(); setShowCreate(true); }}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700">
            <Plus className="h-4 w-4" /> Generate QR code
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
        {allTabs.map((tab) => {
          const Icon = getTabIcon(tab);
          const count = records.filter((r) => r.type === tab).length;
          const tabLabelDisplay = customTypeDefs[tab]?.label ?? getTabLabel(tab);
          const isCustom = customTypeDefs[tab] !== undefined;
          return (
            <div key={tab} className="flex items-center">
              <button onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === tab ? 'bg-primary-600 text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'}`}>
                <Icon className="h-4 w-4" />
                {tabLabelDisplay}
                {count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-xs ${activeTab === tab ? 'bg-white/20 text-white' : 'bg-[var(--surface-hover)] text-[var(--text-subtle)]'}`}>{count}</span>}
              </button>
              {isCustom && (
                <>
                  <button onClick={() => openEditTabForm(tab)} className="ml-0.5 rounded p-1 text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-hover)] hover:text-primary-600" title="Edit tab"><Pencil className="h-3 w-3" /></button>
                  <button onClick={() => setDeleteTabTarget(customTypeDefs[tab])} className="rounded p-1 text-[var(--text-subtle)] transition-colors hover:bg-error-500/10 hover:text-error-500" title="Delete tab"><Trash2 className="h-3 w-3" /></button>
                </>
              )}
              {!isCustom && PREDEFINED_TYPES.includes(tab as PredefinedType) && (
                <button onClick={() => openEditPredefinedTab(tab)} className="ml-0.5 rounded p-1 text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-hover)] hover:text-primary-600" title="Rename tab"><Pencil className="h-3 w-3" /></button>
              )}
            </div>
          );
        })}
        <button onClick={openTabForm} className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-hover)] hover:text-primary-600" title="Create custom QR type">
          <Settings2 className="h-4 w-4" /> New Tab
        </button>
      </div>

      {/* Search */}
      {records.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${getTabLabel(activeTab).toLowerCase()} QR codes...`}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20" />
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--text-subtle)]" />
          <p className="mt-2">Loading QR codes...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <ActiveIcon className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">{search ? 'No QR codes found' : `No ${getTabLabel(activeTab).toLowerCase()} QR codes yet`}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{search ? 'Try a different search term.' : `Generate your first ${getTabLabel(activeTab).toLowerCase()} QR code.`}</p>
          {!search && (
            <button onClick={() => { resetForm(); setShowCreate(true); }} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700">
              <Plus className="h-4 w-4" /> Generate QR code
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((rec) => (
            <div key={rec.id} className="group rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-all hover:border-primary-500/30 hover:shadow-lg">
              <div className="mb-4 flex justify-center">
                <div className="rounded-lg border border-[var(--border)] bg-white p-3">
                  {qrCache[rec.value] ? <img src={qrCache[rec.value]} alt={`QR code ${rec.value}`} className="h-32 w-32" /> : <div className="flex h-32 w-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-subtle)]" /></div>}
                </div>
              </div>
              <div className="mb-3">
                <h3 className="truncate text-base font-semibold text-[var(--text)]">{renderDetailSummary(rec)}</h3>
                <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{rec.value}</p>
              </div>
              <div className="mb-4 flex items-center gap-1.5 text-xs text-[var(--text-subtle)]">
                {rec.origin && rec.origin !== 'app' && <span className="mr-1 rounded-full bg-warning-500/10 px-2 py-0.5 text-xs font-medium text-warning-500">{rec.origin}</span>}
                {formatDate(rec.created_at)}
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--border)] pt-4">
                <button onClick={() => handleDownload(rec)} disabled={downloadingId === rec.id}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] py-2 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50">
                  {downloadingId === rec.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download
                </button>
                <button onClick={() => handleRegenerate(rec)} disabled={regeneratingId === rec.id}
                  className="flex items-center justify-center rounded-lg border border-[var(--border)] px-2.5 py-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-primary-600 disabled:opacity-50" title="Regenerate QR code">
                  {regeneratingId === rec.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => setDeleteTarget(rec)}
                  className="flex items-center justify-center rounded-lg border border-[var(--border)] px-2.5 py-2 text-error-500 transition-colors hover:bg-error-500/10 hover:border-error-500/30" title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !creating && setShowCreate(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--text)]">
                <ActiveIcon className="h-5 w-5 text-primary-600" /> New {getTabLabel(activeTab)} QR Code
              </h3>
              <button onClick={() => !creating && setShowCreate(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]" disabled={creating}><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={isBatchSealMode ? handleBatchSealCreate : handleCreate} className="space-y-4">
              {renderFormFields()}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} disabled={creating}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={creating}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50">
                  {creating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {isBatchSealMode ? 'Generating batch...' : 'Generating...'}</>
                  ) : (
                    <><QrCode className="h-4 w-4" /> {isBatchSealMode ? 'Generate batch' : 'Generate QR'}</>
                  )}
                </button>
              </div>
            </form>
            {formError && (
              <p className="mt-3 rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-500">{formError}</p>
            )}
            <p className="mt-4 text-center text-xs text-[var(--text-subtle)]">A unique QR code will be generated automatically.</p>
          </div>
        </div>
      )}

      {/* Custom tab creation modal */}
      {showTabForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !savingTab && setShowTabForm(false)} />
          <div className="relative w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--text)]">
                <Settings2 className="h-5 w-5 text-primary-600" /> {editingTab ? 'Edit Custom QR Tab' : 'Create Custom QR Tab'}
              </h3>
              <button onClick={() => !savingTab && setShowTabForm(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]" disabled={savingTab}><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleSaveTab} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Tab name <span className="text-error-500">*</span></label>
                <input type="text" value={tabLabel} onChange={(e) => setTabLabel(e.target.value)} placeholder="e.g. Vehicle, Equipment, Asset" required autoFocus disabled={savingTab}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                <p className="mt-1 text-xs text-[var(--text-subtle)]">This becomes a new tab in the QR Codes page with its own customizable fields.</p>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="block text-sm font-medium text-[var(--text)]">Detail Fields</label>
                  <button type="button" onClick={addTabField} disabled={savingTab} className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"><Plus className="h-3.5 w-3.5" /> Add field</button>
                </div>
                <p className="mb-3 text-xs text-[var(--text-muted)]">Define the fields captured when generating this type of QR code.</p>
                <div className="space-y-2">
                  {tabFields.map((field, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="text" value={field.label} onChange={(e) => updateTabField(i, 'label', e.target.value)} placeholder="Field label (e.g. Serial Number)" disabled={savingTab}
                        className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50" />
                      <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]" title="Required field">
                        <input type="checkbox" checked={field.required} onChange={(e) => updateTabField(i, 'required', e.target.checked)} disabled={savingTab} className="h-4 w-4 rounded border-[var(--border)]" /> Req
                      </label>
                      {tabFields.length > 1 && <button type="button" onClick={() => removeTabField(i)} disabled={savingTab} className="text-error-500 hover:text-error-600" title="Remove field"><X className="h-4 w-4" /></button>}
                    </div>
                  ))}
                </div>
              </div>
              {tabError && <p className="rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-500">{tabError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowTabForm(false)} disabled={savingTab}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={savingTab}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50">
                  {savingTab ? <><Loader2 className="h-4 w-4 animate-spin" /> {editingTab ? 'Saving...' : 'Creating...'}</> : <>{editingTab ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {editingTab ? 'Save changes' : 'Create tab'}</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete QR code confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-500/10"><Trash2 className="h-6 w-6 text-error-500" /></div>
              <h3 className="text-lg font-semibold text-[var(--text)]">Delete QR code?</h3>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">"{deleteTarget.value}" will be permanently removed. This cannot be undone.</p>
              <div className="mt-6 flex w-full gap-3">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]">Cancel</button>
                <button onClick={handleDelete} className="flex-1 rounded-lg bg-error-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-600">Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit predefined tab label modal */}
      {editPredefinedTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditPredefinedTab(null)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--text)]"><Pencil className="h-5 w-5 text-primary-600" /> Rename Tab</h3>
              <button onClick={() => setEditPredefinedTab(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Display name</label>
                <input type="text" value={predefinedLabel} onChange={(e) => setPredefinedLabel(e.target.value)} autoFocus
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20" />
                <p className="mt-1 text-xs text-[var(--text-subtle)]">This changes how the tab name appears. The internal type stays the same.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditPredefinedTab(null)} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]">Cancel</button>
                <button onClick={handleSavePredefinedLabel} disabled={!predefinedLabel.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"><Save className="h-4 w-4" /> Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete custom tab confirmation */}
      {deleteTabTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteTabTarget(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-500/10"><Trash2 className="h-6 w-6 text-error-500" /></div>
              <h3 className="text-lg font-semibold text-[var(--text)]">Delete "{deleteTabTarget.label}" tab?</h3>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">All QR codes created under this tab will be permanently deleted. This cannot be undone.</p>
              <div className="mt-6 flex w-full gap-3">
                <button onClick={() => setDeleteTabTarget(null)} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]">Cancel</button>
                <button onClick={handleDeleteTab} className="flex-1 rounded-lg bg-error-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-600">Delete tab</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
