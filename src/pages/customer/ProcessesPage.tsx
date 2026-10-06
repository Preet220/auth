import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  GitBranch, Plus, X, Loader as Loader2, Play, Pencil, Trash2,
  MapPin, PackagePlus, QrCode, Scale, Camera, CheckCircle,
  ShieldCheck, Truck, Save, BadgeCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/qr';
import { WorkflowCanvas } from '@/components/WorkflowCanvas';
import {
  type Workflow, type WorkflowNode, type WorkflowNodeType,
  type VerificationTarget,
  NODE_META, NODE_TYPES, createNode, emptyWorkflow,
} from '@shared/types/workflow';

type ProcessCategory = 'critical' | 'high' | 'moderate' | 'low';

interface ProcessDefinition {
  id: string;
  name: string;
  category: ProcessCategory;
  stages: string[];
  workflow: Workflow | null;
  created_at: string;
}

interface QrCode {
  id: string;
  value: string;
  type: string;
  details: Record<string, unknown> | null;
}

const CATEGORY_LABELS: Record<ProcessCategory, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};

const CATEGORY_BADGES: Record<ProcessCategory, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  moderate: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

const CATEGORY_OPTIONS: ProcessCategory[] = ['critical', 'high', 'moderate', 'low'];

const NODE_ICONS: Record<WorkflowNodeType, typeof MapPin> = {
  stage: MapPin,
  batch_create: PackagePlus,
  qr_scan: QrCode,
  weighing: Scale,
  photo: Camera,
  approval: CheckCircle,
  condition: GitBranch,
  seal_verify: ShieldCheck,
  trolley_scan: Truck,
  verification: BadgeCheck,
};

const VERIFICATION_TARGET_OPTIONS: { value: VerificationTarget; label: string }[] = [
  { value: 'weight', label: 'Weight' },
  { value: 'seal', label: 'Seal QR' },
  { value: 'item', label: 'Item QR' },
  { value: 'trolley', label: 'Trolley QR' },
  { value: 'batch', label: 'Batch' },
];

