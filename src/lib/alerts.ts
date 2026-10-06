import { supabase } from '@/lib/supabase';

/**
 * Risk category hierarchy: Critical > High > Moderate > Low
 * Used for both process category and aggregate risk scoring.
 */
const CATEGORY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  moderate: 2,
  low: 1,
};

const CATEGORY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};

export function categoryLabel(cat: string | null): string {
  if (!cat) return 'Low';
  return CATEGORY_LABELS[cat.toLowerCase()] ?? cat;
}

export function aggregateRiskScore(categories: string[]): string {
  if (categories.length === 0) return 'Low';
  let highest = 0;
  for (const c of categories) {
    const rank = CATEGORY_RANK[c.toLowerCase()] ?? 1;
    if (rank > highest) highest = rank;
  }
  for (const [label, rank] of Object.entries(CATEGORY_RANK)) {
    if (rank === highest) return CATEGORY_LABELS[label];
  }
  return 'Low';
}

interface RiskRule {
  id: string;
  name: string;
  rule_type: string;
  severity_model: 'multi_level' | 'pass_fail';
  thresholds: Record<string, string | number> | null;
  scope: 'stage' | 'process';
  action: 'block' | 'alert' | 'warn';
}

interface ProcessRun {
  id: string;
  process_definition_id: string;
  employee_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  reconciliation_result: Record<string, unknown> | null;
  batch_items: Array<{
    qr_value: string;
    start_weight: number;
    end_weight: number | null;
    seal_qr_value: string | null;
  }> | null;
}

interface ProcessDefinition {
  id: string;
  name: string;
  category: string;
  workflow?: {
    risk_rule_ids?: string[];
    nodes?: Array<{ risk_rule_ids?: string[] }>;
  } | null;
}

interface BreachResult {
  breached: boolean;
  severityLevel: string;
  processCategory: string;
  message: string;
  stageIndex: number;
  action: 'block' | 'alert' | 'warn';
}

/**
 * Determine the process category from a definition's category field.
 * Maps common category names to the four-tier system.
 */
function ruleAction(rule: RiskRule | undefined, defaultAction: 'block' | 'alert' | 'warn' = 'alert'): 'block' | 'alert' | 'warn' {
  if (!rule) return defaultAction;
  const a = rule.action;
  if (a === 'block' || a === 'alert' || a === 'warn') return a;
  return defaultAction;
}

function resolveCategory(defCategory: string | null): string {
  if (!defCategory) return 'moderate';
  const c = defCategory.toLowerCase().trim();
  if (c === 'critical' || c === 'crit') return 'critical';
  if (c === 'high') return 'high';
  if (c === 'moderate' || c === 'medium' || c === 'normal') return 'moderate';
  if (c === 'low') return 'low';
  // Default: anything unrecognized is moderate
  return 'moderate';
}

/**
 * Determine severity level from a risk rule's severity model and threshold values.
 */
function resolveSeverity(
  rule: RiskRule,
  thresholds: Record<string, string | number> | null,
): { level: string; category: string } {
  if (rule.severity_model === 'pass_fail') {
    const level = (thresholds?.level as string) ?? 'fail';
    // pass_fail rules that are breached are at least "high"
    return { level: 'fail', category: 'high' };
  }
  // multi_level: look for a severity in thresholds, or derive from rule name
  const explicitLevel = (thresholds?.severity as string) ?? (thresholds?.level as string);
  if (explicitLevel) {
    const lc = explicitLevel.toLowerCase();
    if (lc === 'critical') return { level: 'critical', category: 'critical' };
    if (lc === 'high') return { level: 'high', category: 'high' };
    if (lc === 'medium' || lc === 'moderate') return { level: 'medium', category: 'moderate' };
    if (lc === 'low') return { level: 'low', category: 'low' };
  }
  // Default severity based on scope
  if (rule.scope === 'process') return { level: 'high', category: 'high' };
  return { level: 'medium', category: 'moderate' };
}

/**
 * Evaluate all built-in and custom risk factors for a completed process run.
 * Returns one BreachResult per breached factor/stage.
 */
