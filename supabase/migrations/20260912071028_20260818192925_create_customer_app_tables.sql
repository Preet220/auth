/*
# Customer App Tables

All tables for the customer app: admins, employees, qr_codes, seals,
custom_fields, scan_records, process_definitions, process_runs,
risk_rules, risk_alerts, activity_logs, password_reset_requests,
app_settings, license_cache.

This is a single-tenant deployment. One database = one organization.
RLS is enabled on all tables with authenticated-only access.
*/

-- Admins table
CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  work_email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  work_email text NOT NULL UNIQUE,
  name text NOT NULL,
  employee_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  first_sign_in_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- QR codes table
CREATE TABLE IF NOT EXISTS qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  value text NOT NULL UNIQUE,
  details jsonb NOT NULL DEFAULT '{}',
  origin text NOT NULL DEFAULT 'app_generated',
  created_by_admin text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;

-- Seals table
CREATE TABLE IF NOT EXISTS seals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seal_serial text NOT NULL UNIQUE,
  qr_value text,
  origin text NOT NULL DEFAULT 'app_generated',
  batch_number text,
  manufacturing_specs jsonb NOT NULL DEFAULT '{}',
  registered_by_admin text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE seals ENABLE ROW LEVEL SECURITY;

-- Custom fields table
CREATE TABLE IF NOT EXISTS custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  input_type text NOT NULL DEFAULT 'short_text',
  options jsonb NOT NULL DEFAULT '[]',
  scan_type text NOT NULL DEFAULT 'checkpoint',
  required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

-- Scan records table
CREATE TABLE IF NOT EXISTS scan_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id uuid REFERENCES qr_codes(id) ON DELETE SET NULL,
  scan_type text NOT NULL,
  qr_value text NOT NULL,
  employee_id text NOT NULL DEFAULT '',
  employee_name text NOT NULL DEFAULT '',
  employee_user_id text NOT NULL DEFAULT '',
  checkpoint_name text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  item_type text NOT NULL DEFAULT '',
  trolley_id text NOT NULL DEFAULT '',
  seal_serial text NOT NULL DEFAULT '',
  weight numeric,
  weight_source text NOT NULL DEFAULT 'manual',
  photo_required_at_submission boolean NOT NULL DEFAULT false,
  photo_url text NOT NULL DEFAULT '',
  custom_field_values jsonb NOT NULL DEFAULT '{}',
  process_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scan_records ENABLE ROW LEVEL SECURITY;

-- Process definitions table
CREATE TABLE IF NOT EXISTS process_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'moderate',
  stages jsonb NOT NULL DEFAULT '[]',
  created_by_admin text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE process_definitions ENABLE ROW LEVEL SECURITY;

-- Process runs table
CREATE TABLE IF NOT EXISTS process_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_definition_id uuid REFERENCES process_definitions(id) ON DELETE SET NULL,
  employee_id text NOT NULL DEFAULT '',
  employee_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  time_limit_minutes integer NOT NULL DEFAULT 120,
  batch_items jsonb NOT NULL DEFAULT '[]',
  start_total_weight numeric NOT NULL DEFAULT 0,
  end_total_weight numeric,
  reconciliation_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE process_runs ENABLE ROW LEVEL SECURITY;

-- Risk rules table
CREATE TABLE IF NOT EXISTS risk_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  rule_type text NOT NULL DEFAULT 'custom',
  severity_model text NOT NULL DEFAULT 'pass_fail',
  thresholds jsonb NOT NULL DEFAULT '{}',
  scope text NOT NULL DEFAULT 'process',
  attached_stage_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE risk_rules ENABLE ROW LEVEL SECURITY;

-- Risk alerts table
CREATE TABLE IF NOT EXISTS risk_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_rule_id uuid REFERENCES risk_rules(id) ON DELETE SET NULL,
  process_run_id uuid REFERENCES process_runs(id) ON DELETE CASCADE,
  stage_index integer NOT NULL DEFAULT 0,
  employee_id text NOT NULL DEFAULT '',
  severity_level text NOT NULL DEFAULT 'low',
  process_category text NOT NULL DEFAULT 'moderate',
  alert_type text NOT NULL DEFAULT 'individual',
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE risk_alerts ENABLE ROW LEVEL SECURITY;

-- Activity logs table
CREATE TABLE IF NOT EXISTS customer_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL DEFAULT '',
  actor_email text NOT NULL DEFAULT '',
  actor_role text NOT NULL DEFAULT '',
  action text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_activity_logs ENABLE ROW LEVEL SECURITY;

-- Password reset requests table
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  employee_email text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text NOT NULL DEFAULT ''
);

ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;

-- App settings table (singleton)
CREATE TABLE IF NOT EXISTS app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_required boolean NOT NULL DEFAULT false,
  default_process_time_limit integer NOT NULL DEFAULT 120,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- License cache table (singleton)
CREATE TABLE IF NOT EXISTS license_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_status text NOT NULL DEFAULT 'active',
  admin_cap integer NOT NULL DEFAULT 5,
  employee_cap integer NOT NULL DEFAULT 50,
  last_validated_at timestamptz NOT NULL DEFAULT now(),
  grace_period_hours integer NOT NULL DEFAULT 72
);

ALTER TABLE license_cache ENABLE ROW LEVEL SECURITY;

-- Now create policies for all customer tables (authenticated only)
-- Admins
DROP POLICY IF EXISTS "select_admins" ON admins;
CREATE POLICY "select_admins" ON admins FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_admins" ON admins;
CREATE POLICY "insert_admins" ON admins FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_admins" ON admins;
CREATE POLICY "update_admins" ON admins FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_admins" ON admins;
CREATE POLICY "delete_admins" ON admins FOR DELETE
  TO authenticated USING (true);