export function ProcessesPage({ riskManagementEnabled = true }: { riskManagementEnabled?: boolean }) {
  const { appUser } = useAuth();
  const [processes, setProcesses] = useState<ProcessDefinition[]>([]);
  const [qrCodes, setQrCodes] = useState<QrCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProcessDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProcessDefinition | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<ProcessCategory>('moderate');
  const [workflow, setWorkflow] = useState<Workflow>(emptyWorkflow());
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchProcesses = useCallback(async () => {
    const { data, error } = await supabase
      .from('process_definitions')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setProcesses(data as ProcessDefinition[]);
  }, []);

  const fetchQrCodes = useCallback(async () => {
    const { data, error } = await supabase
      .from('qr_codes')
      .select('id, value, type, details')
      .order('value', { ascending: true });
    if (!error && data) setQrCodes(data as QrCode[]);
  }, []);

  useEffect(() => {
    Promise.all([fetchProcesses(), fetchQrCodes()]).finally(() => setLoading(false));
  }, [fetchProcesses, fetchQrCodes]);

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormCategory('moderate');
    setWorkflow(emptyWorkflow());
    setSelectedNode(null);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (p: ProcessDefinition) => {
    setEditing(p);
    setFormName(p.name);
    setFormCategory(p.category);
    const wf = p.workflow ?? emptyWorkflow();
    setWorkflow(wf);
    setSelectedNode(null);
    setFormError('');
    setShowForm(true);
  };

  const qrLabel = (id: string) => {
    const q = qrCodes.find((c) => c.id === id);
    if (!q) return id.slice(0, 8);
    const label = q.details ? String(q.details.name ?? q.details.item_type ?? q.details.trolley_id ?? q.details.seal_serial ?? '') : '';
    return label ? `${label} (${q.value})` : q.value;
  };

  // Add node from palette — stages auto-connect to the previous stage;
  // sub-activities auto-connect to the currently selected stage node
  const handleAddNode = (type: WorkflowNodeType) => {
    const offset = workflow.nodes.length * 30;
    const node = createNode(type, 80 + offset, 60 + offset);
    const newNodes = [...workflow.nodes, node];
    let newEdges = [...workflow.edges];

    if (type === 'stage') {
      const lastStage = [...workflow.nodes].reverse().find((n) => n.type === 'stage');
      if (lastStage) {
        const exists = newEdges.some((e) => e.source === lastStage.id && e.target === node.id);
        if (!exists) {
          newEdges.push({ id: crypto.randomUUID(), source: lastStage.id, target: node.id });
        }
      }
    } else {
      const attachTo = selectedNode?.type === 'stage' ? selectedNode : null;
      if (attachTo) {
        const exists = newEdges.some((e) => e.source === attachTo.id && e.target === node.id);
        if (!exists) {
          newEdges.push({ id: crypto.randomUUID(), source: attachTo.id, target: node.id });
        }
      }
    }

    setWorkflow({ nodes: newNodes, edges: newEdges });
    setSelectedNode(node);
  };

  // Update selected node
  const handleUpdateNode = (updates: Partial<WorkflowNode>) => {
    if (!selectedNode) return;
    const updated = workflow.nodes.map((n) =>
      n.id === selectedNode.id ? { ...n, ...updates } : n,
    );
    setWorkflow({ ...workflow, nodes: updated });
    setSelectedNode({ ...selectedNode, ...updates });
  };

  // Assign QR code to a stage node
  const handleAssignQr = (qrId: string) => {
    if (!selectedNode) return;
    const qr = qrCodes.find((q) => q.id === qrId);
    if (!qr) return;
    handleUpdateNode({
      qr_code_id: qrId,
      qr_value: qr.value,
      label: qr.details?.name ? String(qr.details.name) : qr.value,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Process name is required.');
      return;
    }
    if (workflow.nodes.length === 0) {
      setFormError('Add at least one node to the workflow.');
      return;
    }
    const stageNodes = workflow.nodes.filter((n) => n.type === 'stage');
    if (stageNodes.length === 0) {
      setFormError('Add at least one Stage/Checkpoint node.');
      return;
    }
    setSaving(true);
    setFormError('');

    const stageIds = stageNodes.map((n) => n.qr_code_id).filter(Boolean) as string[];
    const payload = {
      name: formName.trim(),
      category: formCategory,
      stages: stageIds,
      workflow: workflow,
    };

    if (editing) {
      const { data, error } = await supabase
        .from('process_definitions')
        .update(payload)
        .eq('id', editing.id)
        .select()
        .single();
      if (!error && data) {
        setProcesses((prev) =>
          prev.map((p) => (p.id === editing.id ? (data as ProcessDefinition) : p)),
        );
        setShowForm(false);
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: appUser?.role ?? 'admin',
          action: 'process_updated',
          details: { id: editing.id, name: formName.trim() },
        });
      } else {
        setFormError(error?.message ?? 'Failed to update process.');
      }
    } else {
      const { data, error } = await supabase
        .from('process_definitions')
        .insert(payload)
        .select()
        .single();
      if (!error && data) {
        setProcesses((prev) => [data as ProcessDefinition, ...prev]);
        setShowForm(false);
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: appUser?.role ?? 'admin',
          action: 'process_created',
          details: { id: (data as ProcessDefinition).id, name: formName.trim(), category: formCategory },
        });
      } else {
        setFormError(error?.message ?? 'Failed to create process.');
      }
    }
    setSaving(false);
  };

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    const { error } = await supabase.from('process_definitions').delete().eq('id', deleteTarget.id);
    if (error) {
      setDeleteError(error.message ?? 'Failed to delete process.');
      setDeleting(false);
      return;
    }
    setProcesses((prev) => prev.filter((p) => p.id !== deleteTarget.id));
    await supabase.from('customer_activity_logs').insert({
      actor_id: appUser?.id ?? '',
      actor_email: appUser?.email ?? '',
      actor_role: appUser?.role ?? 'admin',
      action: 'process_deleted',
      details: { id: deleteTarget.id, name: deleteTarget.name },
    });
    setDeleteTarget(null);
    setDeleting(false);
  };

  const handleStartRun = async (p: ProcessDefinition) => {
    setStartingId(p.id);
    await supabase.from('process_runs').insert({
      process_definition_id: p.id,
      status: 'in_progress',
    });
    setStartingId(null);
  };

  const stageCount = useMemo(
    () => workflow.nodes.filter((n) => n.type === 'stage').length,
    [workflow.nodes],
  );

  const renderNodeContent = (node: WorkflowNode) => {
    const Icon = NODE_ICONS[node.type];
    const meta = NODE_META[node.type];
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-0.5">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
          <span className="text-xs font-semibold text-[var(--text)] truncate max-w-[120px]">
            {node.label}
          </span>
        </div>
        <span className="text-[9px] text-[var(--text-muted)] capitalize">
          {node.type.replace(/_/g, ' ')}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Processes</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Design visual workflows with stages, activities, branches, and approvals.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          New process
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading processes...
        </div>
      ) : processes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <GitBranch className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">No processes defined yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Create a process with the visual workflow designer.
          </p>
          <button
            onClick={openCreate}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Create process
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {processes.map((p) => {
            const wf = p.workflow ?? emptyWorkflow();
            const nodeCount = wf.nodes?.length ?? 0;
            const stageCount = wf.nodes?.filter((n) => n.type === 'stage').length ?? 0;
            return (
              <div
                key={p.id}
                className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-all hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-[var(--text)]">{p.name}</h3>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CATEGORY_BADGES[p.category]}`}
                      >
                        {CATEGORY_LABELS[p.category]}
                      </span>
                      <span className="text-xs text-[var(--text-subtle)]">
                        {stageCount} stages · {nodeCount} nodes
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mini workflow preview */}
                {nodeCount > 0 && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-hover)]" style={{ height: 80 }}>
                    <svg width="100%" height="80" className="overflow-hidden">
                      {wf.edges?.map((edge) => {
                        const s = wf.nodes.find((n) => n.id === edge.source);
                        const t = wf.nodes.find((n) => n.id === edge.target);
                        if (!s || !t) return null;
                        const scale = 0.35;
                        const offX = 10;
                        const offY = 5;
                        const sx = (s.x + 90) * scale + offX;
                        const sy = (s.y + 80) * scale + offY;
                        const tx = (t.x + 90) * scale + offX;
                        const ty = t.y * scale + offY;
                        const my = (sy + ty) / 2;
                        return (
                          <path
                            key={edge.id}
                            d={`M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${ty}`}
                            fill="none"
                            stroke="#94a3b8"
                            strokeWidth={1}
                          />
                        );
                      })}
                      {wf.nodes?.map((n) => {
                        const meta = NODE_META[n.type];
                        const scale = 0.35;
                        const offX = 10;
                        const offY = 5;
                        return (
                          <rect
                            key={n.id}
                            x={n.x * scale + offX}
                            y={n.y * scale + offY}
                            width={180 * scale}
                            height={80 * scale}
                            rx={4}
                            fill={meta.color}
                            opacity={0.7}
                          />
                        );
                      })}
                    </svg>
                  </div>
                )}

                <div className="mt-3 text-xs text-[var(--text-subtle)]">
                  Created {formatDate(p.created_at)}
                </div>

                <div className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-4">
                  <button
                    onClick={() => handleStartRun(p)}
                    disabled={startingId === p.id}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                  >
                    {startingId === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Start run
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    className="flex items-center justify-center rounded-lg border border-[var(--border)] px-2.5 py-2 text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
                    title="Edit process"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(p)}
                    className="flex items-center justify-center rounded-lg border border-[var(--border)] px-2.5 py-2 text-error-500 transition-colors hover:bg-error-500/10 hover:border-error-500/30"
                    title="Delete process"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit modal with workflow designer */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2">
          <div className="absolute inset-0 bg-black/50" onClick={() => !saving && setShowForm(false)} />
          <div className="relative flex h-[92vh] w-full max-w-7xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <div className="flex items-center gap-3">
                <GitBranch className="h-5 w-5 text-primary-600" />
                <h3 className="text-lg font-semibold text-[var(--text)]">
                  {editing ? 'Edit Process' : 'New Process'} — Workflow Designer
                </h3>
              </div>
              <button
                onClick={() => !saving && setShowForm(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Top form row */}
            <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] px-6 py-3">
              <div className="flex-1 min-w-[200px]">
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                  Process name <span className="text-error-500">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Loading Bay Sequence"
                  disabled={saving}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as ProcessCategory)}
                  disabled={saving}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                >
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {stageCount} stage(s) · {workflow.nodes.length} node(s) · {workflow.edges.length} connection(s)
              </div>
            </div>

            {/* Main designer area */}
            <div className="flex flex-1 overflow-hidden">
              {/* Node palette */}
              <div className="w-44 shrink-0 overflow-y-auto border-r border-[var(--border)] p-3">
                <p className="mb-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Node Types</p>
                <div className="space-y-1.5">
                  {NODE_TYPES.filter((type) => {
                    if (type === 'verification') {
                      return riskManagementEnabled;
                    }
                    return true;
                  }).map((type) => {
                    const meta = NODE_META[type];
                    const Icon = NODE_ICONS[type];
                    return (
                      <button
                        key={type}
                        onClick={() => handleAddNode(type)}
                        disabled={saving}
                        className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-left text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
                        <span className="truncate">{meta.label}</span>
                        <Plus className="ml-auto h-3 w-3 text-[var(--text-subtle)]" />
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-lg bg-[var(--surface-hover)] p-3">
                  <p className="text-xs font-medium text-[var(--text-muted)]">How to use</p>
                  <ul className="mt-1.5 space-y-1 text-[11px] text-[var(--text-subtle)]">
                    <li><strong>Stages auto-connect</strong> to the previous stage</li>
                    <li><strong>Activities auto-attach</strong> to the selected stage</li>
                    <li>Select a stage first, then add activities to link them</li>
                    <li>Drag from bottom port for custom connections</li>
                    <li>Click an edge to delete it</li>
                    <li>Hold Space + drag to pan</li>
                    <li><strong>Verification node</strong> is only available when Risk Management is enabled for your organization</li>
                  </ul>
                </div>
              </div>

              {/* Canvas */}
              <div className="flex-1 p-3">
                <WorkflowCanvas
                  workflow={workflow}
                  onChange={setWorkflow}
                  renderNodeContent={renderNodeContent}
                  onNodeClick={(n) => setSelectedNode(n)}
                  selectedNodeId={selectedNode?.id ?? null}
                  className="h-full"
                />
              </div>

              {/* Properties panel */}
              <div className="w-64 shrink-0 overflow-y-auto border-l border-[var(--border)] p-4">
                {selectedNode ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        Selected Node
                      </p>
                      <p className="mt-1 text-sm font-medium text-[var(--text)] capitalize">
                        {selectedNode.type.replace(/_/g, ' ')}
                      </p>
                    </div>

                    {selectedNode.type === 'stage' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                          Assign Checkpoint QR
                        </label>
                        <select
                          value={selectedNode.qr_code_id ?? ''}
                          onChange={(e) => handleAssignQr(e.target.value)}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                        >
                          <option value="">— Select QR —</option>
                          {qrCodes
                            .filter((q) => q.type === 'checkpoint')
                            .map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.details?.name ? String(q.details.name) : q.value}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {selectedNode.type === 'qr_scan' && (
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                            QR Type to Scan
                          </label>
                          <select
                            value={(selectedNode.config.qr_type as string) ?? 'item'}
                            onChange={(e) => handleUpdateNode({ config: { ...selectedNode.config, qr_type: e.target.value } })}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                          >
                            <option value="checkpoint">Checkpoint</option>
                            <option value="item">Item</option>
                            <option value="trolley">Trolley</option>
                            <option value="seal">Seal</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                            Pre-assign QR (optional)
                          </label>
                          <select
                            value={selectedNode.qr_code_id ?? ''}
                            onChange={(e) => {
                              if (e.target.value) handleAssignQr(e.target.value);
                              else handleUpdateNode({ qr_code_id: undefined, qr_value: undefined });
                            }}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                          >
                            <option value="">Any valid QR of this type</option>
                            {qrCodes
                              .filter((q) => q.type === ((selectedNode.config.qr_type as string) ?? 'item'))
                              .map((q) => (
                                <option key={q.id} value={q.id}>
                                  {q.details?.name ? String(q.details.name) : q.details?.item_type ? String(q.details.item_type) : q.value}
                                </option>
                              ))}
                          </select>
                          <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
                            If pre-assigned, employees must scan this exact QR. Otherwise any QR of this type is accepted.
                          </p>
                        </div>
                      </div>
                    )}

                    {selectedNode.type === 'condition' && (
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                            Condition Label
                          </label>
                          <input
                            type="text"
                            value={(selectedNode.config.condition_label as string) ?? ''}
                            onChange={(e) => handleUpdateNode({ config: { ...selectedNode.config, condition_label: e.target.value } })}
                            placeholder="e.g. Weight > 50kg?"
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                          />
                          <p className="mt-1.5 text-xs text-[var(--text-subtle)]">
                            Create two outgoing connections labeled "Yes" and "No".
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="condition-risk"
                            checked={(selectedNode.config.risk_toggle as boolean) ?? false}
                            onChange={(e) => handleUpdateNode({ config: { ...selectedNode.config, risk_toggle: e.target.checked } })}
                            className="h-4 w-4 rounded border-[var(--border)]"
                          />
                          <label htmlFor="condition-risk" className="text-xs text-[var(--text-muted)]">
                            Risk reconciliation gate
                          </label>
                        </div>
                        <p className="text-[11px] text-[var(--text-subtle)]">
                          When enabled, the reconciliation result is only shown if this toggle is on. If off, the result is hidden from employees.
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'approval' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                          Approver Role
                        </label>
                        <select
                          value={(selectedNode.config.approver as string) ?? 'admin'}
                          onChange={(e) => handleUpdateNode({ config: { ...selectedNode.config, approver: e.target.value } })}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                        >
                          <option value="admin">Admin</option>
                          <option value="manager">Manager</option>
                          <option value="supervisor">Supervisor</option>
                        </select>
                      </div>
                    )}

                    {selectedNode.type === 'weighing' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                          Weighing Type
                        </label>
                        <select
                          value={(selectedNode.config.weigh_type as string) ?? 'auto'}
                          onChange={(e) => handleUpdateNode({ config: { ...selectedNode.config, weigh_type: e.target.value } })}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                        >
                          <option value="auto">Automatic (scale)</option>
                          <option value="manual">Manual entry</option>
                          <option value="both">Both options</option>
                        </select>
                      </div>
                    )}

                    {selectedNode.type === 'photo' && (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-[var(--text)]">Enforce photo capture</p>
                              <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
                                When enabled, employees cannot proceed until they capture a photo at this step. When disabled, the photo is optional.
                              </p>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={(selectedNode.config.required as boolean) ?? false}
                              onClick={() => handleUpdateNode({ config: { ...selectedNode.config, required: !((selectedNode.config.required as boolean) ?? false) } })}
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                                (selectedNode.config.required as boolean) ?? false ? 'bg-primary-600' : 'bg-[var(--border)]'
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                  (selectedNode.config.required as boolean) ?? false ? 'translate-x-4' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-[var(--text-subtle)]">
                          This toggle works per photo node. Each photo step in the process can be individually enforced or made optional.
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'seal_verify' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                          Pre-assign Seal QR (optional)
                        </label>
                        <select
                          value={selectedNode.qr_code_id ?? ''}
                          onChange={(e) => {
                            if (e.target.value) handleAssignQr(e.target.value);
                            else handleUpdateNode({ qr_code_id: undefined, qr_value: undefined });
                          }}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                        >
                          <option value="">Any valid seal QR</option>
                          {qrCodes
                            .filter((q) => q.type === 'seal')
                            .map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.details?.seal_serial ? String(q.details.seal_serial) : q.value}
                              </option>
                            ))}
                        </select>
                        <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
                          If pre-assigned, employees must scan this exact seal. Otherwise any seal in the system is accepted.
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'trolley_scan' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                          Pre-assign Trolley QR (optional)
                        </label>
                        <select
                          value={selectedNode.qr_code_id ?? ''}
                          onChange={(e) => {
                            if (e.target.value) handleAssignQr(e.target.value);
                            else handleUpdateNode({ qr_code_id: undefined, qr_value: undefined });
                          }}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                        >
                          <option value="">Any valid trolley QR</option>
                          {qrCodes
                            .filter((q) => q.type === 'trolley')
                            .map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.details?.trolley_id ? String(q.details.trolley_id) : q.value}
                              </option>
                            ))}
                        </select>
                        <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
                          If pre-assigned, employees must scan this exact trolley. Otherwise any trolley in the system is accepted.
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'batch_create' && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                          Batch Position
                        </label>
                        <select
                          value={(selectedNode.config.batch_position as string) ?? 'beginning'}
                          onChange={(e) => handleUpdateNode({ config: { ...selectedNode.config, batch_position: e.target.value } })}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                        >
                          <option value="beginning">Beginning</option>
                          <option value="end">End</option>
                        </select>
                        <p className="mt-1.5 text-[11px] text-[var(--text-subtle)]">
                          "Beginning" means items are scanned and weighed at the start of the process. "End" means items are verified at the end before completion.
                        </p>
                      </div>
                    )}

                    {selectedNode.type === 'verification' && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                          Verification steps (select all that apply)
                        </label>
                        <div className="space-y-2">
                          {VERIFICATION_TARGET_OPTIONS.map((opt) => {
                            const current = (selectedNode.config.verification_targets as VerificationTarget[]) ?? [];
                            const checked = current.includes(opt.value);
                            return (
                              <label key={opt.value} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 cursor-pointer hover:bg-[var(--surface-hover)]">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...current, opt.value]
                                      : current.filter((v) => v !== opt.value);
                                    handleUpdateNode({ config: { ...selectedNode.config, verification_targets: next } });
                                  }}
                                  className="h-4 w-4 rounded border-[var(--border)]"
                                />
                                <span className="text-sm text-[var(--text)]">{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="mt-1.5 text-[11px] text-[var(--text-subtle)]">
                          Employees must complete every selected verification step before advancing.
                        </p>
                      </div>
                    )}

                    <div className="border-t border-[var(--border)] pt-3">
                      <p className="text-xs text-[var(--text-subtle)]">
                        Position: ({Math.round(selectedNode.x)}, {Math.round(selectedNode.y)})
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-center text-xs text-[var(--text-subtle)] pt-4">
                      Select a node to edit its properties.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {formError && (
              <div className="px-6 py-2">
                <p className="rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-500">
                  {formError}
                </p>
              </div>
            )}

            {/* Footer */}
            <div className="flex gap-3 border-t border-[var(--border)] px-6 py-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    {editing ? 'Save changes' : 'Create process'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-500/10">
                <Trash2 className="h-6 w-6 text-error-500" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)]">Delete process?</h3>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                "{deleteTarget.name}" will be permanently removed.
              </p>
              {deleteError && (
                <p className="mt-3 rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-500">
                  {deleteError}
                </p>
              )}
              <div className="mt-6 flex w-full gap-3">
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
                  disabled={deleting}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-error-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-600 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