async function evaluateBreaches(
  run: ProcessRun,
  def: ProcessDefinition,
  rules: RiskRule[],
  employeeId: string,
): Promise<BreachResult[]> {
  const breaches: BreachResult[] = [];
  const defCategory = resolveCategory(def.category);

  // 1. Weight reconciliation breach — only if a matching rule is selected
  const recon = run.reconciliation_result;
  if (recon && recon.matched === false) {
    const delta = typeof recon.delta === 'number' ? recon.delta : 0;
    const weightRule = rules.find((r) => r.rule_type.toLowerCase().includes('weight') || r.rule_type.toLowerCase().includes('reconciliation'));
    if (weightRule) {
      const tolerance = weightRule.thresholds?.tolerance != null
        ? Math.abs(Number(weightRule.thresholds.tolerance))
        : 0.01;
      if (Math.abs(delta) > tolerance) {
        const sev = resolveSeverity(weightRule, weightRule.thresholds);
        breaches.push({
          breached: true,
          severityLevel: sev.level,
          processCategory: defCategory,
          message: `Weight reconciliation failed: delta of ${delta.toFixed(2)} kg exceeds tolerance of ${tolerance} kg`,
          stageIndex: -1,
          action: ruleAction(weightRule, 'warn'),
        });
      }
    }
  }

  // 2. Time limit breach — only if a matching rule is selected
  if (run.started_at && run.completed_at) {
    const start = new Date(run.started_at).getTime();
    const end = new Date(run.completed_at).getTime();
    const elapsedMin = (end - start) / 60000;
    const timeRule = rules.find((r) => r.rule_type.toLowerCase().includes('time') || r.rule_type.toLowerCase().includes('duration'));
    if (timeRule) {
      const limit = timeRule.thresholds?.max_minutes != null
        ? Number(timeRule.thresholds.max_minutes)
        : timeRule.thresholds?.limit != null
          ? Number(timeRule.thresholds.limit)
          : null;
      if (limit != null && elapsedMin > limit) {
        const sev = resolveSeverity(timeRule, timeRule.thresholds);
        breaches.push({
          breached: true,
          severityLevel: sev.level,
          processCategory: defCategory,
          message: `Process exceeded time limit: ${elapsedMin.toFixed(1)} min (limit: ${limit} min)`,
          stageIndex: -1,
          action: ruleAction(timeRule, 'alert'),
        });
      }
    }
  }

  // 3. Duplicate seal detection — only if a matching rule is selected
  if (run.batch_items && run.batch_items.length > 0) {
    const sealValues = run.batch_items.map((b) => b.seal_qr_value).filter(Boolean) as string[];
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const s of sealValues) {
      if (seen.has(s)) duplicates.add(s);
      seen.add(s);
    }
    const dupSealRule = rules.find((r) => r.rule_type.toLowerCase().includes('duplicate_seal') || r.rule_type.toLowerCase().includes('duplicate'));
    if (duplicates.size > 0 && dupSealRule) {
      const sev = resolveSeverity(dupSealRule, dupSealRule.thresholds);
      breaches.push({
        breached: true,
        severityLevel: sev.level,
        processCategory: defCategory,
        message: `Duplicate seal(s) detected: ${Array.from(duplicates).join(', ')}`,
        stageIndex: -1,
        action: ruleAction(dupSealRule, 'block'),
      });
    }

    // 4. Seal verification failure (missing seal on items that should have them)
    // This is checked by seeing if any batch item has no seal_qr_value when others do
    // — only flag if the process definition includes seal_verify nodes, which we can't
    // easily check here. Skip for now; the workflow already enforces this at scan time.
  }

  // 5. Single-person completion — only if a matching rule is selected
  const { data: scanData } = await supabase
    .from('scan_records')
    .select('employee_user_id, weight, weight_source, photo_url')
    .eq('process_run_id', run.id);
  if (scanData && scanData.length > 1) {
    const uniqueEmployees = new Set(scanData.map((s) => s.employee_user_id).filter(Boolean));
    if (uniqueEmployees.size === 1) {
      const singlePersonRule = rules.find((r) => r.rule_type.toLowerCase().includes('single') || r.rule_type.toLowerCase().includes('person'));
      if (singlePersonRule) {
        const sev = resolveSeverity(singlePersonRule, singlePersonRule.thresholds);
        breaches.push({
          breached: true,
          severityLevel: sev.level,
          processCategory: defCategory,
          message: 'Process completed by a single employee without independent verification',
          stageIndex: -1,
          action: ruleAction(singlePersonRule, 'alert'),
        });
      }
    }
  }

  // 5b. Manual weight without photo — only if a matching rule is selected
  if (scanData && scanData.length > 0) {
    const manualNoPhoto = scanData.filter(
      (s) => s.weight_source === 'manual' && s.weight != null && !s.photo_url,
    );
    if (manualNoPhoto.length > 0) {
      const manualWeightRule = rules.find(
        (r) => r.rule_type.toLowerCase().includes('manual_weight') || r.rule_type.toLowerCase().includes('manual_weight_no_photo'),
      );
      if (manualWeightRule) {
        const sev = resolveSeverity(manualWeightRule, manualWeightRule.thresholds);
        breaches.push({
          breached: true,
          severityLevel: sev.level,
          processCategory: defCategory,
          message: `${manualNoPhoto.length} scan(s) with manually entered weight and no photo captured — treated as discrepancy.`,
          stageIndex: -1,
          action: ruleAction(manualWeightRule, 'warn'),
        });
      }
    }
  }

  // 6. Process deviation (out-of-order scans)
  // Check if scan_records were created in the expected node order
  // We compare the order of scan_records to the workflow's stage order
  // This is a lightweight check — full deviation detection would need the workflow
  const deviationRule = rules.find((r) => r.rule_type.toLowerCase().includes('deviation') || r.rule_type.toLowerCase().includes('order'));
  if (deviationRule) {
    // For now, we don't have enough context to determine deviation here
    // The workflow engine already prevents out-of-order progression
  }

  // 7. Evaluate custom rules that don't match built-in factors
  for (const rule of rules) {
    const ruleType = rule.rule_type.toLowerCase();
    // Skip rules already handled above
    if (ruleType.includes('weight') || ruleType.includes('reconciliation')) continue;
    if (ruleType.includes('time') || ruleType.includes('duration')) continue;
    if (ruleType.includes('single') || ruleType.includes('person')) continue;
    if (ruleType.includes('deviation') || ruleType.includes('order')) continue;
    if (ruleType.includes('seal') || ruleType.includes('duplicate')) continue;
    if (ruleType.includes('manual_weight')) continue;

    // For any other custom rule, check if it has a threshold that can be evaluated
    // against the reconciliation result or process data
    if (rule.thresholds) {
      // Generic: if the rule has a "condition" threshold set to "always", flag it
      // This is a placeholder for truly custom rules
      const condition = rule.thresholds.condition as string | undefined;
      if (condition === 'always' || condition === 'breach') {
        const sev = resolveSeverity(rule, rule.thresholds);
        breaches.push({
          breached: true,
          severityLevel: sev.level,
          processCategory: defCategory,
          message: `Custom rule "${rule.name}" triggered`,
          stageIndex: -1,
          action: ruleAction(rule, 'alert'),
        });
      }
    }
  }

  return breaches;
}

