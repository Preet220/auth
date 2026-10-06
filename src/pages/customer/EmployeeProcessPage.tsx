import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Play, Check, X, ChevronRight, Loader2, Eye, ArrowRight, Flag,
  MapPin, PackagePlus, QrCode, Scale, Camera, CheckCircle,
  ShieldCheck, Truck, GitBranch, Package, Trash2, Plus,
  AlertCircle, ListChecks, Clock, BadgeCheck, FileText,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { WorkflowCanvas } from '@/components/WorkflowCanvas';
import { QrScanner } from '@/components/QrScanner';
import { PhotoCapture } from '@/components/PhotoCapture';
import { WeightReader } from '@/components/WeightReader';
import { formatDateTime } from '@/lib/qr';
import { evaluateAndGenerateAlerts } from '@/lib/alerts';
import {
  type Workflow, type WorkflowNode, type WorkflowNodeType,
  type VerificationTarget,
  NODE_META, getStartNode, getOutgoingEdges,
} from '@shared/types/workflow';

interface ProcessDefinitionLite {
  id: string;
  name: string;
  category: string;
  stages: string[];
  workflow: Workflow | null;
}

interface ProcessRunLite {
  id: string;
  process_definition_id: string;
  status: string;
  current_node_id: string;
  completed_node_ids: string[];
  started_at: string;
  batch_items: BatchItemEntry[];
  start_total_weight: number;
  end_total_weight: number | null;
  reconciliation_result: Record<string, unknown> | null;
  trolley_qr_value?: string | null;
  batch_photo_url?: string | null;
}

interface BatchItemEntry {
  tempId: string;
  qr_value: string;
  item_type: string;
  start_weight: number;
  weight_source: 'auto' | 'manual';
  end_weight: number | null;
  end_weight_source: 'auto' | 'manual' | null;
  seal_qr_value: string | null;
  verification_photo_url: string | null;
  photo_url: string | null;
}

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

const ACTION_LABELS: Record<WorkflowNodeType, string> = {
  stage: 'Checkpoint scan',
  batch_create: 'Create batch',
  qr_scan: 'Scan QR code',
  weighing: 'Record weight',
  photo: 'Take photo',
  approval: 'Await approval',
  condition: 'Check condition',
  seal_verify: 'Verify seal',
  trolley_scan: 'Scan trolley',
  verification: 'Verification',
};

type ScannerMode = 'qr' | 'photo' | 'weight' | 'seal' | null;

type ScanContext = 'node' | 'batch_item' | 'batch_seal' | 'end_verification' | 'batch_verify_qr' | 'batch_verify_weight' | 'verification_weight_photo' | 'verification_batch_scan' | 'custom_field_photo';

interface BatchVerificationEntry {
  qr_value: string;
  original_weight: number;
  verified_weight: string;
  verified_weight_source: 'auto' | 'manual';
  qr_verified: boolean;
  weight_verified: boolean;
  photo_url: string | null;
}

type BatchVerificationMap = Record<string, BatchVerificationEntry>;

interface CustomFieldLite {
  id: string;
  label: string;
  input_type: 'short_text' | 'number' | 'multiple_choice' | 'date' | 'photo' | 'signature' | 'boolean';
  options: string[] | null;
  scan_type: string;
  required: boolean;
}

const NODE_SCAN_TYPE_MAP: Record<string, string> = {
  stage: 'checkpoint',
  qr_scan: 'item',
  trolley_scan: 'trolley',
  seal_verify: 'seal',
  weighing: 'item',
  batch_create: 'item',
  verification: 'item',
};

