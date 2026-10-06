import { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Info,
  GitBranch,
  Check,
  Lock,
  Settings2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/qr';
import { useAuth } from '@/lib/auth';

type SeverityModel = 'multi_level' | 'pass_fail';
type RuleScope = 'stage' | 'process';
type ProcessCategory = 'critical' | 'high' | 'moderate' | 'low';
type RuleAction = 'block' | 'alert' | 'warn';

interface ThresholdEntry {
  key: string;
  value: string;
}

interface RiskRule {
  id: string;
  name: string;
  rule_type: string;
  severity_model: SeverityModel;
  thresholds: Record<string, string | number> | null;
  scope: RuleScope;
  action: RuleAction;
  is_builtin: boolean | null;
  process_category: ProcessCategory | null;
  created_at: string;
}

interface WorkflowNodeLite {
  id: string;
  type: string;
  label: string;
  risk_rule_ids?: string[];
}

interface WorkflowLite {
  nodes: WorkflowNodeLite[];
  edges: Array<{ id: string; source: string; target: string }>;
  risk_rule_ids?: string[];
}

interface ProcessDefLite {
  id: string;
  name: string;
  category: string;
  workflow: WorkflowLite | null;
}

const CATEGORY_LABELS: Record<ProcessCategory, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};

const CATEGORY_OPTIONS: ProcessCategory[] = ['critical', 'high', 'moderate', 'low'];

const CATEGORY_BADGES: Record<ProcessCategory, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  moderate: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