/**
 * Check for duplicate seals across ALL process runs (not just current one).
 * A seal used in a previous run that appears again is a breach.
 */
async function checkDuplicateSealsAcrossRuns(run: ProcessRun, def: ProcessDefinition): Promise<BreachResult | null> {
  if (!run.batch_items) return null;
  const sealValues = run.batch_items.map((b) => b.seal_qr_value).filter(Boolean) as string[];
  if (sealValues.length === 0) return null;

  // Check seals table for already-used seals
  const { data: usedSeals } = await supabase
    .from('seals')
    .select('seal_serial, used_in_process, process_run_id')
    .in('seal_serial', sealValues)
    .eq('used_in_process', true)
    .neq('process_run_id', run.id);

  if (usedSeals && usedSeals.length > 0) {
    const serials = usedSeals.map((s) => s.seal_serial).join(', ');
    return {
      breached: true,
      severityLevel: 'critical',
      processCategory: resolveCategory(def.category),
      message: `Seal(s) already used in another process: ${serials}`,
      stageIndex: -1,
      action: 'block',
    };
  }
  return null;
}

/**
 * Main entry point: evaluate a completed process run for risk breaches,
 * insert individual alerts, then check for collective alert conditions.
 */
export async function evaluateAndGenerateAlerts(
  run: ProcessRun,
  def: ProcessDefinition,
  employeeId: string,
): Promise<{ individualCount: number; collectiveCount: number; highestAction: 'block' | 'alert' | 'warn' | 'none' }> {
  // Fetch the full process definition with workflow if not already included
  let workflow = def.workflow;
  if (!workflow) {
    const { data: fullDef } = await supabase
      .from('process_definitions')
      .select('workflow')
      .eq('id', def.id)
      .maybeSingle();
    workflow = (fullDef as { workflow?: ProcessDefinition['workflow'] })?.workflow ?? null;
  }

  // Collect all attached rule IDs from the workflow
  const processRuleIds = new Set<string>(workflow?.risk_rule_ids ?? []);
  for (const node of workflow?.nodes ?? []) {
    for (const rid of node.risk_rule_ids ?? []) {
      processRuleIds.add(rid);
    }
  }

  // Fetch all risk rules
  const { data: ruleData } = await supabase
    .from('risk_rules')
    .select('*')
    .order('created_at', { ascending: true });
  const allRules = (ruleData as RiskRule[]) ?? [];

  // If the workflow has attached rules, only evaluate those.
  // If no rules are attached (legacy workflows), evaluate all rules (backward compatible).
  const rules = processRuleIds.size > 0
    ? allRules.filter((r) => processRuleIds.has(r.id))
    : allRules;

  // Evaluate breaches
  const breaches = await evaluateBreaches(run, def, rules, employeeId);

  // Check cross-run duplicate seals
  const dupSealBreach = await checkDuplicateSealsAcrossRuns(run, def);
  if (dupSealBreach) breaches.push(dupSealBreach);

  if (breaches.length === 0) {
    return { individualCount: 0, collectiveCount: 0, highestAction: 'none' };
  }

  // Determine the highest action across all breaches
  const actionRank: Record<string, number> = { block: 3, alert: 2, warn: 1 };
  let highestAction: 'block' | 'alert' | 'warn' = 'alert';
  for (const b of breaches) {
    if (actionRank[b.action] > actionRank[highestAction]) {
      highestAction = b.action;
    }
  }

  // Insert individual alerts
  const individualAlerts = breaches.map((b) => ({
    alert_type: 'individual',
    process_run_id: run.id,
    stage_index: b.stageIndex,
    employee_id: employeeId,
    severity_level: b.severityLevel,
    process_category: b.processCategory,
    action_taken: b.action,
    message: b.message,
    status: 'active',
  }));

  const { error: insertError } = await supabase
    .from('risk_alerts')
    .insert(individualAlerts);

  if (insertError) {
    console.error('Failed to insert individual alerts:', insertError);
    return { individualCount: 0, collectiveCount: 0, highestAction: 'none' };
  }

  // Mark the process run status based on the highest action
  const runStatus = highestAction === 'block' ? 'blocked' : 'breached';
  const resolutionStatus = highestAction === 'block' ? 'blocked' : highestAction === 'warn' ? 'warned' : 'alerted';
  await supabase
    .from('process_runs')
    .update({ status: runStatus, resolution_status: resolutionStatus })
    .eq('id', run.id);

  // Now check collective alert conditions
  const collectiveAlerts: Array<{
    alert_type: 'collective';
    process_run_id: string | null;
    stage_index: number;
    employee_id: string;
    severity_level: string;
    process_category: string;
    action_taken: string;
    message: string;
    status: string;
  }> = [];

  // Condition 1: Single process failure — 2+ stages within the same process are breached
  if (breaches.length >= 2) {
    const categories = breaches.map((b) => b.processCategory);
    const aggScore = aggregateRiskScore(categories);
    collectiveAlerts.push({
      alert_type: 'collective',
      process_run_id: run.id,
      stage_index: -1,
      employee_id: employeeId,
      severity_level: aggScore.toLowerCase(),
      process_category: aggScore.toLowerCase(),
      action_taken: highestAction,
      message: `Single process failure: ${breaches.length} stages breached in "${def.name}". Aggregate risk score: ${aggScore}.`,
      status: 'active',
    });
  }

  // Condition 2: Multi-process system failure — 3+ total processes have active breaches
  // Query all active individual alerts grouped by process_run_id
  const { data: allActiveAlerts } = await supabase
    .from('risk_alerts')
    .select('process_run_id, process_category')
    .eq('status', 'active')
    .eq('alert_type', 'individual');

  if (allActiveAlerts) {
    // Group by process_run_id to find unique breached processes
    const breachedProcessRuns = new Map<string, string[]>();
    for (const a of allActiveAlerts) {
      const runId = a.process_run_id as string;
      if (!runId) continue;
      if (!breachedProcessRuns.has(runId)) {
        breachedProcessRuns.set(runId, []);
      }
      const cats = breachedProcessRuns.get(runId)!;
      if (a.process_category) cats.push(a.process_category);
    }

    if (breachedProcessRuns.size >= 3) {
      // Get process definition names for the breached runs
      const runIds = Array.from(breachedProcessRuns.keys());
      const { data: runDefs } = await supabase
        .from('process_runs')
        .select('id, process_definition_id')
        .in('id', runIds);

      // Get definition names
      const defIds = Array.from(new Set((runDefs ?? []).map((r) => r.process_definition_id).filter(Boolean))) as string[];
      let defNames: Record<string, string> = {};
      if (defIds.length > 0) {
        const { data: defs } = await supabase
          .from('process_definitions')
          .select('id, name')
          .in('id', defIds);
        if (defs) {
          for (const d of defs) {
            defNames[d.id] = d.name;
          }
        }
      }

      // Collect all categories for aggregate score
      const allCategories: string[] = [];
      for (const cats of breachedProcessRuns.values()) {
        allCategories.push(...cats);
      }
      const aggScore = aggregateRiskScore(allCategories);

      // Check if we already have a multi-process collective alert active
      const { data: existingMulti } = await supabase
        .from('risk_alerts')
        .select('id')
        .eq('alert_type', 'collective')
        .eq('status', 'active')
        .ilike('message', 'Multi-process system failure%');

      if (!existingMulti || existingMulti.length === 0) {
        collectiveAlerts.push({
          alert_type: 'collective',
          process_run_id: null,
          stage_index: -1,
          employee_id: employeeId,
          severity_level: aggScore.toLowerCase(),
          process_category: aggScore.toLowerCase(),
          action_taken: 'alert',
          message: `Multi-process system failure: ${breachedProcessRuns.size} processes breaching simultaneously. Aggregate risk score: ${aggScore}.`,
          status: 'active',
        });
      }
    }
  }

  // Insert collective alerts
  if (collectiveAlerts.length > 0) {
    const { error: collectiveError } = await supabase
      .from('risk_alerts')
      .insert(collectiveAlerts);
    if (collectiveError) {
      console.error('Failed to insert collective alerts:', collectiveError);
    }
  }

  return {
    individualCount: individualAlerts.length,
    collectiveCount: collectiveAlerts.length,
    highestAction,
  };
}

/**
 * Fetch the current critical system risk state for banner display.
 * Returns null if no multi-process failure is active.
 */
export async function fetchCriticalSystemRisk(): Promise<{
  breachedProcessCount: number;
  aggregateScore: string;
} | null> {
  // Count unique processes with active individual alerts
  const { data: activeAlerts } = await supabase
    .from('risk_alerts')
    .select('process_run_id, process_category')
    .eq('status', 'active')
    .eq('alert_type', 'individual');

  if (!activeAlerts || activeAlerts.length === 0) return null;

  const breachedProcessRuns = new Map<string, string[]>();
  for (const a of activeAlerts) {
    const runId = a.process_run_id as string;
    if (!runId) continue;
    if (!breachedProcessRuns.has(runId)) {
      breachedProcessRuns.set(runId, []);
    }
    if (a.process_category) {
      breachedProcessRuns.get(runId)!.push(a.process_category);
    }
  }

  if (breachedProcessRuns.size < 3) return null;

  const allCategories: string[] = [];
  for (const cats of breachedProcessRuns.values()) {
    allCategories.push(...cats);
  }

  return {
    breachedProcessCount: breachedProcessRuns.size,
    aggregateScore: aggregateRiskScore(allCategories),
  };
}