export function EmployeeProcessPage({ riskManagementEnabled = true }: { riskManagementEnabled?: boolean }) {
  const { appUser } = useAuth();
  const [processDefs, setProcessDefs] = useState<ProcessDefinitionLite[]>([]);
  const [myRuns, setMyRuns] = useState<ProcessRunLite[]>([]);
  const [activeRun, setActiveRun] = useState<ProcessRunLite | null>(null);
  const [activeDef, setActiveDef] = useState<ProcessDefinitionLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [scannerMode, setScannerMode] = useState<ScannerMode>(null);
  const [scanContext, setScanContext] = useState<ScanContext>('node');
  const [weight, setWeight] = useState('');
  const [weightSource, setWeightSource] = useState<'auto' | 'manual'>('manual');
  const [photoUrl, setPhotoUrl] = useState('');
  const [qrValue, setQrValue] = useState('');
  const [batchItems, setBatchItems] = useState<BatchItemEntry[]>([]);
  const [conditionAnswer, setConditionAnswer] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [sealQrValue, setSealQrValue] = useState('');
  const [verificationScans, setVerificationScans] = useState<Record<string, string>>({});
  const [verificationPhoto, setVerificationPhoto] = useState('');
  const [qrValidating, setQrValidating] = useState(false);
  const [qrValidationError, setQrValidationError] = useState('');
  const [trolleyQrValue, setTrolleyQrValue] = useState('');
  const [batchPhotoUrl, setBatchPhotoUrl] = useState('');
  const [endVerificationMode, setEndVerificationMode] = useState(false);
  const [batchVerifications, setBatchVerifications] = useState<BatchVerificationMap>({});
  const [batchVerifyTargetQr, setBatchVerifyTargetQr] = useState<string | null>(null);
  const [verificationWeightPhoto, setVerificationWeightPhoto] = useState('');
  const [verificationBatchScans, setVerificationBatchScans] = useState<Record<string, boolean>>({});
  const [reconciliation, setReconciliation] = useState<{
    startTotal: number;
    endTotal: number;
    delta: number;
    matched: boolean;
  } | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldLite[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [customFieldPhotos, setCustomFieldPhotos] = useState<Record<string, string>>({});
  const [customFieldTarget, setCustomFieldTarget] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const [{ data: defData }, { data: runData }] = await Promise.all([
      supabase.from('process_definitions').select('id, name, category, stages, workflow').order('created_at', { ascending: false }),
      supabase.from('process_runs')
        .select('id, process_definition_id, status, current_node_id, completed_node_ids, started_at, batch_items, start_total_weight, end_total_weight, reconciliation_result, trolley_qr_value, batch_photo_url')
        .eq('status', 'in_progress')
        .eq('employee_id', appUser?.id ?? '')
        .order('started_at', { ascending: false }),
    ]);
    setProcessDefs((defData as ProcessDefinitionLite[]) ?? []);
    setMyRuns((runData as ProcessRunLite[]) ?? []);
    setLoading(false);
  }, [appUser]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const workflow: Workflow = useMemo(() => {
    return activeDef?.workflow ?? { nodes: [], edges: [] };
  }, [activeDef]);

  const currentNode = useMemo<WorkflowNode | null>(() => {
    if (!activeRun?.current_node_id) return getStartNode(workflow);
    return workflow.nodes.find((n) => n.id === activeRun.current_node_id) ?? null;
  }, [activeRun, workflow]);

  // Fetch custom fields relevant to the current node's scan type
  useEffect(() => {
    if (!currentNode) { setCustomFields([]); return; }
    const scanType = NODE_SCAN_TYPE_MAP[currentNode.type] ?? 'none';
    if (scanType === 'none') { setCustomFields([]); return; }
    supabase
      .from('custom_fields')
      .select('id, label, input_type, options, scan_type, required')
      .or(`scan_type.eq.${scanType},scan_type.eq.none`)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setCustomFields((data as CustomFieldLite[]) ?? []);
        setCustomFieldValues({});
        setCustomFieldPhotos({});
      });
  }, [currentNode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const completedIds = useMemo(() => activeRun?.completed_node_ids ?? [], [activeRun]);

  const progress = useMemo(() => {
    if (workflow.nodes.length === 0) return 0;
    const execNodes = workflow.nodes.filter((n) => n.type !== 'stage');
    const total = execNodes.length || workflow.nodes.length;
    return Math.round((completedIds.length / total) * 100);
  }, [workflow.nodes, completedIds.length]);

  // Auto-skip verification nodes when risk management is disabled
  useEffect(() => {
    if (currentNode && currentNode.type === 'verification' && !riskManagementEnabled && activeRun) {
      const newCompleted = [...completedIds, currentNode.id];
      const outgoing = getOutgoingEdges(workflow, currentNode.id);
      const nextNode = outgoing.length > 0
        ? workflow.nodes.find((n) => n.id === outgoing[0].target) ?? null
        : null;
      supabase.from('process_runs').update({
        completed_node_ids: newCompleted,
        current_node_id: nextNode?.id ?? '',
      }).eq('id', activeRun.id).then(() => {
        setActiveRun({ ...activeRun, completed_node_ids: newCompleted, current_node_id: nextNode?.id ?? '' });
      });
    }
  }, [currentNode, riskManagementEnabled, activeRun, completedIds, workflow]);

  const startRun = async (def: ProcessDefinitionLite) => {
    setStarting(def.id);
    const wf = def.workflow ?? { nodes: [], edges: [] };
    const startNode = getStartNode(wf);
    const { data, error } = await supabase.from('process_runs').insert({
      process_definition_id: def.id,
      employee_id: appUser?.employeeId ?? '',
      employee_name: appUser?.name ?? '',
      status: 'in_progress',
      started_at: new Date().toISOString(),
      current_node_id: startNode?.id ?? '',
      completed_node_ids: [],
      batch_items: [],
      start_total_weight: 0,
    }).select().single();
    if (!error && data) {
      setActiveRun(data as ProcessRunLite);
      setActiveDef(def);
      setBatchItems([]);
      setReconciliation(null);
      setMsg({ type: 'success', text: `Process "${def.name}" started.` });
      fetchData();
    } else {
      setMsg({ type: 'error', text: 'Failed to start process.' });
    }
    setStarting(null);
  };

  const resumeRun = async (run: ProcessRunLite) => {
    const def = processDefs.find((d) => d.id === run.process_definition_id);
    if (def) {
      setActiveRun(run);
      setActiveDef(def);
      setBatchItems(run.batch_items ?? []);
      setMsg(null);
    }
  };

  // Validate a scanned QR code against the database
  const validateQrCode = async (value: string, expectedType?: string): Promise<{ valid: boolean; error: string }> => {
    setQrValidating(true);
    setQrValidationError('');
    const { data, error } = await supabase
      .from('qr_codes')
      .select('id, value, type')
      .eq('value', value)
      .maybeSingle();
    setQrValidating(false);
    if (error) return { valid: false, error: 'Database error checking QR code.' };
    if (!data) return { valid: false, error: `QR code "${value}" not found in the system.` };
    if (expectedType && data.type !== expectedType) {
      return { valid: false, error: `Expected a ${expectedType} QR code but scanned a ${data.type} QR.` };
    }
    return { valid: true, error: '' };
  };

  // Validate a seal QR against qr_codes table (where seal QRs are generated) AND seals table
  const validateSealQr = async (value: string): Promise<{ valid: boolean; error: string }> => {
    setQrValidating(true);
    setQrValidationError('');

    // First check the qr_codes table — this is where seal QR codes are actually stored
    const { data: qrData, error: qrError } = await supabase
      .from('qr_codes')
      .select('id, value, type, details')
      .eq('value', value)
      .maybeSingle();
    setQrValidating(false);

    if (qrError) return { valid: false, error: 'Database error checking seal.' };

    if (!qrData) {
      // Also check seals table as fallback
      const { data: sealData, error: sealError } = await supabase
        .from('seals')
        .select('id, seal_serial, used_in_process')
        .or(`seal_serial.eq.${value},qr_value.eq.${value}`)
        .maybeSingle();
      if (sealError) return { valid: false, error: 'Database error checking seal.' };
      if (!sealData) return { valid: false, error: `Seal "${value}" not found in the system.` };
      if (sealData.used_in_process) return { valid: false, error: `Seal "${value}" has already been used in another process.` };
      return { valid: true, error: '' };
    }

    // Found in qr_codes — verify it's a seal type
    if (qrData.type !== 'seal') {
      return { valid: false, error: `QR code "${value}" is a ${qrData.type}, not a seal.` };
    }

    // Check if this seal has already been used in a completed process
    const sealSerial = (qrData.details as Record<string, unknown>)?.seal_serial as string | undefined;
    if (sealSerial) {
      const { data: sealRecord } = await supabase
        .from('seals')
        .select('id, used_in_process')
        .eq('seal_serial', sealSerial)
        .maybeSingle();
      if (sealRecord?.used_in_process) {
        return { valid: false, error: `Seal "${value}" has already been used in another process.` };
      }
    }

    return { valid: true, error: '' };
  };

  const completeCurrentNode = async () => {
    if (!activeRun || !currentNode) return;
    setSubmitting(true);
    setMsg(null);

    const newCompleted = [...completedIds, currentNode.id];
    const outgoing = getOutgoingEdges(workflow, currentNode.id);

    let nextNode: WorkflowNode | null = null;
    if (currentNode.type === 'condition' && conditionAnswer) {
      const yesEdge = outgoing.find((e) => e.label === 'yes' || e.label === 'Yes');
      const noEdge = outgoing.find((e) => e.label === 'no' || e.label === 'No');
      const targetEdge = conditionAnswer === 'yes' ? yesEdge : noEdge;
      nextNode = targetEdge
        ? workflow.nodes.find((n) => n.id === targetEdge.target) ?? null
        : outgoing.length > 0
          ? workflow.nodes.find((n) => n.id === outgoing[0].target) ?? null
          : null;
    } else if (outgoing.length > 0) {
      nextNode = workflow.nodes.find((n) => n.id === outgoing[0].target) ?? null;
    }

    // If no outgoing edge (sub-activity leaf), traverse back to parent stage
    // and follow its outgoing edge to the next stage/sub-activity
    if (!nextNode) {
      const incomingEdges = workflow.edges.filter((e) => e.target === currentNode.id);
      for (const inEdge of incomingEdges) {
        const parent = workflow.nodes.find((n) => n.id === inEdge.source);
        if (parent && parent.type === 'stage') {
          const stageOutgoing = getOutgoingEdges(workflow, parent.id);
          // Find the next sibling after currentNode, or the stage's own next stage
          const siblings = stageOutgoing
            .map((e) => workflow.nodes.find((n) => n.id === e.target))
            .filter((n): n is WorkflowNode => !!n);
          const currentIdx = siblings.findIndex((n) => n.id === currentNode.id);
          if (currentIdx >= 0 && currentIdx < siblings.length - 1) {
            nextNode = siblings[currentIdx + 1];
          } else {
            // All sub-activities of this stage done — go to next stage
            const stageEdges = getOutgoingEdges(workflow, parent.id);
            const stageNext = stageEdges.find((e) => e.target !== currentNode.id);
            if (stageNext) {
              nextNode = workflow.nodes.find((n) => n.id === stageNext.target) ?? null;
            }
          }
          break;
        }
      }
    }

    // If still no next node, try following the parent stage's edge to the next stage
    if (!nextNode && currentNode.type !== 'stage') {
      const incomingEdges = workflow.edges.filter((e) => e.target === currentNode.id);
      for (const inEdge of incomingEdges) {
        const parent = workflow.nodes.find((n) => n.id === inEdge.source);
        if (parent) {
 const parentOutgoing = getOutgoingEdges(workflow, parent.id);
          for (const outEdge of parentOutgoing) {
            if (outEdge.target !== currentNode.id && !completedIds.includes(outEdge.target)) {
              nextNode = workflow.nodes.find((n) => n.id === outEdge.target) ?? null;
              if (nextNode) break;
            }
          }
          if (nextNode) break;
        }
      }
    }

    const isLast = !nextNode;
    const updates: Record<string, unknown> = {
      completed_node_ids: newCompleted,
      current_node_id: nextNode?.id ?? '',
    };

    if (currentNode.type === 'batch_create') {
      updates.batch_items = batchItems;
      updates.start_total_weight = batchItems.reduce((s, b) => s + (b.start_weight || 0), 0);
      if (trolleyQrValue) updates.trolley_qr_value = trolleyQrValue;
      if (batchPhotoUrl) updates.batch_photo_url = batchPhotoUrl;
    }

    // Persist trolley QR when trolley_scan node is completed
    if (currentNode.type === 'trolley_scan' && qrValue) {
      updates.trolley_qr_value = qrValue;
    }

    if (currentNode.type === 'weighing' && weight) {
      await supabase.from('scan_records').insert({
        scan_type: 'item',
        qr_value: qrValue || 'weighing',
        employee_id: appUser?.employeeId ?? '',
        employee_name: appUser?.name ?? '',
        employee_email: appUser?.email ?? '',
        employee_user_id: appUser?.id ?? '',
        weight: parseFloat(weight),
        weight_source: weightSource,
        process_run_id: activeRun.id,
        photo_url: photoUrl || '',
        custom_field_values: { ...customFieldValues, ...customFieldPhotos },
      });
    }

    // Insert scan records for QR-based nodes (stage, qr_scan, trolley_scan, seal_verify)
    if (currentNode.type === 'stage' && qrValue) {
      await supabase.from('scan_records').insert({
        scan_type: 'checkpoint',
        qr_value: qrValue,
        employee_id: appUser?.employeeId ?? '',
        employee_name: appUser?.name ?? '',
        employee_email: appUser?.email ?? '',
        employee_user_id: appUser?.id ?? '',
        checkpoint_name: currentNode.label,
        process_run_id: activeRun.id,
        custom_field_values: { ...customFieldValues, ...customFieldPhotos },
      });
    }

    if (currentNode.type === 'qr_scan' && qrValue) {
      const qrType = (currentNode.config.qr_type as string) ?? 'item';
      await supabase.from('scan_records').insert({
        scan_type: qrType === 'checkpoint' ? 'checkpoint' : qrType === 'trolley' ? 'trolley' : qrType === 'seal' ? 'seal' : 'item',
        qr_value: qrValue,
        employee_id: appUser?.employeeId ?? '',
        employee_name: appUser?.name ?? '',
        employee_email: appUser?.email ?? '',
        employee_user_id: appUser?.id ?? '',
        item_type: qrType === 'item' ? currentNode.label : '',
        trolley_id: qrType === 'trolley' ? trolleyQrValue : '',
        seal_serial: qrType === 'seal' ? qrValue : '',
        process_run_id: activeRun.id,
        custom_field_values: { ...customFieldValues, ...customFieldPhotos },
      });
    }

    if (currentNode.type === 'trolley_scan' && qrValue) {
      await supabase.from('scan_records').insert({
        scan_type: 'trolley',
        qr_value: qrValue,
        employee_id: appUser?.employeeId ?? '',
        employee_name: appUser?.name ?? '',
        employee_email: appUser?.email ?? '',
        employee_user_id: appUser?.id ?? '',
        trolley_id: qrValue,
        process_run_id: activeRun.id,
        custom_field_values: { ...customFieldValues, ...customFieldPhotos },
      });
    }

    if (currentNode.type === 'seal_verify' && qrValue) {
      await supabase.from('scan_records').insert({
        scan_type: 'seal',
        qr_value: qrValue,
        employee_id: appUser?.employeeId ?? '',
        employee_name: appUser?.name ?? '',
        employee_email: appUser?.email ?? '',
        employee_user_id: appUser?.id ?? '',
        seal_serial: qrValue,
        process_run_id: activeRun.id,
        custom_field_values: { ...customFieldValues, ...customFieldPhotos },
      });
    }

    // Insert scan records for verification node based on selected targets
    if (currentNode.type === 'verification') {
      const targets = (currentNode.config.verification_targets as VerificationTarget[]) ?? [];
      for (const target of targets) {
        if (target === 'weight' && weight) {
          await supabase.from('scan_records').insert({
            scan_type: 'item',
            qr_value: qrValue || 'verification_weight',
            employee_id: appUser?.employeeId ?? '',
            employee_name: appUser?.name ?? '',
            employee_email: appUser?.email ?? '',
            employee_user_id: appUser?.id ?? '',
            weight: parseFloat(weight),
            weight_source: weightSource,
            checkpoint_name: currentNode.label,
            process_run_id: activeRun.id,
            photo_url: photoUrl || '',
          });
        }
        if (target === 'seal' && sealQrValue) {
          await supabase.from('scan_records').insert({
            scan_type: 'seal',
            qr_value: sealQrValue,
            employee_id: appUser?.employeeId ?? '',
            employee_name: appUser?.name ?? '',
            employee_email: appUser?.email ?? '',
            employee_user_id: appUser?.id ?? '',
            seal_serial: sealQrValue,
            checkpoint_name: currentNode.label,
            process_run_id: activeRun.id,
          });
        }
        if (target === 'item' && qrValue) {
          await supabase.from('scan_records').insert({
            scan_type: 'item',
            qr_value: qrValue,
            employee_id: appUser?.employeeId ?? '',
            employee_name: appUser?.name ?? '',
            employee_email: appUser?.email ?? '',
            employee_user_id: appUser?.id ?? '',
            item_type: currentNode.label,
            checkpoint_name: currentNode.label,
            process_run_id: activeRun.id,
          });
        }
        if (target === 'trolley' && trolleyQrValue) {
          await supabase.from('scan_records').insert({
            scan_type: 'trolley',
            qr_value: trolleyQrValue,
            employee_id: appUser?.employeeId ?? '',
            employee_name: appUser?.name ?? '',
            employee_email: appUser?.email ?? '',
            employee_user_id: appUser?.id ?? '',
            trolley_id: trolleyQrValue,
            checkpoint_name: currentNode.label,
            process_run_id: activeRun.id,
          });
        }
        if (target === 'batch' && batchItems.length > 0) {
          for (const item of batchItems) {
            await supabase.from('scan_records').insert({
              scan_type: 'item',
              qr_value: item.qr_value,
              employee_id: appUser?.employeeId ?? '',
              employee_name: appUser?.name ?? '',
              employee_user_id: appUser?.id ?? '',
              weight: item.start_weight,
              weight_source: item.weight_source,
              seal_serial: item.seal_qr_value ?? '',
              checkpoint_name: currentNode.label,
              process_run_id: activeRun.id,
            });
          }
        }
      }
    }

    // Insert scan records for each batch item when batch_create node is completed
    if (currentNode.type === 'batch_create') {
      for (const item of batchItems) {
        await supabase.from('scan_records').insert({
          scan_type: 'item',
          qr_value: item.qr_value,
          employee_id: appUser?.employeeId ?? '',
          employee_name: appUser?.name ?? '',
          employee_email: appUser?.email ?? '',
          employee_user_id: appUser?.id ?? '',
          weight: item.start_weight,
          weight_source: item.weight_source,
          seal_serial: item.seal_qr_value ?? '',
          photo_url: item.photo_url ?? '',
          checkpoint_name: currentNode.label,
          process_run_id: activeRun.id,
        });
      }
    }

    if (isLast) {
      // If batch items exist and batch verification hasn't started, trigger it
      if (batchItems.length > 0 && !endVerificationMode) {
        setEndVerificationMode(true);
        initBatchVerifications();
        setMsg({ type: 'success', text: 'Please verify all batch items by re-scanning QR and re-weighing each item before completing.' });
        setSubmitting(false);
        return;
      }

      // If in verification mode, check all items are verified (QR + weight)
      if (endVerificationMode) {
        if (!allBatchItemsVerified) {
          setMsg({ type: 'error', text: 'All batch items must have their QR re-scanned and weight re-verified before completing.' });
          setSubmitting(false);
          return;
        }
        // Also verify seals if any items have seals
        const itemsWithSeals = batchItems.filter((b) => b.seal_qr_value);
        const allSealsVerified = itemsWithSeals.every((item) => verificationScans[item.seal_qr_value!] === item.seal_qr_value);
        if (itemsWithSeals.length > 0 && !allSealsVerified) {
          setMsg({ type: 'error', text: 'All seals must be re-scanned to verify they are intact before completing.' });
          setSubmitting(false);
          return;
        }
      }

      updates.status = 'completed';
      updates.completed_at = new Date().toISOString();

      // Compute reconciliation using verified weights if available
      if (batchItems.length > 0) {
        const endTotal = batchItems.reduce((s, b) => {
          const verified = batchVerifications[b.qr_value];
          return s + (verified?.weight_verified && verified.verified_weight ? parseFloat(verified.verified_weight) : b.start_weight || 0);
        }, 0);
        const startTotal = batchItems.reduce((s, b) => s + (b.start_weight || 0), 0);
        const delta = endTotal - startTotal;
        const matched = Math.abs(delta) < 0.01;

        updates.end_total_weight = endTotal;
        updates.reconciliation_result = { start_total: startTotal, end_total: endTotal, delta, matched };

        // Only show reconciliation to employee if risk toggle is enabled
        if (riskManagementEnabled) {
          setReconciliation({ startTotal, endTotal, delta, matched });
        }
      }

      // Mark all seals as used — look up seal_serial from qr_codes details, then update seals table
      const sealQrValues = batchItems
        .map((b) => b.seal_qr_value)
        .filter(Boolean) as string[];
      if (sealQrValues.length > 0) {
        for (const val of sealQrValues) {
          // Look up the seal serial from qr_codes
          const { data: qrData } = await supabase
            .from('qr_codes')
            .select('details')
            .eq('value', val)
            .maybeSingle();
          const sealSerial = (qrData?.details as Record<string, unknown>)?.seal_serial as string | undefined;
          if (sealSerial) {
            await supabase
              .from('seals')
              .update({ used_in_process: true, process_run_id: activeRun.id, qr_value: val })
              .eq('seal_serial', sealSerial);
          } else {
            // Fallback: try matching by qr_value or seal_serial directly
            await supabase
              .from('seals')
              .update({ used_in_process: true, process_run_id: activeRun.id, qr_value: val })
              .or(`seal_serial.eq.${val},qr_value.eq.${val}`);
          }
        }
      }
    }

    const { error } = await supabase.from('process_runs').update(updates).eq('id', activeRun.id);
    if (!error) {
      await supabase.from('customer_activity_logs').insert({
        actor_id: appUser?.id ?? '',
        actor_email: appUser?.email ?? '',
        actor_role: 'employee',
        action: isLast ? 'process_completed' : 'node_completed',
        details: { process_run_id: activeRun.id, node_type: currentNode.type, node_label: currentNode.label },
      });

      if (isLast) {
        // Evaluate risk breaches and generate alerts
        const completedRun = {
          id: activeRun.id,
          process_definition_id: activeRun.process_definition_id,
          employee_id: appUser?.employeeId ?? '',
          status: 'completed',
          started_at: activeRun.started_at,
          completed_at: updates.completed_at as string,
          reconciliation_result: (updates.reconciliation_result as Record<string, unknown>) ?? null,
          batch_items: (updates.batch_items as ProcessRunLite['batch_items']) ?? activeRun.batch_items,
        };
        const def = { id: activeDef!.id, name: activeDef!.name, category: activeDef!.category, workflow: activeDef!.workflow };
        let alertResult: { individualCount: number; collectiveCount: number; highestAction: 'block' | 'alert' | 'warn' | 'none' } | null = null;
        try {
          alertResult = await evaluateAndGenerateAlerts(completedRun, def, appUser?.id ?? '');
        } catch (e) {
          console.error('Alert generation failed:', e);
        }

        if (alertResult && alertResult.highestAction === 'block') {
          setMsg({
            type: 'error',
            text: `Process blocked: ${alertResult.individualCount} risk rule breach(es) detected. An administrator has been alerted. The process cannot be completed until the issue is reviewed.`,
          });
        } else if (alertResult && alertResult.highestAction === 'warn') {
          setMsg({
            type: 'success',
            text: `Process completed with warnings: ${alertResult.individualCount} risk rule breach(es) detected. An administrator has been alerted.`,
          });
        } else if (alertResult && alertResult.individualCount > 0) {
          setMsg({
            type: 'success',
            text: `Process completed. ${alertResult.individualCount} risk alert(s) generated for administrator review.`,
          });
        } else {
          setMsg({ type: 'success', text: 'Process completed successfully!' });
        }
        setActiveRun(null);
        setActiveDef(null);
        setBatchItems([]);
        setConditionAnswer(null);
        setWeight('');
        setQrValue('');
        setPhotoUrl('');
        setSealQrValue('');
        setTrolleyQrValue('');
        setBatchPhotoUrl('');
        setVerificationScans({});
        setVerificationPhoto('');
        setEndVerificationMode(false);
        setBatchVerifications({});
        setBatchVerifyTargetQr(null);
        fetchData();
      } else {
        setActiveRun({ ...activeRun, completed_node_ids: newCompleted, current_node_id: nextNode!.id });
        setMsg({ type: 'success', text: `${ACTION_LABELS[currentNode.type]} complete.` });
        setWeight('');
        setWeightSource('manual');
        setQrValue('');
        setPhotoUrl('');
        setSealQrValue('');
        setTrolleyQrValue('');
        setBatchPhotoUrl('');
        setConditionAnswer(null);
        setCustomFieldValues({});
        setCustomFieldPhotos({});
      }
    } else {
      setMsg({ type: 'error', text: 'Failed to advance to next step.' });
    }
    setSubmitting(false);
  };

  const handleQrScan = async (value: string) => {
    setScannerMode(null);
    if (scanContext === 'batch_seal') {
      const result = await validateSealQr(value);
      if (!result.valid) {
        setQrValidationError(result.error);
        return;
      }
      setSealQrValue(value);
      return;
    }
    if (scanContext === 'end_verification') {
      const matchingItem = batchItems.find((b) => b.seal_qr_value === value);
      if (!matchingItem) {
        setQrValidationError(`Seal "${value}" does not match any seal in this batch.`);
        return;
      }
      setVerificationScans((prev) => ({ ...prev, [value]: value }));
      setQrValidationError('');
      return;
    }
    if (scanContext === 'batch_verify_qr') {
      const matchingItem = batchItems.find((b) => b.qr_value === value);
      if (!matchingItem) {
        setQrValidationError(`Item "${value}" does not match any item in this batch.`);
        return;
      }
      setBatchVerifications((prev) => ({
        ...prev,
        [value]: { ...prev[value], qr_verified: true },
      }));
      setQrValidationError('');
      setBatchVerifyTargetQr(null);
      return;
    }
    if (scanContext === 'verification_batch_scan') {
      const matchingItem = batchItems.find((b) => b.qr_value === value);
      if (!matchingItem) {
        setQrValidationError(`Item "${value}" does not match any item in this batch.`);
        return;
      }
      setVerificationBatchScans((prev) => ({ ...prev, [value]: true }));
      setQrValidationError('');
      return;
    }
    if (scanContext === 'batch_item') {
      const result = await validateQrCode(value, 'item');
      if (!result.valid) {
        setQrValidationError(result.error);
        return;
      }
      setQrValue(value);
      return;
    }
    // Node-level QR scan with validation
    const expectedType = currentNode?.type === 'seal_verify' ? 'seal'
      : currentNode?.type === 'trolley_scan' ? 'trolley'
      : currentNode?.type === 'stage' ? 'checkpoint'
      : currentNode?.type === 'verification' ? 'trolley'
      : (currentNode?.config.qr_type as string) ?? 'item';
    const result = await validateQrCode(value, expectedType);
    if (!result.valid) {
      setQrValidationError(result.error);
      return;
    }
    // If pre-assigned QR, check it matches
    if (currentNode?.qr_value && currentNode.qr_value !== value) {
      setQrValidationError(`Expected QR "${currentNode.qr_value}" but scanned "${value}".`);
      return;
    }
    setQrValue(value);
    // Save trolley QR value separately for persistence
    if (currentNode?.type === 'trolley_scan') {
      setTrolleyQrValue(value);
    }
    // For verification node, set trolley value when scanning trolley
    if (currentNode?.type === 'verification' && expectedType === 'trolley') {
      setTrolleyQrValue(value);
      setQrValue('');
    }
  };

  const handlePhotoCapture = (dataUrl: string) => {
    if (scanContext === 'end_verification') {
      setVerificationPhoto(dataUrl);
    } else if (scanContext === 'batch_verify_weight' && batchVerifyTargetQr) {
      setBatchVerifications((prev) => ({
        ...prev,
        [batchVerifyTargetQr]: {
          ...prev[batchVerifyTargetQr],
          photo_url: dataUrl,
        },
      }));
    } else if (scanContext === 'verification_weight_photo') {
      setVerificationWeightPhoto(dataUrl);
    } else if (scanContext === 'custom_field_photo' && customFieldTarget) {
      setCustomFieldPhotos((prev) => ({ ...prev, [customFieldTarget]: dataUrl }));
      setCustomFieldTarget(null);
    } else if (currentNode?.type === 'batch_create') {
    } else {
      setPhotoUrl(dataUrl);
    }
    setScannerMode(null);
  };

  const handleWeightRead = (w: number, source: 'auto' | 'manual') => {
    if (scanContext === 'batch_verify_weight' && batchVerifyTargetQr) {
      setBatchVerifications((prev) => ({
        ...prev,
        [batchVerifyTargetQr]: {
          ...prev[batchVerifyTargetQr],
          verified_weight: w.toFixed(2),
          verified_weight_source: source,
          weight_verified: true,
        },
      }));
      setBatchVerifyTargetQr(null);
    } else {
      setWeight(w.toFixed(2));
      setWeightSource(source);
    }
    setScannerMode(null);
  };

  const initBatchVerifications = () => {
    const map: BatchVerificationMap = {};
    for (const item of batchItems) {
      map[item.qr_value] = {
        qr_value: item.qr_value,
        original_weight: item.start_weight,
        verified_weight: '',
        verified_weight_source: 'manual',
        qr_verified: false,
        weight_verified: false,
        photo_url: null,
      };
    }
    setBatchVerifications(map);
  };

  const batchVerifyTotalWeight = Object.values(batchVerifications)
    .filter((v) => v.weight_verified && v.verified_weight)
    .reduce((s, v) => s + parseFloat(v.verified_weight), 0);

  const batchVerifyOriginalTotal = batchItems.reduce((s, b) => s + b.start_weight, 0);

  const allBatchItemsVerified = batchItems.length > 0 && batchItems.every((item) => {
    const v = batchVerifications[item.qr_value];
    return v && v.qr_verified && v.weight_verified;
  });

  const addBatchItem = () => {
    if (!qrValue || !weight || !sealQrValue) return;
    const entry: BatchItemEntry = {
      tempId: crypto.randomUUID(),
      qr_value: qrValue,
      item_type: '',
      start_weight: parseFloat(weight),
      weight_source: weightSource,
      end_weight: null,
      end_weight_source: null,
      seal_qr_value: sealQrValue || null,
      verification_photo_url: null,
      photo_url: photoUrl || null,
    };
    setBatchItems((prev) => [...prev, entry]);
    setQrValue('');
    setWeight('');
    setWeightSource('manual');
    setSealQrValue('');
  };

  const removeBatchItem = (tempId: string) => {
    setBatchItems((prev) => prev.filter((b) => b.tempId !== tempId));
  };

  const batchTotalWeight = batchItems.reduce((s, b) => s + (b.start_weight || 0), 0);

  const canCompleteVerification = (): boolean => {
    if (!currentNode) return false;
    const targets = (currentNode.config.verification_targets as VerificationTarget[]) ?? [];
    if (targets.length === 0) return true;
    for (const t of targets) {
      if (t === 'weight' && (!weight || !verificationWeightPhoto)) return false;
      if (t === 'seal' && !sealQrValue) return false;
      if (t === 'item' && !qrValue) return false;
      if (t === 'trolley' && !trolleyQrValue) return false;
      if (t === 'batch') {
        if (batchItems.length === 0) return false;
        const allScanned = batchItems.every((item) => verificationBatchScans[item.qr_value]);
        if (!allScanned) return false;
      }
    }
    return true;
  };

  const canCompleteNode = (): boolean => {
    if (!currentNode) return false;
    if (endVerificationMode) {
      if (!allBatchItemsVerified) return false;
      const itemsWithSeals = batchItems.filter((b) => b.seal_qr_value);
      if (itemsWithSeals.length > 0) {
        return itemsWithSeals.every((item) => verificationScans[item.seal_qr_value!] === item.seal_qr_value);
      }
      return true;
    }
    const nodeTypesWithFields = ['qr_scan', 'trolley_scan', 'seal_verify', 'stage', 'weighing', 'batch_create', 'photo'];
    if (nodeTypesWithFields.includes(currentNode.type)) {
      const requiredMissing = customFields.some((f) => {
        if (!f.required) return false;
        if (f.input_type === 'photo') return !customFieldPhotos[f.id];
        if (f.input_type === 'boolean') return customFieldValues[f.id] === undefined || customFieldValues[f.id] === '';
        return !customFieldValues[f.id]?.trim();
      });
      if (requiredMissing) return false;
    }
    switch (currentNode.type) {
      case 'qr_scan':
      case 'trolley_scan':
      case 'stage':
        return !!qrValue;
      case 'seal_verify':
        return !!qrValue;
      case 'verification':
        return canCompleteVerification();
      case 'weighing':
        return !!weight;
      case 'photo':
        return !!photoUrl;
      case 'batch_create':
        return batchItems.length > 0;
      case 'approval':
        return true;
      case 'condition':
        return !!conditionAnswer;
      default:
        return true;
    }
  };

  const nodeStatus = useCallback((nodeId: string): 'completed' | 'current' | 'pending' | 'none' => {
    if (completedIds.includes(nodeId)) return 'completed';
    if (currentNode?.id === nodeId) return 'current';
    return 'pending';
  }, [completedIds, currentNode]);

  const renderNodeContent = (node: WorkflowNode) => {
    const Icon = NODE_ICONS[node.type];
    const meta = NODE_META[node.type];
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-0.5">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
          <span className="text-xs font-semibold text-[var(--text)] truncate max-w-[120px]">{node.label}</span>
        </div>
        <span className="text-[9px] text-[var(--text-muted)] capitalize">{node.type.replace(/_/g, ' ')}</span>
      </div>
    );
  };

  const findNextNode = useCallback((node: WorkflowNode, visited: Set<string>): WorkflowNode | null => {
    if (visited.has(node.id)) return null;
    visited.add(node.id);

    const outgoing = getOutgoingEdges(workflow, node.id);
    if (outgoing.length > 0) {
      return workflow.nodes.find((n) => n.id === outgoing[0].target) ?? null;
    }

    // Sub-activity leaf: go back to parent stage and find next sibling or next stage
    const incoming = workflow.edges.filter((e) => e.target === node.id);
    for (const inEdge of incoming) {
      const parent = workflow.nodes.find((n) => n.id === inEdge.source);
      if (parent) {
        const siblings = getOutgoingEdges(workflow, parent.id)
          .map((e) => workflow.nodes.find((n) => n.id === e.target))
          .filter((n): n is WorkflowNode => !!n);
        const idx = siblings.findIndex((n) => n.id === node.id);
        if (idx >= 0 && idx < siblings.length - 1) {
          return siblings[idx + 1];
        }
        // All siblings done — follow parent's outgoing to next stage
        return findNextNode(parent, visited);
      }
    }
    return null;
  }, [workflow]);

  const remainingNodes = useMemo(() => {
    if (!currentNode) return [];
    const result: WorkflowNode[] = [];
    let node: WorkflowNode | null = currentNode;
    const visited = new Set<string>();
    while (node && !visited.has(node.id)) {
      result.push(node);
      node = findNextNode(node, visited);
    }
    return result;
  }, [currentNode, findNextNode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">My Processes</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Start a guided process or resume an ongoing one.
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${msg.type === 'success' ? 'bg-accent-500/10 text-accent-600' : 'bg-error-500/10 text-error-500'}`}>
          {msg.text}
        </div>
      )}

      {/* Reconciliation result — only shown if risk toggle is enabled */}
      {reconciliation && (
        <div className={`rounded-xl border p-5 ${reconciliation.matched ? 'border-accent-500/30 bg-accent-500/5' : 'border-error-500/30 bg-error-500/5'}`}>
          <div className="flex items-center gap-2">
            {reconciliation.matched
              ? <Check className="h-5 w-5 text-accent-600" />
              : <AlertCircle className="h-5 w-5 text-error-500" />}
            <p className="text-sm font-semibold text-[var(--text)]">
              {reconciliation.matched ? 'Weights Matched' : `Discrepancy: ${reconciliation.delta.toFixed(2)} kg`}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg bg-[var(--surface-hover)] p-3">
              <p className="text-xs text-[var(--text-subtle)]">Start Total</p>
              <p className="mt-1 font-semibold text-[var(--text)]">{reconciliation.startTotal.toFixed(2)} kg</p>
            </div>
            <div className="rounded-lg bg-[var(--surface-hover)] p-3">
              <p className="text-xs text-[var(--text-subtle)]">End Total</p>
              <p className="mt-1 font-semibold text-primary-600">{reconciliation.endTotal.toFixed(2)} kg</p>
            </div>
            <div className="rounded-lg bg-[var(--surface-hover)] p-3">
              <p className="text-xs text-[var(--text-subtle)]">Delta</p>
              <p className={`mt-1 font-semibold ${reconciliation.matched ? 'text-accent-600' : 'text-error-500'}`}>
                {reconciliation.delta > 0 ? '+' : ''}{reconciliation.delta.toFixed(2)} kg
              </p>
            </div>
          </div>
        </div>
      )}

      {/* No active run — show available processes + ongoing runs */}
      {!activeRun && (
        <>
          {/* My ongoing runs */}
          {myRuns.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                <Clock className="h-4 w-4 text-primary-600" /> Ongoing Runs
              </h2>
              <div className="space-y-2">
                {myRuns.map((run) => {
                  const def = processDefs.find((d) => d.id === run.process_definition_id);
                  return (
                    <div key={run.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-[var(--text)]">{def?.name ?? 'Unknown process'}</p>
                        <p className="text-xs text-[var(--text-muted)]">Started {formatDateTime(run.started_at)}</p>
                      </div>
                      <button
                        onClick={() => resumeRun(run)}
                        className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700"
                      >
                        <Play className="h-3.5 w-3.5" /> Resume
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Start a process */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="mb-1 text-sm font-semibold text-[var(--text)]">Start a Process</h2>
            <p className="mb-3 text-xs text-[var(--text-muted)]">Select a process to begin the guided workflow.</p>
            {processDefs.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-subtle)]">No processes available. Ask your admin to create one.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {processDefs.map((def) => {
                  const wf = def.workflow ?? { nodes: [], edges: [] };
                  return (
                    <button
                      key={def.id}
                      onClick={() => startRun(def)}
                      disabled={starting === def.id}
                      className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                    >
                      {starting === def.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 text-primary-600" />}
                      {def.name}
                      <span className="text-xs text-[var(--text-subtle)]">({wf.nodes?.length ?? 0} steps)</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Active run — guided workflow */}
      {activeRun && activeDef && currentNode && (
        <>
          {/* Progress header */}
          <div className="rounded-xl border border-primary-500/30 bg-primary-500/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{activeDef.name}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Step {completedIds.length + 1} of {workflow.nodes.filter((n) => n.type !== 'stage').length || workflow.nodes.length}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowWorkflow((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                >
                  <Eye className="h-3.5 w-3.5" /> {showWorkflow ? 'Hide' : 'Workflow'}
                </button>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div className="h-full rounded-full bg-primary-600 transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1.5 text-right text-xs text-[var(--text-muted)]">{progress}% complete</p>
          </div>

          {/* Workflow visualization */}
          {showWorkflow && (
            <WorkflowCanvas
              workflow={workflow}
              onChange={() => {}}
              renderNodeContent={renderNodeContent}
              nodeStatus={nodeStatus}
              readOnly
              className="h-64"
            />
          )}

          {/* Current action card */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ backgroundColor: NODE_META[currentNode.type].color + '20' }}
              >
                {(() => {
                  const Icon = NODE_ICONS[currentNode.type];
                  return <Icon className="h-6 w-6" style={{ color: NODE_META[currentNode.type].color }} />;
                })()}
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Current Action</p>
                <p className="text-lg font-semibold text-[var(--text)]">{currentNode.label}</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {/* QR scan nodes */}
              {(currentNode.type === 'qr_scan' || currentNode.type === 'trolley_scan' || currentNode.type === 'seal_verify' || currentNode.type === 'stage') && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                    {currentNode.type === 'seal_verify' ? 'Seal QR' : currentNode.type === 'trolley_scan' ? 'Trolley QR' : currentNode.type === 'stage' ? 'Checkpoint QR' : 'QR Code'}
                  </label>
                  {qrValue ? (
                    <div className="flex items-center justify-between rounded-lg border border-accent-500/30 bg-accent-500/5 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-accent-600" />
                        <span className="font-mono text-sm text-[var(--text)]">{qrValue}</span>
                      </div>
                      <button onClick={() => { setQrValue(''); setQrValidationError(''); }} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setScanContext('node'); setScannerMode('qr'); setQrValidationError(''); }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-6 text-sm font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                    >
                      <QrCode className="h-5 w-5" /> Open camera scanner
                    </button>
                  )}
                  {qrValidating && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-primary-600">
                      <Loader2 className="h-3 w-3 animate-spin" /> Validating QR...
                    </p>
                  )}
                  {qrValidationError && (
                    <p className="mt-1.5 rounded-lg bg-error-500/10 px-3 py-2 text-xs text-error-500">
                      {qrValidationError}
                    </p>
                  )}
                  {currentNode.qr_value && (
                    <p className="mt-1.5 text-xs text-[var(--text-subtle)]">Expected: {currentNode.qr_value}</p>
                  )}
                </div>
              )}

              {/* Show trolley QR info if already scanned */}
              {currentNode.type !== 'trolley_scan' && trolleyQrValue && (
                <div className="flex items-center gap-2 rounded-lg border border-primary-500/20 bg-primary-500/5 px-3 py-2">
                  <Truck className="h-4 w-4 text-primary-600" />
                  <span className="text-xs text-[var(--text-muted)]">Trolley:</span>
                  <span className="font-mono text-xs text-[var(--text)]">{trolleyQrValue}</span>
                </div>
              )}

              {/* Weighing node */}
              {currentNode.type === 'weighing' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Weight (kg)</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Scale className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" />
                      <input
                        type="number"
                        step="0.01"
                        value={weight}
                        onChange={(e) => { setWeight(e.target.value); setWeightSource('manual'); }}
                        placeholder="Enter weight"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                      />
                    </div>
                    <button
                      onClick={() => { setScanContext('node'); setScannerMode('weight'); }}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                    >
                      <Scale className="h-4 w-4" /> Auto-read
                    </button>
                  </div>
                  {weightSource === 'auto' && weight && (
                    <p className="mt-1.5 text-xs text-accent-600">Auto-read from scale.</p>
                  )}
                  {weightSource === 'manual' && weight && (
                    <p className="mt-1.5 text-xs text-warning-500">Manual entry — will be highlighted in records.</p>
                  )}
                </div>
              )}

              {/* Batch create node */}
              {currentNode.type === 'batch_create' && (
                <div className="space-y-4">
                  <p className="text-sm text-[var(--text-muted)]">Scan each item, weigh it, then add to the batch.</p>

                  {/* Scan item */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Item QR</label>
                    {qrValue ? (
                      <div className="flex items-center justify-between rounded-lg border border-accent-500/30 bg-accent-500/5 px-3 py-2">
                        <span className="font-mono text-xs text-[var(--text)]">{qrValue}</span>
                        <button onClick={() => { setQrValue(''); setQrValidationError(''); }} className="text-[var(--text-muted)]"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setScanContext('batch_item'); setScannerMode('qr'); setQrValidationError(''); }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-4 text-xs font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                      >
                        <QrCode className="h-4 w-4" /> Scan item
                      </button>
                    )}
                    {qrValidationError && scanContext === 'batch_item' && (
                      <p className="mt-1 rounded-lg bg-error-500/10 px-2 py-1.5 text-xs text-error-500">{qrValidationError}</p>
                    )}
                  </div>

                  {/* Weight */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Weight (kg)</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        value={weight}
                        onChange={(e) => { setWeight(e.target.value); setWeightSource('manual'); }}
                        placeholder="Enter weight"
                        className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                      />
                      <button
                        onClick={() => { setScanContext('node'); setScannerMode('weight'); }}
                        className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-hover)]"
                      >
                        <Scale className="h-3.5 w-3.5" /> Auto
                      </button>
                    </div>
                  </div>

                  {/* Seal QR for bag */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Seal QR</label>
                    {sealQrValue ? (
                      <div className="flex items-center justify-between rounded-lg border border-accent-500/30 bg-accent-500/5 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-3.5 w-3.5 text-accent-600" />
                          <span className="font-mono text-xs text-[var(--text)]">{sealQrValue}</span>
                        </div>
                        <button onClick={() => { setSealQrValue(''); setQrValidationError(''); }} className="text-[var(--text-muted)]"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setScanContext('batch_seal'); setScannerMode('seal'); setQrValidationError(''); }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-4 text-xs font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                      >
                        <ShieldCheck className="h-4 w-4" /> Scan seal
                      </button>
                    )}
                    {qrValidationError && scanContext === 'batch_seal' && (
                      <p className="mt-1 rounded-lg bg-error-500/10 px-2 py-1.5 text-xs text-error-500">{qrValidationError}</p>
                    )}
                  </div>

                  {/* Batch photo */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Batch Photo (optional)</label>
                    {batchPhotoUrl ? (
                      <div className="relative">
                        <img src={batchPhotoUrl} alt="Batch" className="w-full rounded-lg border border-[var(--border)]" style={{ maxHeight: '200px', objectFit: 'contain' }} />
                        <button onClick={() => setBatchPhotoUrl('')} className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setScanContext('node'); setScannerMode('photo'); }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-4 text-xs font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                      >
                        <Camera className="h-4 w-4" /> Capture batch photo
                      </button>
                    )}
                  </div>

                  <button
                    onClick={addBatchItem}
                    disabled={!qrValue || !weight || !sealQrValue}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" /> Add to batch
                  </button>

                  {/* Batch items list */}
                  {batchItems.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-[var(--text)]">Batch Items ({batchItems.length})</p>
                        <p className="text-xs font-semibold text-primary-600">Total: {batchTotalWeight.toFixed(2)} kg</p>
                      </div>
                      {batchItems.map((item) => (
                        <div key={item.tempId} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                          <Package className="h-4 w-4 shrink-0 text-accent-600" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-xs text-[var(--text)]">{item.qr_value}</p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {item.start_weight} kg
                              {item.weight_source === 'manual' && <span className="ml-1 text-warning-500">(manual)</span>}
                            </p>
                            {item.seal_qr_value && (
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-accent-600">
                                <ShieldCheck className="h-3 w-3" /> {item.seal_qr_value}
                              </p>
                            )}
                          </div>
                          <button onClick={() => removeBatchItem(item.tempId)} className="text-error-500 hover:text-error-600">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Photo node */}
              {currentNode.type === 'photo' && (
                <div>
                  {photoUrl ? (
                    <div className="relative">
                      <img src={photoUrl} alt="Captured" className="w-full rounded-lg border border-[var(--border)]" style={{ maxHeight: '300px', objectFit: 'contain' }} />
                      <button
                        onClick={() => setPhotoUrl('')}
                        className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setScanContext('node'); setScannerMode('photo'); }}
                      className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-8 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                    >
                      <Camera className="h-8 w-8" />
                      <span className="text-sm">Capture photo</span>
                    </button>
                  )}
                </div>
              )}

              {/* Approval node */}
              {currentNode.type === 'approval' && (
                <div className="rounded-lg border border-accent-500/20 bg-accent-500/5 p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-accent-600" />
                    <p className="text-sm font-medium text-[var(--text)]">
                      Approval required from: {String(currentNode.config.approver ?? 'Admin')}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Mark as approved to continue.</p>
                </div>
              )}

              {/* Condition node */}
              {currentNode.type === 'condition' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                    {String(currentNode.config.condition_label ?? 'Condition check')}
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConditionAnswer('yes')}
                      className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium ${conditionAnswer === 'yes' ? 'border-transparent bg-accent-600 text-white' : 'border-[var(--border)] text-[var(--text)]'}`}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConditionAnswer('no')}
                      className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium ${conditionAnswer === 'no' ? 'border-transparent bg-error-500 text-white' : 'border-[var(--border)] text-[var(--text)]'}`}
                    >
                      No
                    </button>
                  </div>
                  {(currentNode.config.risk_toggle as boolean) === true && (
                    <p className="mt-2 text-xs text-primary-600">Risk reconciliation gate — results will be shown at the end.</p>
                  )}
                </div>
              )}

              {/* Verification node */}
              {currentNode.type === 'verification' && (() => {
                const targets = (currentNode.config.verification_targets as VerificationTarget[]) ?? [];
                return (
                  <div className="space-y-4">
                    <p className="text-sm text-[var(--text-muted)]">
                      Complete each verification step below.
                    </p>
                    {targets.includes('item') && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Verify Item</label>
                        {qrValue ? (
                          <div className="flex items-center justify-between rounded-lg border border-accent-500/30 bg-accent-500/5 px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-accent-600" />
                              <span className="font-mono text-sm text-[var(--text)]">{qrValue}</span>
                            </div>
                            <button onClick={() => { setQrValue(''); setQrValidationError(''); }} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setScanContext('node'); setScannerMode('qr'); setQrValidationError(''); }}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-4 text-sm font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                          >
                            <QrCode className="h-4 w-4" /> Scan item QR
                          </button>
                        )}
                      </div>
                    )}
                    {targets.includes('seal') && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Verify Seal</label>
                        {sealQrValue ? (
                          <div className="flex items-center justify-between rounded-lg border border-accent-500/30 bg-accent-500/5 px-4 py-3">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 text-accent-600" />
                              <span className="font-mono text-sm text-[var(--text)]">{sealQrValue}</span>
                            </div>
                            <button onClick={() => { setSealQrValue(''); setQrValidationError(''); }} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setScanContext('batch_seal'); setScannerMode('seal'); setQrValidationError(''); }}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-4 text-sm font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                          >
                            <ShieldCheck className="h-4 w-4" /> Scan seal QR
                          </button>
                        )}
                      </div>
                    )}
                    {targets.includes('weight') && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Verify Weight (kg)</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Scale className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" />
                            <input
                              type="number"
                              step="0.01"
                              value={weight}
                              onChange={(e) => { setWeight(e.target.value); setWeightSource('manual'); }}
                              placeholder="Enter weight"
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                            />
                          </div>
                          <button
                            onClick={() => { setScanContext('node'); setScannerMode('weight'); }}
                            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                          >
                            <Scale className="h-4 w-4" /> Auto-read
                          </button>
                        </div>
                        {/* Photo proof for weight verification */}
                        <div className="mt-2">
                          {verificationWeightPhoto ? (
                            <div className="relative">
                              <img src={verificationWeightPhoto} alt="Weight proof" className="w-full rounded-lg border border-accent-500/30" style={{ maxHeight: '180px', objectFit: 'contain' }} />
                              <button
                                onClick={() => setVerificationWeightPhoto('')}
                                className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white"
                              >
                                <X className="h-4 w-4" />
                              </button>
                              <p className="mt-1 flex items-center gap-1 text-xs text-accent-600">
                                <Check className="h-3 w-3" /> Photo proof captured
                              </p>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setScanContext('verification_weight_photo'); setScannerMode('photo'); }}
                              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-3 text-xs font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                            >
                              <Camera className="h-4 w-4" /> Capture photo proof of weight
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {targets.includes('trolley') && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Verify Trolley</label>
                        {trolleyQrValue ? (
                          <div className="flex items-center justify-between rounded-lg border border-accent-500/30 bg-accent-500/5 px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Truck className="h-4 w-4 text-accent-600" />
                              <span className="font-mono text-sm text-[var(--text)]">{trolleyQrValue}</span>
                            </div>
                            <button onClick={() => { setTrolleyQrValue(''); setQrValidationError(''); }} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setScanContext('node'); setScannerMode('qr'); setQrValidationError(''); }}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-4 text-sm font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                          >
                            <Truck className="h-4 w-4" /> Scan trolley QR
                          </button>
                        )}
                      </div>
                    )}
                    {targets.includes('batch') && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Verify Batch ({batchItems.length} items)</label>
                        {batchItems.length > 0 ? (
                          <div className="space-y-2">
                            {batchItems.map((item) => {
                              const scanned = verificationBatchScans[item.qr_value];
                              return (
                                <div key={item.tempId} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${scanned ? 'border-accent-500/30 bg-accent-500/5' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
                                  <Package className="h-4 w-4 shrink-0 text-accent-600" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-mono text-xs text-[var(--text)]">{item.qr_value}</p>
                                    <p className="text-xs text-[var(--text-muted)]">{item.start_weight} kg{item.seal_qr_value ? ` · ${item.seal_qr_value}` : ''}</p>
                                  </div>
                                  {scanned ? (
                                    <span className="flex items-center gap-1 text-xs font-medium text-accent-600">
                                      <CheckCircle className="h-4 w-4" /> Verified
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => { setScanContext('verification_batch_scan'); setScannerMode('qr'); setQrValidationError(''); }}
                                      className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
                                    >
                                      <QrCode className="h-3.5 w-3.5" /> Scan QR
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--text-muted)]">No batch items to verify. Batch items are created during a Batch Creation step.</p>
                        )}
                      </div>
                    )}
                    {qrValidationError && (scanContext === 'batch_verify_qr' || scanContext === 'end_verification' || scanContext === 'verification_batch_scan') && (
                      <p className="rounded-lg bg-error-500/10 px-3 py-2 text-xs text-error-500">{qrValidationError}</p>
                    )}
                  </div>
                );
              })()}

              {/* Custom fields */}
              {customFields.length > 0 && !endVerificationMode && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary-600" />
                    <p className="text-sm font-semibold text-[var(--text)]">Additional Fields</p>
                  </div>
                  <div className="space-y-3">
                    {customFields.map((field) => (
                      <div key={field.id}>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                          {field.label}{field.required && <span className="ml-0.5 text-error-500">*</span>}
                        </label>
                        {field.input_type === 'short_text' && (
                          <input
                            type="text"
                            value={customFieldValues[field.id] ?? ''}
                            onChange={(e) => setCustomFieldValues((p) => ({ ...p, [field.id]: e.target.value }))}
                            disabled={submitting}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 disabled:opacity-50"
                          />
                        )}
                        {field.input_type === 'number' && (
                          <input
                            type="number"
                            step="any"
                            value={customFieldValues[field.id] ?? ''}
                            onChange={(e) => setCustomFieldValues((p) => ({ ...p, [field.id]: e.target.value }))}
                            disabled={submitting}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 disabled:opacity-50"
                          />
                        )}
                        {field.input_type === 'date' && (
                          <input
                            type="date"
                            value={customFieldValues[field.id] ?? ''}
                            onChange={(e) => setCustomFieldValues((p) => ({ ...p, [field.id]: e.target.value }))}
                            disabled={submitting}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 disabled:opacity-50"
                          />
                        )}
                        {field.input_type === 'multiple_choice' && (
                          <select
                            value={customFieldValues[field.id] ?? ''}
                            onChange={(e) => setCustomFieldValues((p) => ({ ...p, [field.id]: e.target.value }))}
                            disabled={submitting}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 disabled:opacity-50"
                          >
                            <option value="">— Select —</option>
                            {(field.options ?? []).map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        )}
                        {field.input_type === 'boolean' && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setCustomFieldValues((p) => ({ ...p, [field.id]: 'yes' }))}
                              disabled={submitting}
                              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${customFieldValues[field.id] === 'yes' ? 'border-transparent bg-accent-600 text-white' : 'border-[var(--border)] text-[var(--text)]'}`}
                            >Yes</button>
                            <button
                              type="button"
                              onClick={() => setCustomFieldValues((p) => ({ ...p, [field.id]: 'no' }))}
                              disabled={submitting}
                              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${customFieldValues[field.id] === 'no' ? 'border-transparent bg-error-500 text-white' : 'border-[var(--border)] text-[var(--text)]'}`}
                            >No</button>
                          </div>
                        )}
                        {field.input_type === 'photo' && (
                          customFieldPhotos[field.id] ? (
                            <div className="relative">
                              <img src={customFieldPhotos[field.id]} alt={field.label} className="w-full rounded-lg border border-[var(--border)]" style={{ maxHeight: '200px', objectFit: 'contain' }} />
                              <button
                                onClick={() => setCustomFieldPhotos((p) => { const n = { ...p }; delete n[field.id]; return n; })}
                                className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setCustomFieldTarget(field.id); setScanContext('custom_field_photo'); setScannerMode('photo'); }}
                              disabled={submitting}
                              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-4 text-sm font-medium text-primary-600 hover:bg-[var(--surface)] disabled:opacity-50"
                            >
                              <Camera className="h-4 w-4" /> Capture photo
                            </button>
                          )
                        )}
                        {field.input_type === 'signature' && (
                          <input
                            type="text"
                            value={customFieldValues[field.id] ?? ''}
                            onChange={(e) => setCustomFieldValues((p) => ({ ...p, [field.id]: e.target.value }))}
                            placeholder="Type full name as signature"
                            disabled={submitting}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500 disabled:opacity-50"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* End-of-process batch verification */}
            {endVerificationMode && batchItems.length > 0 ? (
              <div className="mt-5 rounded-xl border border-primary-500/30 bg-primary-500/5 p-5">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5 text-primary-600" />
                  <p className="text-sm font-semibold text-[var(--text)]">Batch Verification</p>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Re-scan each item's QR code and re-weigh it individually. The collective total will be compared against the original batch weight.
                </p>

                {/* Weight summary */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-[var(--surface-hover)] p-3 text-center">
                    <p className="text-xs text-[var(--text-subtle)]">Original Total</p>
                    <p className="mt-1 font-semibold text-[var(--text)]">{batchVerifyOriginalTotal.toFixed(2)} kg</p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-hover)] p-3 text-center">
                    <p className="text-xs text-[var(--text-subtle)]">Verified Total</p>
                    <p className="mt-1 font-semibold text-primary-600">{batchVerifyTotalWeight.toFixed(2)} kg</p>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${Math.abs(batchVerifyTotalWeight - batchVerifyOriginalTotal) < 0.01 ? 'bg-accent-500/10' : 'bg-error-500/10'}`}>
                    <p className="text-xs text-[var(--text-subtle)]">Delta</p>
                    <p className={`mt-1 font-semibold ${Math.abs(batchVerifyTotalWeight - batchVerifyOriginalTotal) < 0.01 ? 'text-accent-600' : 'text-error-500'}`}>
                      {(batchVerifyTotalWeight - batchVerifyOriginalTotal > 0 ? '+' : '')}{(batchVerifyTotalWeight - batchVerifyOriginalTotal).toFixed(2)} kg
                    </p>
                  </div>
                </div>

                {/* Per-item verification list */}
                <div className="mt-4 space-y-2">
                  {batchItems.map((item) => {
                    const v = batchVerifications[item.qr_value];
                    if (!v) return null;
                    const weightDelta = v.weight_verified ? parseFloat(v.verified_weight) - v.original_weight : 0;
                    const weightMatches = v.weight_verified && Math.abs(weightDelta) < 0.01;
                    return (
                      <div key={item.tempId} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Package className="h-4 w-4 shrink-0 text-accent-600" />
                            <div className="min-w-0">
                              <p className="truncate font-mono text-xs text-[var(--text)]">{item.qr_value}</p>
                              <p className="text-xs text-[var(--text-muted)]">Original: {item.start_weight} kg{item.seal_qr_value ? ` · Seal: ${item.seal_qr_value}` : ''}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {v.qr_verified && v.weight_verified && (
                              <span className="flex items-center gap-1 text-xs font-medium text-accent-600">
                                <CheckCircle className="h-3.5 w-3.5" /> Verified
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                          {/* QR verification */}
                          <div>
                            <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">QR Scan</p>
                            {v.qr_verified ? (
                              <div className="flex items-center gap-1.5 rounded-lg border border-accent-500/30 bg-accent-500/5 px-2.5 py-2">
                                <Check className="h-3.5 w-3.5 text-accent-600" />
                                <span className="truncate font-mono text-xs text-[var(--text)]">{item.qr_value}</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setScanContext('batch_verify_qr'); setScannerMode('qr'); setQrValidationError(''); }}
                                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] py-2 text-xs font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                              >
                                <QrCode className="h-3.5 w-3.5" /> Scan QR
                              </button>
                            )}
                          </div>

                          {/* Weight verification */}
                          <div>
                            <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">Weight</p>
                            {v.weight_verified ? (
                              <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 ${weightMatches ? 'border-accent-500/30 bg-accent-500/5' : 'border-error-500/30 bg-error-500/5'}`}>
                                <Scale className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                <span className="text-xs font-semibold text-[var(--text)]">{v.verified_weight} kg</span>
                                {!weightMatches && (
                                  <span className="text-xs text-error-500">({weightDelta > 0 ? '+' : ''}{weightDelta.toFixed(2)})</span>
                                )}
                              </div>
                            ) : (
                              <div className="flex gap-1.5">
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="Weight"
                                  disabled={!v.qr_verified}
                                  value={v.verified_weight}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setBatchVerifications((prev) => ({
                                      ...prev,
                                      [item.qr_value]: {
                                        ...prev[item.qr_value],
                                        verified_weight: val,
                                        verified_weight_source: 'manual',
                                        weight_verified: val !== '',
                                      },
                                    }));
                                  }}
                                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-primary-500 disabled:opacity-50"
                                />
                                <button
                                  onClick={() => {
                                    setBatchVerifyTargetQr(item.qr_value);
                                    setScanContext('batch_verify_weight');
                                    setScannerMode('weight');
                                  }}
                                  disabled={!v.qr_verified}
                                  className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
                                  title="Auto-read from scale"
                                >
                                  <Scale className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Seal re-scan if item has seal */}
                        {item.seal_qr_value && (
                          <div className="mt-3 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                              <span className="font-mono text-xs text-[var(--text-muted)]">{item.seal_qr_value}</span>
                            </div>
                            {verificationScans[item.seal_qr_value] === item.seal_qr_value ? (
                              <span className="flex items-center gap-1 text-xs font-medium text-accent-600">
                                <CheckCircle className="h-3.5 w-3.5" /> Seal intact
                              </span>
                            ) : (
                              <button
                                onClick={() => { setScanContext('end_verification'); setScannerMode('seal'); setQrValidationError(''); }}
                                className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
                              >
                                <QrCode className="h-3.5 w-3.5" /> Verify seal
                              </button>
                            )}
                          </div>
                        )}

                        {/* Verification photo */}
                        {v.photo_url && (
                          <div className="mt-2 relative">
                            <img src={v.photo_url} alt="Verification" className="w-full rounded-lg border border-[var(--border)]" style={{ maxHeight: '120px', objectFit: 'contain' }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Verification photo (overall) */}
                <div className="mt-4">
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Verification Photo (optional)</label>
                  {verificationPhoto ? (
                    <div className="relative">
                      <img src={verificationPhoto} alt="Verification" className="w-full rounded-lg border border-[var(--border)]" style={{ maxHeight: '200px', objectFit: 'contain' }} />
                      <button onClick={() => setVerificationPhoto('')} className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setScanContext('end_verification'); setScannerMode('photo'); }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-4 text-xs font-medium text-primary-600 hover:bg-[var(--surface-hover)]"
                    >
                      <Camera className="h-4 w-4" /> Capture verification photo
                    </button>
                  )}
                </div>

                {qrValidationError && (scanContext === 'batch_verify_qr' || scanContext === 'end_verification') && (
                  <p className="mt-2 rounded-lg bg-error-500/10 px-3 py-2 text-xs text-error-500">{qrValidationError}</p>
                )}
              </div>
            ) : null}

            {/* Complete button */}
            <div className="mt-6 flex items-center justify-between">
              <div className="text-xs text-[var(--text-muted)]">
                {remainingNodes.length > 1 && <span>Next: {remainingNodes[1]?.label ?? '—'}</span>}
              </div>
              <button
                onClick={completeCurrentNode}
                disabled={submitting || !canCompleteNode()}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Processing...</>
                ) : endVerificationMode ? (
                  <><Flag className="h-5 w-5" /> Confirm & complete</>
                ) : completedIds.length + 1 >= (workflow.nodes.filter((n) => n.type !== 'stage').length || workflow.nodes.length) ? (
                  <><Flag className="h-5 w-5" /> Complete process</>
                ) : (
                  <><Check className="h-5 w-5" /> Complete step <ChevronRight className="h-4 w-4" /></>
                )}
              </button>
            </div>
          </div>

          {/* Upcoming steps */}
          {remainingNodes.length > 1 && !showWorkflow && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Upcoming Steps</p>
              <div className="space-y-1.5">
                {remainingNodes.slice(0, 5).map((node, i) => {
                  const Icon = NODE_ICONS[node.type];
                  const meta = NODE_META[node.type];
                  return (
                    <div key={node.id} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i === 0 ? 'bg-primary-600 text-white' : 'bg-[var(--surface-hover)] text-[var(--text-muted)]'}`}>
                        {i + 1}
                      </span>
                      <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                      <span className={i === 0 ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)]'}>{node.label}</span>
                      {i < remainingNodes.length - 1 && i < 4 && <ArrowRight className="ml-auto h-3 w-3 text-[var(--text-subtle)]" />}
                    </div>
                  );
                })}
                {remainingNodes.length > 5 && (
                  <p className="px-3 text-xs text-[var(--text-subtle)]">+{remainingNodes.length - 5} more steps...</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Scanner modals */}
      {scannerMode === 'qr' && (
        <QrScanner onScan={handleQrScan} onClose={() => setScannerMode(null)} />
      )}
      {scannerMode === 'seal' && (
        <QrScanner onScan={handleQrScan} onClose={() => setScannerMode(null)} title="Scan Seal QR" />
      )}
      {scannerMode === 'photo' && (
        <PhotoCapture onCapture={handlePhotoCapture} onClose={() => setScannerMode(null)} />
      )}
      {scannerMode === 'weight' && (
        <WeightReader onRead={handleWeightRead} onClose={() => setScannerMode(null)} />
      )}
    </div>
  );
}