const SEVERITY_BADGES: Record<SeverityModel, string> = {
  multi_level: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  pass_fail: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

const SCOPE_BADGES: Record<RuleScope, string> = {
  stage: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  process: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
};

const ACTION_LABELS: Record<RuleAction, string> = {
  block: 'Block process',
  alert: 'Alert only',
  warn: 'Warn & continue',
};

const ACTION_DESCRIPTIONS: Record<RuleAction, string> = {
  block: 'Prevents the process from completing. The employee will see the breach and cannot finish until it is resolved.',
  alert: 'Lets the process continue normally. An alert is generated for admins to review.',
  warn: 'Shows a warning to the employee but allows them to continue. An alert is also generated.',
};

const ACTION_BADGES: Record<RuleAction, string> = {
  block: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  alert: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

const BUILT_IN_DESCRIPTIONS: Record<string, string> = {
  single_person_completion: 'The entire process must be carried out by the person who started it and no one else; once started it must be completed by the same person.',
  time_limit: 'Each process can have a time limit set by the admin; if the limit is exceeded, an alert is sent to the admin.',
  seal_matching: 'All seals scanned at the beginning of the process must match the seals scanned at the end; a mismatch triggers an alert.',
  duplicate_seal: 'A seal used in any earlier completed process cannot be used again; a repeat triggers a Duplicate Seal alert.',
  weight_reconciliation: 'If the individual or collective weight of the batch at the start and end do not match, an alert is sent; this is a multi-level risk and the admin sets the threshold for each level.',
  process_deviation: 'If the employee deviates from the predefined process order or skips a stage, an alert is sent to the admin — e.g. if a QR is scanned that is different from the QR that was supposed to be scanned as per the process.',
  manual_weight_no_photo: 'Flags a discrepancy whenever weight was entered manually but no photo was captured for that scan.',
};

const RULE_TEMPLATES: { label: string; rule_type: string; description: string }[] = [
  { label: 'Weight tolerance', rule_type: 'weight_tolerance', description: 'Alert when weight difference exceeds a set amount (e.g. more than 0.5 kg off).' },
  { label: 'Time limit', rule_type: 'time_limit', description: 'Alert when a step or process takes longer than a set number of minutes.' },
  { label: 'Missing photo', rule_type: 'missing_photo', description: 'Alert when a required photo was not captured at a step.' },
  { label: 'Custom condition', rule_type: 'custom', description: 'A blank rule you can configure from scratch with your own thresholds.' },
];

export function RiskRulesPage() {
  const { appUser } = useAuth();
  const [rules, setRules] = useState<RiskRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RiskRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RiskRule | null>(null);
  const [formError, setFormError] = useState('');
  const [activeTab, setActiveTab] = useState<'rules' | 'assignment'>('rules');
  const [editingCategoryFor, setEditingCategoryFor] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<ProcessCategory>('moderate');
  const [savingCategory, setSavingCategory] = useState(false);

  const [processes, setProcesses] = useState<ProcessDefLite[]>([]);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [savingAssignment, setSavingAssignment] = useState(false);

  const [formName, setFormName] = useState('');
  const [formRuleType, setFormRuleType] = useState('');
  const [formSeverity, setFormSeverity] = useState<SeverityModel>('multi_level');
  const [formScope, setFormScope] = useState<RuleScope>('stage');
  const [formAction, setFormAction] = useState<RuleAction>('alert');
  const [formCategory, setFormCategory] = useState<ProcessCategory>('moderate');
  const [formTemplate, setFormTemplate] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [thresholds, setThresholds] = useState<ThresholdEntry[]>([{ key: '', value: '' }]);
  const [saving, setSaving] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('risk_rules')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setRules(data as RiskRule[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const fetchProcesses = useCallback(async () => {
    setAssignmentLoading(true);
    const { data, error } = await supabase
      .from('process_definitions')
      .select('id, name, category, workflow')
      .order('created_at', { ascending: false });
    if (!error && data) {
      setProcesses(data as ProcessDefLite[]);
      if (data.length > 0) setSelectedProcessId((data as ProcessDefLite[])[0].id);
    }
    setAssignmentLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === 'assignment' && processes.length === 0) {
      fetchProcesses();
    }
  }, [activeTab, processes.length, fetchProcesses]);

  const builtinRules = rules.filter((r) => r.is_builtin);
  const customRules = rules.filter((r) => !r.is_builtin);

  const handleToggleStageRule = async (nodeId: string, ruleId: string) => {
    const proc = processes.find((p) => p.id === selectedProcessId);
    if (!proc || !proc.workflow) return;
    setSavingAssignment(true);
    const nodes = proc.workflow.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const current = n.risk_rule_ids ?? [];
      const next = current.includes(ruleId)
        ? current.filter((id) => id !== ruleId)
        : [...current, ruleId];
      return { ...n, risk_rule_ids: next };
    });
    const updatedWorkflow = { ...proc.workflow, nodes };
    const { error } = await supabase
      .from('process_definitions')
      .update({ workflow: updatedWorkflow })
      .eq('id', proc.id);
    if (!error) {
      setProcesses((prev) =>
        prev.map((p) => (p.id === proc.id ? { ...p, workflow: updatedWorkflow } : p)),
      );
    }
    setSavingAssignment(false);
  };

  const handleToggleProcessRule = async (ruleId: string) => {
    const proc = processes.find((p) => p.id === selectedProcessId);
    if (!proc || !proc.workflow) return;
    setSavingAssignment(true);
    const current = proc.workflow.risk_rule_ids ?? [];
    const next = current.includes(ruleId)
      ? current.filter((id) => id !== ruleId)
      : [...current, ruleId];
    const updatedWorkflow = { ...proc.workflow, risk_rule_ids: next };
    const { error } = await supabase
      .from('process_definitions')
      .update({ workflow: updatedWorkflow })
      .eq('id', proc.id);
    if (!error) {
      setProcesses((prev) =>
        prev.map((p) => (p.id === proc.id ? { ...p, workflow: updatedWorkflow } : p)),
      );
    }
    setSavingAssignment(false);
  };

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormRuleType('');
    setFormSeverity('multi_level');
    setFormScope('stage');
    setFormAction('alert');
    setFormCategory('moderate');
    setFormTemplate('');
    setFormDescription('');
    setThresholds([{ key: '', value: '' }]);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (r: RiskRule) => {
    setEditing(r);
    setFormName(r.name);
    setFormRuleType(r.rule_type);
    setFormSeverity(r.severity_model);
    setFormScope(r.scope);
    setFormAction((r.action ?? 'alert') as RuleAction);
    setFormCategory((r.process_category ?? 'moderate') as ProcessCategory);
    setFormTemplate('');
    setFormDescription('');
    const entries = r.thresholds
      ? Object.entries(r.thresholds).map(([key, value]) => ({ key, value: String(value) }))
      : [{ key: '', value: '' }];
    setThresholds(entries);
    setFormError('');
    setShowForm(true);
  };

  const handleTemplateSelect = (templateLabel: string) => {
    const tpl = RULE_TEMPLATES.find((t) => t.label === templateLabel);
    if (!tpl) return;
    setFormTemplate(templateLabel);
    setFormRuleType(tpl.rule_type);
    setFormDescription(tpl.description);
    if (tpl.rule_type === 'weight_tolerance') {
      setThresholds([{ key: 'tolerance_kg', value: '0.5' }]);
      setFormName('Weight Tolerance');
      setFormScope('process');
    } else if (tpl.rule_type === 'time_limit') {
      setThresholds([{ key: 'max_minutes', value: '60' }]);
      setFormName('Max Step Duration');
      setFormScope('stage');
    } else if (tpl.rule_type === 'missing_photo') {
      setThresholds([{ key: '', value: '' }]);
      setFormName('Missing Photo Check');
      setFormScope('stage');
    } else {
      setThresholds([{ key: '', value: '' }]);
      setFormName('');
    }
  };

  const addThreshold = () => {
    setThresholds((prev) => [...prev, { key: '', value: '' }]);
  };

  const updateThreshold = (index: number, field: 'key' | 'value', val: string) => {
    setThresholds((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: val } : t)),
    );
  };

  const removeThreshold = (index: number) => {
    setThresholds((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Rule name is required.');
      return;
    }
    if (!formRuleType.trim()) {
      setFormError('Rule type is required.');
      return;
    }

    const thresholdsObj: Record<string, string | number> = {};
    thresholds.forEach((t) => {
      const key = t.key.trim();
      if (!key) return;
      const numVal = Number(t.value);
      thresholdsObj[key] = t.value.trim() !== '' && !isNaN(numVal) ? numVal : t.value;
    });

    setSaving(true);
    setFormError('');

    const payload = {
      name: formName.trim(),
      rule_type: formRuleType.trim(),
      severity_model: formSeverity,
      scope: formScope,
      action: formAction,
      process_category: formCategory,
      thresholds: Object.keys(thresholdsObj).length > 0 ? thresholdsObj : null,
    };

    if (editing) {
      const { data, error } = await supabase
        .from('risk_rules')
        .update(payload)
        .eq('id', editing.id)
        .select()
        .single();
      if (!error && data) {
        setRules((prev) => prev.map((r) => (r.id === editing.id ? (data as RiskRule) : r)));
        setShowForm(false);
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: appUser?.role ?? 'admin',
          action: 'risk_rule_updated',
          details: { id: editing.id, name: formName.trim() },
        });
      } else {
        setFormError(error?.message ?? 'Failed to update rule.');
      }
    } else {
      const { data, error } = await supabase
        .from('risk_rules')
        .insert(payload)
        .select()
        .single();
      if (!error && data) {
        setRules((prev) => [data as RiskRule, ...prev]);
        setShowForm(false);
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: appUser?.role ?? 'admin',
          action: 'risk_rule_created',
          details: { id: (data as RiskRule).id, name: formName.trim(), rule_type: formRuleType.trim() },
        });
      } else {
        setFormError(error?.message ?? 'Failed to create rule.');
      }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await supabase.from('risk_rules').delete().eq('id', deleteTarget.id);
    setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    await supabase.from('customer_activity_logs').insert({
      actor_id: appUser?.id ?? '',
      actor_email: appUser?.email ?? '',
      actor_role: appUser?.role ?? 'admin',
      action: 'risk_rule_deleted',
      details: { id: deleteTarget.id, name: deleteTarget.name },
    });
    setDeleteTarget(null);
  };

  const saveCategory = async (ruleId: string, category: ProcessCategory) => {
    setSavingCategory(true);
    const { error } = await supabase
      .from('risk_rules')
      .update({ process_category: category })
      .eq('id', ruleId);
    if (!error) {
      setRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, process_category: category } : r)),
      );
    }
    setSavingCategory(false);
    setEditingCategoryFor(null);
  };

  const renderRuleCard = (r: RiskRule) => {
    const isEditingCat = editingCategoryFor === r.id;
    const builtinDesc = r.is_builtin ? BUILT_IN_DESCRIPTIONS[r.rule_type] : undefined;
    return (
      <div
        key={r.id}
        className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-all hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {r.is_builtin && (
                <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                  <Lock className="h-2.5 w-2.5" /> Built-in
                </span>
              )}
              <h3 className="truncate text-base font-semibold text-[var(--text)]">{r.name}</h3>
            </div>
            <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{r.rule_type}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => openEdit(r)}
              className="flex items-center justify-center rounded-lg border border-[var(--border)] px-2.5 py-2 text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
              title="Edit rule"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {!r.is_builtin && (
              <button
                onClick={() => setDeleteTarget(r)}
                className="flex items-center justify-center rounded-lg border border-[var(--border)] px-2.5 py-2 text-error-500 transition-colors hover:bg-error-500/10 hover:border-error-500/30"
                title="Delete rule"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_BADGES[r.severity_model]}`}
          >
            {r.severity_model === 'multi_level' ? 'Multi-level' : 'Pass / Fail'}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SCOPE_BADGES[r.scope]}`}
          >
            {r.scope === 'stage' ? 'Stage' : 'Process'}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_BADGES[(r.action ?? 'alert') as RuleAction]}`}
            title={ACTION_DESCRIPTIONS[(r.action ?? 'alert') as RuleAction]}
          >
            {ACTION_LABELS[(r.action ?? 'alert') as RuleAction]}
          </span>
          {isEditingCat ? (
            <div className="flex items-center gap-1.5">
              <select
                value={categoryDraft}
                onChange={(e) => setCategoryDraft(e.target.value as ProcessCategory)}
                disabled={savingCategory}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text)] outline-none focus:border-primary-500"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
              <button
                onClick={() => saveCategory(r.id, categoryDraft)}
                disabled={savingCategory}
                className="rounded-md bg-primary-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-700"
              >
                Save
              </button>
              <button
                onClick={() => setEditingCategoryFor(null)}
                disabled={savingCategory}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setEditingCategoryFor(r.id);
                setCategoryDraft((r.process_category ?? 'moderate') as ProcessCategory);
              }}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all hover:ring-2 hover:ring-primary-500/20 ${CATEGORY_BADGES[(r.process_category ?? 'moderate') as ProcessCategory]}`}
              title="Click to edit category"
            >
              {CATEGORY_LABELS[(r.process_category ?? 'moderate') as ProcessCategory]}
              <Settings2 className="h-2.5 w-2.5 opacity-60" />
            </button>
          )}
        </div>

        {r.thresholds && Object.keys(r.thresholds).length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium text-[var(--text-subtle)]">Thresholds</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(r.thresholds).map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center rounded-md bg-[var(--surface-hover)] px-2 py-1 font-mono text-xs text-[var(--text)]"
                >
                  {k}: <span className="ml-1 font-semibold">{String(v)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {builtinDesc && (
          <p className="mt-3 text-xs text-[var(--text-muted)]">{builtinDesc}</p>
        )}

        <div className="mt-4 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-subtle)]">
          Created {formatDate(r.created_at)}
        </div>
      </div>
    );
  };

  const renderAssignmentSection = (ruleList: RiskRule[], title: string, attachedIds: string[], onToggle: (ruleId: string) => void) => (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{title}</p>
      {ruleList.length === 0 ? (
        <p className="text-xs text-[var(--text-subtle)] py-2">No rules in this section.</p>
      ) : (
        ruleList.map((rule) => {
          const attached = attachedIds.includes(rule.id);
          return (
            <label
              key={rule.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                attached
                  ? 'border-primary-500/40 bg-primary-500/5'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <input
                type="checkbox"
                checked={attached}
                onChange={() => onToggle(rule.id)}
                disabled={savingAssignment}
                className="h-4 w-4 rounded border-[var(--border)] text-primary-600 focus:ring-2 focus:ring-primary-500/20"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {rule.is_builtin && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                      Built-in
                    </span>
                  )}
                  <p className="truncate text-sm font-medium text-[var(--text)]">{rule.name}</p>
                </div>
                <p className="truncate font-mono text-xs text-[var(--text-subtle)]">{rule.rule_type}</p>
              </div>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${CATEGORY_BADGES[(rule.process_category ?? 'moderate') as ProcessCategory]}`}>
                {CATEGORY_LABELS[(rule.process_category ?? 'moderate') as ProcessCategory]}
              </span>
              {attached && (
                <span className="flex items-center gap-1 text-xs font-medium text-primary-600">
                  <Check className="h-3.5 w-3.5" /> Assigned
                </span>
              )}
            </label>
          );
        })
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Risk Rules</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Define custom risk rules, edit alert categories, and assign them to process stages or entire processes.
          </p>
        </div>
        {activeTab === 'rules' && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            New rule
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
        <button
          onClick={() => setActiveTab('rules')}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'rules'
              ? 'bg-primary-600 text-white'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          Rules
        </button>
        <button
          onClick={() => setActiveTab('assignment')}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'assignment'
              ? 'bg-primary-600 text-white'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
          }`}
        >
          <GitBranch className="h-4 w-4" />
          Rule Assignment
        </button>
      </div>

      {activeTab === 'rules' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary-600" />
              <h2 className="text-sm font-semibold text-[var(--text)]">Built-in Risk Factors</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              These are the seven built-in risk factors. They are not automatically evaluated — assign them to
              specific stages or the entire process in the Rule Assignment tab. You can edit their alert category,
              thresholds, severity, and scope. You cannot delete them.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--text-muted)]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading risk rules...
            </div>
          ) : (
            <>
              {builtinRules.length > 0 && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {builtinRules.map(renderRuleCard)}
                </div>
              )}

              <div className="border-t border-[var(--border)] pt-4">
                <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Custom Rules</h2>
                {customRules.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
                    <AlertTriangle className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
                    <p className="mt-4 text-base font-medium text-[var(--text)]">No custom risk rules yet</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      Create a rule to add custom thresholds and alert conditions.
                    </p>
                    <button
                      onClick={openCreate}
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
                    >
                      <Plus className="h-4 w-4" />
                      Create rule
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {customRules.map(renderRuleCard)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'assignment' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary-600" />
              <h2 className="text-sm font-semibold text-[var(--text)]">Rule Assignment</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              No risk rule is automatically enforced. Assign built-in factors or custom rules to specific stages
              or to an entire process here. Only rules you attach will be evaluated when a process run completes.
            </p>
          </div>

          {assignmentLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--text-muted)]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading processes...
            </div>
          ) : processes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
              <GitBranch className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
              <p className="mt-4 text-base font-medium text-[var(--text)]">No processes defined yet</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Create a process first, then assign risk rules to its stages.
              </p>
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
              <AlertTriangle className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
              <p className="mt-4 text-base font-medium text-[var(--text)]">No risk rules to assign</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <label className="text-sm font-medium text-[var(--text)] whitespace-nowrap">
                  Select process:
                </label>
                <select
                  value={selectedProcessId ?? ''}
                  onChange={(e) => setSelectedProcessId(e.target.value)}
                  disabled={savingAssignment}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                >
                  {processes.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {selectedProcessId && (() => {
                const proc = processes.find((p) => p.id === selectedProcessId);
                if (!proc) return null;
                const wf = proc.workflow;
                const stageNodes = wf?.nodes?.filter((n) => n.type === 'stage') ?? [];
                const processScopedRules = rules.filter((r) => r.scope === 'process');
                const stageScopedRules = rules.filter((r) => r.scope === 'stage');

                return (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
                      <h3 className="text-sm font-semibold text-[var(--text)]">Process-Level Rules</h3>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        These rules are evaluated against the entire process run on completion.
                      </p>
                      <div className="mt-3">
                        {renderAssignmentSection(processScopedRules, 'Process-Scoped', wf?.risk_rule_ids ?? [], handleToggleProcessRule)}
                      </div>
                    </div>

                    {stageNodes.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--text)]">Stage-Level Rules</h3>
                        <p className="text-xs text-[var(--text-muted)]">
                          Assign stage-scoped rules to individual checkpoints within the process.
                        </p>
                        {stageNodes.map((node) => {
                          const attachedIds = node.risk_rule_ids ?? [];
                          return (
                            <div
                              key={node.id}
                              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
                            >
                              <div className="mb-3 flex items-center gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                                  <GitBranch className="h-3.5 w-3.5" />
                                </span>
                                <h4 className="text-sm font-semibold text-[var(--text)]">{node.label}</h4>
                                {attachedIds.length > 0 && (
                                  <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-xs font-medium text-primary-600">
                                    {attachedIds.length} rule{attachedIds.length > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                              {renderAssignmentSection(stageScopedRules, 'Stage-Scoped', attachedIds, (ruleId) => handleToggleStageRule(node.id, ruleId))}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {stageNodes.length === 0 && (
                      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
                        <p className="text-sm text-[var(--text-muted)]">
                          This process has no stage nodes. Add stages in the Process Builder to assign stage-level rules.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !saving && setShowForm(false)} />
          <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] p-6">
              <h3 className="text-lg font-semibold text-[var(--text)]">
                {editing ? 'Edit Risk Rule' : 'New Risk Rule'}
              </h3>
              <button
                onClick={() => !saving && setShowForm(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-5 overflow-y-auto p-6">
                {!editing && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                      What do you want to check?
                    </label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {RULE_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.label}
                          type="button"
                          onClick={() => handleTemplateSelect(tpl.label)}
                          className={`rounded-lg border p-3 text-left transition-colors ${
                            formTemplate === tpl.label
                              ? 'border-primary-500 bg-primary-500/5'
                              : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]'
                          }`}
                        >
                          <p className="text-sm font-medium text-[var(--text)]">{tpl.label}</p>
                          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{tpl.description}</p>
                        </button>
                      ))}
                    </div>
                    {formDescription && (
                      <p className="mt-2 rounded-lg bg-primary-500/5 px-3 py-2 text-xs text-primary-600">
                        {formDescription}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                    Rule name <span className="text-error-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Max stage duration"
                    required
                    autoFocus
                    disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                    Alert category
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as ProcessCategory)}
                    disabled={saving}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    When this rule triggers, the alert will be tagged with this category.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                      Severity model
                    </label>
                    <select
                      value={formSeverity}
                      onChange={(e) => setFormSeverity(e.target.value as SeverityModel)}
                      disabled={saving}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                    >
                      <option value="multi_level">Multi-level (graded)</option>
                      <option value="pass_fail">Pass / Fail (simple)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Scope</label>
                    <select
                      value={formScope}
                      onChange={(e) => setFormScope(e.target.value as RuleScope)}
                      disabled={saving}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                    >
                      <option value="stage">Single stage</option>
                      <option value="process">Entire process</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                    Action when breached
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(['block', 'warn', 'alert'] as RuleAction[]).map((act) => (
                      <button
                        key={act}
                        type="button"
                        onClick={() => setFormAction(act)}
                        disabled={saving}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          formAction === act
                            ? act === 'block'
                              ? 'border-red-500 bg-red-500/5'
                              : act === 'warn'
                                ? 'border-amber-500 bg-amber-500/5'
                                : 'border-blue-500 bg-blue-500/5'
                            : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]'
                        }`}
                      >
                        <p className="text-sm font-medium text-[var(--text)]">{ACTION_LABELS[act]}</p>
                        <p className="mt-1 text-[11px] text-[var(--text-muted)]">{ACTION_DESCRIPTIONS[act]}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-sm font-medium text-[var(--text)]">Thresholds (optional)</label>
                    <button
                      type="button"
                      onClick={addThreshold}
                      disabled={saving}
                      className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </button>
                  </div>
                  <p className="mb-3 text-xs text-[var(--text-muted)]">
                    Set limits for this rule. For example, for a time limit rule, add a threshold with key "max_minutes" and value "60".
                  </p>
                  <div className="space-y-2">
                    {thresholds.map((t, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={t.key}
                          onChange={(e) => updateThreshold(i, 'key', e.target.value)}
                          placeholder="e.g. max_minutes"
                          disabled={saving}
                          className="w-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                        />
                        <span className="text-[var(--text-subtle)]">=</span>
                        <input
                          type="text"
                          value={t.value}
                          onChange={(e) => updateThreshold(i, 'value', e.target.value)}
                          placeholder="e.g. 60"
                          disabled={saving}
                          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                        />
                        {thresholds.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeThreshold(i)}
                            disabled={saving}
                            className="text-error-500 hover:text-error-600"
                            title="Remove threshold"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {formError && (
                  <p className="rounded-lg bg-error-500/10 px-3 py-2 text-sm text-error-500">
                    {formError}
                  </p>
                )}
              </div>

              <div className="flex gap-3 border-t border-[var(--border)] p-6">
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
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : editing ? (
                    'Save changes'
                  ) : (
                    'Create rule'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-500/10">
                <Trash2 className="h-6 w-6 text-error-500" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)]">Delete rule?</h3>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                "{deleteTarget.name}" will be permanently removed.
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
