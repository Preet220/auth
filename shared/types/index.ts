// Shared types used by both the licensing service and the customer app

export type UserRole = 'master' | 'company' | 'admin' | 'employee';

export type LicenseStatus = 'active' | 'expired' | 'suspended' | 'deactivated';

export type SubscriptionTier = 'starter' | 'professional' | 'enterprise';

export interface Company {
  id: string;
  company_name: string;
  license_key: string;
  license_status: LicenseStatus;
  subscription_tier: SubscriptionTier;
  subscription_start: string;
  subscription_end: string;
  admin_cap: number;
  employee_cap: number;
  email: string | null;
  user_id: string | null;
  created_at: string;
}

export interface LicenseValidation {
  company_id: string;
  status: LicenseStatus;
  admin_cap: number;
  employee_cap: number;
  signed_response: string;
  valid_until: string;
}

export interface LicenseValidationLog {
  id: string;
  company_id: string;
  source_ip: string;
  result: LicenseStatus;
  timestamp: string;
}

export interface Admin {
  id: string;
  work_email: string;
  admin_name: string;
  employee_id: string | null;
  status: 'pending' | 'approved' | 'removed';
  created_by: string;
  created_at: string;
  company_id: string | null;
  user_id: string | null;
}

export interface Employee {
  id: string;
  work_email: string;
  employee_name: string;
  employee_id: string;
  status: 'active' | 'pending' | 'removed';
  first_sign_in_completed: boolean;
  created_at: string;
  company_id: string | null;
  user_id: string | null;
}

export type QrCodeType = 'checkpoint' | 'item' | 'trolley' | 'seal' | string;

export interface QrCode {
  id: string;
  type: QrCodeType;
  value: string;
  details: Record<string, unknown>;
  origin: 'app_generated' | 'externally_registered';
  created_by_admin: string;
  created_at: string;
}

export type CustomFieldInputType =
  | 'short_text'
  | 'number'
  | 'multiple_choice'
  | 'date'
  | 'photo'
  | 'signature'
  | 'boolean';

export interface CustomField {
  id: string;
  label: string;
  input_type: CustomFieldInputType;
  options: string[];
  scan_type: QrCodeType;
  required: boolean;
  created_at: string;
}

export interface ScanRecord {
  id: string;
  qr_code_id: string;
  scan_type: QrCodeType;
  qr_value: string;
  employee_id: string;
  employee_name: string;
  employee_user_id: string;
  checkpoint_name: string;
  location: string;
  item_type: string;
  trolley_id: string;
  seal_serial: string;
  weight: number | null;
  weight_source: 'auto' | 'manual';
  photo_required_at_submission: boolean;
  photo_url: string;
  custom_field_values: Record<string, unknown>;
  process_run_id: string | null;
  timestamp: string;
}

export type ProcessCategory = 'critical' | 'high' | 'moderate' | 'low';

export interface ProcessStage {
  id: string;
  type: QrCodeType;
  label: string;
  qr_code_id?: string;
}

export interface ProcessDefinition {
  id: string;
  name: string;
  category: ProcessCategory;
  stages: ProcessStage[];
  created_by_admin: string;
  created_at: string;
}

export type ProcessRunStatus = 'in_progress' | 'completed' | 'breached' | 'blocked';

export interface BatchItem {
  qr_code_id: string;
  item_type: string;
  start_weight: number;
  end_weight: number | null;
}

export interface ProcessRun {
  id: string;
  process_definition_id: string;
  employee_id: string;
  employee_name: string;
  status: ProcessRunStatus;
  started_at: string;
  completed_at: string | null;
  time_limit_minutes: number;
  batch_items: BatchItem[];
  start_total_weight: number;
  end_total_weight: number | null;
  reconciliation_result: Record<string, unknown> | null;
}

export type SeverityModel = 'multi_level' | 'pass_fail';
export type RuleAction = 'block' | 'alert' | 'warn';

export interface RiskRule {
  id: string;
  name: string;
  rule_type: string;
  severity_model: SeverityModel;
  thresholds: Record<string, number>;
  scope: string;
  action: RuleAction;
  attached_stage_ids: string[];
  created_at: string;
}

export type AlertType = 'individual' | 'collective';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface RiskAlert {
  id: string;
  risk_rule_id: string;
  process_run_id: string;
  stage_index: number;
  employee_id: string;
  severity_level: string;
  process_category: ProcessCategory;
  alert_type: AlertType;
  action_taken: RuleAction;
  message: string;
  status: AlertStatus;
  timestamp: string;
}

export interface Seal {
  id: string;
  seal_serial: string;
  qr_value: string;
  origin: 'app_generated' | 'externally_registered';
  batch_number: string;
  manufacturing_specs: Record<string, unknown>;
  registered_by_admin: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  actor_id: string;
  actor_email: string;
  actor_role: UserRole;
  action: string;
  details: Record<string, unknown> | null;
  timestamp: string;
}

export interface PasswordResetRequest {
  id: string;
  employee_id: string;
  status: 'pending' | 'approved' | 'denied';
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface AppSettings {
  photo_required: boolean;
  default_process_time_limit: number;
}

export interface LicenseCache {
  id: string;
  license_status: LicenseStatus;
  admin_cap: number;
  employee_cap: number;
  last_validated_at: string;
  grace_period_hours: number;
}

export interface AuthSession {
  token: string;
  role: UserRole;
  user_id: string;
  email: string;
  name: string;
}