-- Employees
DROP POLICY IF EXISTS "select_employees" ON employees;
CREATE POLICY "select_employees" ON employees FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_employees" ON employees;
CREATE POLICY "insert_employees" ON employees FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_employees" ON employees;
CREATE POLICY "update_employees" ON employees FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_employees" ON employees;
CREATE POLICY "delete_employees" ON employees FOR DELETE
  TO authenticated USING (true);

-- QR codes
DROP POLICY IF EXISTS "select_qr_codes" ON qr_codes;
CREATE POLICY "select_qr_codes" ON qr_codes FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_qr_codes" ON qr_codes;
CREATE POLICY "insert_qr_codes" ON qr_codes FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_qr_codes" ON qr_codes;
CREATE POLICY "update_qr_codes" ON qr_codes FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_qr_codes" ON qr_codes;
CREATE POLICY "delete_qr_codes" ON qr_codes FOR DELETE
  TO authenticated USING (true);

-- Seals
DROP POLICY IF EXISTS "select_seals" ON seals;
CREATE POLICY "select_seals" ON seals FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_seals" ON seals;
CREATE POLICY "insert_seals" ON seals FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "delete_seals" ON seals;
CREATE POLICY "delete_seals" ON seals FOR DELETE
  TO authenticated USING (true);

-- Custom fields
DROP POLICY IF EXISTS "select_custom_fields" ON custom_fields;
CREATE POLICY "select_custom_fields" ON custom_fields FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_custom_fields" ON custom_fields;
CREATE POLICY "insert_custom_fields" ON custom_fields FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_custom_fields" ON custom_fields;
CREATE POLICY "update_custom_fields" ON custom_fields FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_custom_fields" ON custom_fields;
CREATE POLICY "delete_custom_fields" ON custom_fields FOR DELETE
  TO authenticated USING (true);

-- Scan records
DROP POLICY IF EXISTS "select_scan_records" ON scan_records;
CREATE POLICY "select_scan_records" ON scan_records FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_scan_records" ON scan_records;
CREATE POLICY "insert_scan_records" ON scan_records FOR INSERT
  TO authenticated WITH CHECK (true);

-- Process definitions
DROP POLICY IF EXISTS "select_process_definitions" ON process_definitions;
CREATE POLICY "select_process_definitions" ON process_definitions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_process_definitions" ON process_definitions;
CREATE POLICY "insert_process_definitions" ON process_definitions FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_process_definitions" ON process_definitions;
CREATE POLICY "update_process_definitions" ON process_definitions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_process_definitions" ON process_definitions;
CREATE POLICY "delete_process_definitions" ON process_definitions FOR DELETE
  TO authenticated USING (true);

-- Process runs
DROP POLICY IF EXISTS "select_process_runs" ON process_runs;
CREATE POLICY "select_process_runs" ON process_runs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_process_runs" ON process_runs;
CREATE POLICY "insert_process_runs" ON process_runs FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_process_runs" ON process_runs;
CREATE POLICY "update_process_runs" ON process_runs FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Risk rules
DROP POLICY IF EXISTS "select_risk_rules" ON risk_rules;
CREATE POLICY "select_risk_rules" ON risk_rules FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_risk_rules" ON risk_rules;
CREATE POLICY "insert_risk_rules" ON risk_rules FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_risk_rules" ON risk_rules;
CREATE POLICY "update_risk_rules" ON risk_rules FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_risk_rules" ON risk_rules;
CREATE POLICY "delete_risk_rules" ON risk_rules FOR DELETE
  TO authenticated USING (true);

-- Risk alerts
DROP POLICY IF EXISTS "select_risk_alerts" ON risk_alerts;
CREATE POLICY "select_risk_alerts" ON risk_alerts FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_risk_alerts" ON risk_alerts;
CREATE POLICY "insert_risk_alerts" ON risk_alerts FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_risk_alerts" ON risk_alerts;
CREATE POLICY "update_risk_alerts" ON risk_alerts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Activity logs
DROP POLICY IF EXISTS "select_customer_activity_logs" ON customer_activity_logs;
CREATE POLICY "select_customer_activity_logs" ON customer_activity_logs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_customer_activity_logs" ON customer_activity_logs;
CREATE POLICY "insert_customer_activity_logs" ON customer_activity_logs FOR INSERT
  TO authenticated WITH CHECK (true);

-- Password reset requests
DROP POLICY IF EXISTS "select_password_reset_requests" ON password_reset_requests;
CREATE POLICY "select_password_reset_requests" ON password_reset_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_password_reset_requests" ON password_reset_requests;
CREATE POLICY "insert_password_reset_requests" ON password_reset_requests FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_password_reset_requests" ON password_reset_requests;
CREATE POLICY "update_password_reset_requests" ON password_reset_requests FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- App settings
DROP POLICY IF EXISTS "select_app_settings" ON app_settings;
CREATE POLICY "select_app_settings" ON app_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "update_app_settings" ON app_settings;
CREATE POLICY "update_app_settings" ON app_settings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- License cache
DROP POLICY IF EXISTS "select_license_cache" ON license_cache;
CREATE POLICY "select_license_cache" ON license_cache FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "update_license_cache" ON license_cache;
CREATE POLICY "update_license_cache" ON license_cache FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Seed default app settings
INSERT INTO app_settings (photo_required, default_process_time_limit)
SELECT false, 120
WHERE NOT EXISTS (SELECT 1 FROM app_settings);

-- Seed default license cache
INSERT INTO license_cache (license_status, admin_cap, employee_cap, grace_period_hours)
SELECT 'active', 5, 50, 72
WHERE NOT EXISTS (SELECT 1 FROM license_cache);
