export type VerificationTarget = 'weight' | 'seal' | 'item' | 'trolley' | 'batch';

export type WorkflowNodeType =
  | 'stage'
  | 'batch_create'
  | 'qr_scan'
  | 'weighing'
  | 'photo'
  | 'approval'
  | 'condition'
  | 'seal_verify'
  | 'trolley_scan'
  | 'verification';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  x: number;
  y: number;
  qr_code_id?: string;
  qr_value?: string;
  config: Record<string, unknown>;
  risk_rule_ids?: string[];
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition_value?: string;
}

export interface Workflow {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  risk_rule_ids?: string[];
}

export const NODE_META: Record<WorkflowNodeType, { label: string; color: string; icon: string }> = {
  stage: { label: 'Stage / Checkpoint', color: '#3b82f6', icon: 'MapPin' },
  batch_create: { label: 'Batch Creation', color: '#8b5cf6', icon: 'PackagePlus' },
  qr_scan: { label: 'QR Scan', color: '#06b6d4', icon: 'QrCode' },
  weighing: { label: 'Weighing', color: '#f59e0b', icon: 'Scale' },
  photo: { label: 'Photo Capture', color: '#ec4899', icon: 'Camera' },
  approval: { label: 'Approval', color: '#10b981', icon: 'CheckCircle' },
  condition: { label: 'Condition', color: '#f97316', icon: 'GitBranch' },
  seal_verify: { label: 'Seal Verification', color: '#ef4444', icon: 'ShieldCheck' },
  trolley_scan: { label: 'Trolley Scan', color: '#6366f1', icon: 'Truck' },
  verification: { label: 'Verification', color: '#0d9488', icon: 'BadgeCheck' },
};

export const NODE_TYPES: WorkflowNodeType[] = [
  'stage',
  'batch_create',
  'qr_scan',
  'weighing',
  'photo',
  'approval',
  'condition',
  'seal_verify',
  'trolley_scan',
  'verification',
];

export const EXECUTION_NODE_TYPES: WorkflowNodeType[] = [
  'batch_create',
  'qr_scan',
  'weighing',
  'photo',
  'approval',
  'seal_verify',
  'trolley_scan',
  'verification',
];

export function emptyWorkflow(): Workflow {
  return { nodes: [], edges: [], risk_rule_ids: [] };
}

export function createNode(type: WorkflowNodeType, x: number, y: number): WorkflowNode {
  return {
    id: crypto.randomUUID(),
    type,
    label: NODE_META[type].label,
    x,
    y,
    config: {},
  };
}

export function getOutgoingEdges(workflow: Workflow, nodeId: string): WorkflowEdge[] {
  return workflow.edges.filter((e) => e.source === nodeId);
}

export function getIncomingEdges(workflow: Workflow, nodeId: string): WorkflowEdge[] {
  return workflow.edges.filter((e) => e.target === nodeId);
}

export function getStartNode(workflow: Workflow): WorkflowNode | null {
  if (workflow.nodes.length === 0) return null;
  const targets = new Set(workflow.edges.map((e) => e.target));
  const noIncoming = workflow.nodes.filter((n) => !targets.has(n.id));
  if (noIncoming.length > 0) return noIncoming[0];
  return workflow.nodes[0];
}

export function getNextNode(workflow: Workflow, nodeId: string): WorkflowNode | null {
  const edges = getOutgoingEdges(workflow, nodeId);
  if (edges.length === 0) return null;
  return workflow.nodes.find((n) => n.id === edges[0].target) ?? null;
}

export function getNodeStatus(
  completedIds: string[],
  currentNodeId: string,
  nodeId: string,
): 'completed' | 'current' | 'pending' {
  if (completedIds.includes(nodeId)) return 'completed';
  if (nodeId === currentNodeId) return 'current';
  return 'pending';
}
