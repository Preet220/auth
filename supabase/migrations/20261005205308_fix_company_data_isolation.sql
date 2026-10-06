/*
# Fix Company Data Isolation

## Problem
Data from one company was visible to other companies. Most tables had
`USING (true)` RLS policies that allowed any authenticated user to see
ALL rows regardless of which company they belong to.

## Changes

### 1. Add company_id column to 10 tables
Added `company_id uuid` column to:
- qr_codes
- scan_records
- process_runs
- process_definitions
- custom_fields
- custom_qr_types
- risk_rules
- risk_alerts
- customer_activity_logs
- seals

### 2. Auto-set company_id on insert (trigger)
Created a trigger function `set_company_id_on_insert()` that calls
`get_my_company_id()` to automatically populate company_id for new rows.
Attached to all 10 tables.

### 3. Replace open RLS policies with company-scoped policies
Every `USING (true)` policy on the 10 tables has been replaced with:
- SELECT: company_id = get_my_company_id() (or is_master())
- INSERT: WITH CHECK (company_id = get_my_company_id() OR is_master())
  Note: company_id is auto-set by trigger, so client doesn't need to pass it
- UPDATE: company_id = get_my_company_id() (or is_master())
- DELETE: company_id = get_my_company_id() (or is_master())

### 4. risk_rules special handling
Built-in rules (is_builtin = true) are shared across all companies.
Custom rules are scoped to the company that created them.

### 5. Fix companies table SELECT
Was `USING (true)` — now scoped to own company (user_id = auth.uid())
or master accounts. Also allows selecting by company_id match.

### 6. Fix other open policies
- app_settings: scoped to own company via id = get_my_company_id()
- password_reset_requests: scoped to own company
- license_validations: scoped to own company
- license_cache: scoped to own company
- customer_activity_logs: scoped to own company

### 7. Backfill existing data
Existing rows in risk_rules (7 built-in rules) get company_id = NULL
which is correct for shared built-in rules. All other tables are empty.

## Security
- RLS remains enabled on all tables.
- No data is lost — only policies are tightened.
- Master accounts retain full access via is_master() checks.
*/

-- ============================================================
-- STEP 1: Add company_id column to all company-scoped tables
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'qr_codes' AND column_name = 'company_id') THEN
    ALTER TABLE public.qr_codes ADD COLUMN company_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scan_records' AND column_name = 'company_id') THEN
    ALTER TABLE public.scan_records ADD COLUMN company_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'process_runs' AND column_name = 'company_id') THEN
    ALTER TABLE public.process_runs ADD COLUMN company_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'process_definitions' AND column_name = 'company_id') THEN
    ALTER TABLE public.process_definitions ADD COLUMN company_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'custom_fields' AND column_name = 'company_id') THEN
    ALTER TABLE public.custom_fields ADD COLUMN company_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'custom_qr_types' AND column_name = 'company_id') THEN
    ALTER TABLE public.custom_qr_types ADD COLUMN company_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'risk_rules' AND column_name = 'company_id') THEN
    ALTER TABLE public.risk_rules ADD COLUMN company_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'risk_alerts' AND column_name = 'company_id') THEN
    ALTER TABLE public.risk_alerts ADD COLUMN company_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customer_activity_logs' AND column_name = 'company_id') THEN
    ALTER TABLE public.customer_activity_logs ADD COLUMN company_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'seals' AND column_name = 'company_id') THEN
    ALTER TABLE public.seals ADD COLUMN company_id uuid;
  END IF;
END $$;

-- ============================================================
-- STEP 2: Create trigger function to auto-set company_id
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_company_id_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.get_my_company_id();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_company_id_on_insert() FROM anon;

-- ============================================================
-- STEP 3: Attach triggers to all company-scoped tables
-- ============================================================

DROP TRIGGER IF EXISTS trg_set_company_id_qr_codes ON public.qr_codes;
CREATE TRIGGER trg_set_company_id_qr_codes
  BEFORE INSERT ON public.qr_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP TRIGGER IF EXISTS trg_set_company_id_scan_records ON public.scan_records;
CREATE TRIGGER trg_set_company_id_scan_records
  BEFORE INSERT ON public.scan_records
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP TRIGGER IF EXISTS trg_set_company_id_process_runs ON public.process_runs;
CREATE TRIGGER trg_set_company_id_process_runs
  BEFORE INSERT ON public.process_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP TRIGGER IF EXISTS trg_set_company_id_process_definitions ON public.process_definitions;
CREATE TRIGGER trg_set_company_id_process_definitions
  BEFORE INSERT ON public.process_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP TRIGGER IF EXISTS trg_set_company_id_custom_fields ON public.custom_fields;
CREATE TRIGGER trg_set_company_id_custom_fields
  BEFORE INSERT ON public.custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP TRIGGER IF EXISTS trg_set_company_id_custom_qr_types ON public.custom_qr_types;
CREATE TRIGGER trg_set_company_id_custom_qr_types
  BEFORE INSERT ON public.custom_qr_types
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP TRIGGER IF EXISTS trg_set_company_id_risk_rules ON public.risk_rules;
CREATE TRIGGER trg_set_company_id_risk_rules
  BEFORE INSERT ON public.risk_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP TRIGGER IF EXISTS trg_set_company_id_risk_alerts ON public.risk_alerts;
CREATE TRIGGER trg_set_company_id_risk_alerts
  BEFORE INSERT ON public.risk_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP TRIGGER IF EXISTS trg_set_company_id_activity_logs ON public.customer_activity_logs;
CREATE TRIGGER trg_set_company_id_activity_logs
  BEFORE INSERT ON public.customer_activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP TRIGGER IF EXISTS trg_set_company_id_seals ON public.seals;
CREATE TRIGGER trg_set_company_id_seals
  BEFORE INSERT ON public.seals
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

-- ============================================================
-- STEP 4: Create indexes on company_id for performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_qr_codes_company_id ON public.qr_codes(company_id);
CREATE INDEX IF NOT EXISTS idx_scan_records_company_id ON public.scan_records(company_id);
CREATE INDEX IF NOT EXISTS idx_process_runs_company_id ON public.process_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_process_definitions_company_id ON public.process_definitions(company_id);
CREATE INDEX IF NOT EXISTS idx_custom_fields_company_id ON public.custom_fields(company_id);
CREATE INDEX IF NOT EXISTS idx_custom_qr_types_company_id ON public.custom_qr_types(company_id);
CREATE INDEX IF NOT EXISTS idx_risk_rules_company_id ON public.risk_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_company_id ON public.risk_alerts(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_company_id ON public.customer_activity_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_seals_company_id ON public.seals(company_id);

-- ============================================================
-- STEP 5: Replace RLS policies — qr_codes
-- ============================================================

DROP POLICY IF EXISTS "select_qr_codes" ON public.qr_codes;
DROP POLICY IF EXISTS "insert_qr_codes" ON public.qr_codes;
DROP POLICY IF EXISTS "update_qr_codes" ON public.qr_codes;
DROP POLICY IF EXISTS "delete_qr_codes" ON public.qr_codes;

CREATE POLICY "select_qr_codes" ON public.qr_codes FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_qr_codes" ON public.qr_codes FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_qr_codes" ON public.qr_codes FOR UPDATE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()))
  WITH CHECK (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "delete_qr_codes" ON public.qr_codes FOR DELETE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

-- ============================================================
-- STEP 6: Replace RLS policies — scan_records
-- ============================================================

DROP POLICY IF EXISTS "select_scan_records" ON public.scan_records;
DROP POLICY IF EXISTS "insert_scan_records" ON public.scan_records;
DROP POLICY IF EXISTS "update_scan_records" ON public.scan_records;
DROP POLICY IF EXISTS "delete_scan_records" ON public.scan_records;

CREATE POLICY "select_scan_records" ON public.scan_records FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_scan_records" ON public.scan_records FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_scan_records" ON public.scan_records FOR UPDATE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()))
  WITH CHECK (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "delete_scan_records" ON public.scan_records FOR DELETE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

-- ============================================================
-- STEP 7: Replace RLS policies — process_runs
-- ============================================================

DROP POLICY IF EXISTS "select_process_runs" ON public.process_runs;
DROP POLICY IF EXISTS "insert_process_runs" ON public.process_runs;
DROP POLICY IF EXISTS "update_process_runs" ON public.process_runs;
DROP POLICY IF EXISTS "delete_process_runs" ON public.process_runs;

CREATE POLICY "select_process_runs" ON public.process_runs FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_process_runs" ON public.process_runs FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_process_runs" ON public.process_runs FOR UPDATE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()))
  WITH CHECK (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "delete_process_runs" ON public.process_runs FOR DELETE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

-- ============================================================
-- STEP 8: Replace RLS policies — process_definitions
-- ============================================================

DROP POLICY IF EXISTS "select_process_definitions" ON public.process_definitions;
DROP POLICY IF EXISTS "insert_process_definitions" ON public.process_definitions;
DROP POLICY IF EXISTS "update_process_definitions" ON public.process_definitions;
DROP POLICY IF EXISTS "delete_process_definitions" ON public.process_definitions;

CREATE POLICY "select_process_definitions" ON public.process_definitions FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_process_definitions" ON public.process_definitions FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_process_definitions" ON public.process_definitions FOR UPDATE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()))
  WITH CHECK (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "delete_process_definitions" ON public.process_definitions FOR DELETE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

-- ============================================================
-- STEP 9: Replace RLS policies — custom_fields
-- ============================================================

DROP POLICY IF EXISTS "select_custom_fields" ON public.custom_fields;
DROP POLICY IF EXISTS "insert_custom_fields" ON public.custom_fields;
DROP POLICY IF EXISTS "update_custom_fields" ON public.custom_fields;
DROP POLICY IF EXISTS "delete_custom_fields" ON public.custom_fields;

CREATE POLICY "select_custom_fields" ON public.custom_fields FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_custom_fields" ON public.custom_fields FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_custom_fields" ON public.custom_fields FOR UPDATE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()))
  WITH CHECK (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "delete_custom_fields" ON public.custom_fields FOR DELETE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

-- ============================================================
-- STEP 10: Replace RLS policies — custom_qr_types
-- ============================================================

DROP POLICY IF EXISTS "select_custom_qr_types" ON public.custom_qr_types;
DROP POLICY IF EXISTS "insert_custom_qr_types" ON public.custom_qr_types;
DROP POLICY IF EXISTS "update_custom_qr_types" ON public.custom_qr_types;
DROP POLICY IF EXISTS "delete_custom_qr_types" ON public.custom_qr_types;

CREATE POLICY "select_custom_qr_types" ON public.custom_qr_types FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_custom_qr_types" ON public.custom_qr_types FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_custom_qr_types" ON public.custom_qr_types FOR UPDATE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()))
  WITH CHECK (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "delete_custom_qr_types" ON public.custom_qr_types FOR DELETE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

-- ============================================================
-- STEP 11: Replace RLS policies — risk_rules
-- Built-in rules (is_builtin = true, company_id IS NULL) are shared.
-- Custom rules are company-scoped.
-- ============================================================

DROP POLICY IF EXISTS "select_risk_rules" ON public.risk_rules;
DROP POLICY IF EXISTS "insert_risk_rules" ON public.risk_rules;
DROP POLICY IF EXISTS "update_risk_rules" ON public.risk_rules;
DROP POLICY IF EXISTS "delete_risk_rules" ON public.risk_rules;

CREATE POLICY "select_risk_rules" ON public.risk_rules FOR SELECT
  TO authenticated
  USING (
    is_master()
    OR is_builtin = true
    OR (company_id IS NOT NULL AND company_id = get_my_company_id())
  );

CREATE POLICY "insert_risk_rules" ON public.risk_rules FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_risk_rules" ON public.risk_rules FOR UPDATE
  TO authenticated
  USING (
    is_master()
    OR (company_id IS NOT NULL AND company_id = get_my_company_id())
  )
  WITH CHECK (
    is_master()
    OR (company_id IS NOT NULL AND company_id = get_my_company_id())
  );

CREATE POLICY "delete_risk_rules" ON public.risk_rules FOR DELETE
  TO authenticated
  USING (
    is_master()
    OR (company_id IS NOT NULL AND company_id = get_my_company_id())
  );

-- ============================================================
-- STEP 12: Replace RLS policies — risk_alerts
-- ============================================================

DROP POLICY IF EXISTS "select_risk_alerts" ON public.risk_alerts;
DROP POLICY IF EXISTS "insert_risk_alerts" ON public.risk_alerts;
DROP POLICY IF EXISTS "update_risk_alerts" ON public.risk_alerts;

CREATE POLICY "select_risk_alerts" ON public.risk_alerts FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_risk_alerts" ON public.risk_alerts FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_risk_alerts" ON public.risk_alerts FOR UPDATE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()))
  WITH CHECK (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

-- ============================================================
-- STEP 13: Replace RLS policies — customer_activity_logs
-- ============================================================

DROP POLICY IF EXISTS "select_customer_activity_logs" ON public.customer_activity_logs;
DROP POLICY IF EXISTS "insert_customer_activity_logs" ON public.customer_activity_logs;

CREATE POLICY "select_customer_activity_logs" ON public.customer_activity_logs FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_customer_activity_logs" ON public.customer_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

-- ============================================================
-- STEP 14: Replace RLS policies — seals
-- ============================================================

DROP POLICY IF EXISTS "select_seals" ON public.seals;
DROP POLICY IF EXISTS "insert_seals" ON public.seals;
DROP POLICY IF EXISTS "update_seals" ON public.seals;
DROP POLICY IF EXISTS "delete_seals" ON public.seals;

CREATE POLICY "select_seals" ON public.seals FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_seals" ON public.seals FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_seals" ON public.seals FOR UPDATE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()))
  WITH CHECK (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "delete_seals" ON public.seals FOR DELETE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

-- ============================================================
-- STEP 15: Fix companies table SELECT policy
-- Was USING(true) — now scoped to own company or master
-- ============================================================

DROP POLICY IF EXISTS "select_companies" ON public.companies;

CREATE POLICY "select_companies" ON public.companies FOR SELECT
  TO authenticated
  USING (
    is_master()
    OR user_id = auth.uid()
    OR id = get_my_company_id()
  );

-- ============================================================
-- STEP 16: Fix app_settings SELECT policy
-- id column stores the company_id
-- ============================================================

DROP POLICY IF EXISTS "select_app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "update_app_settings" ON public.app_settings;

CREATE POLICY "select_app_settings" ON public.app_settings FOR SELECT
  TO authenticated
  USING (is_master() OR id = get_my_company_id());

CREATE POLICY "update_app_settings" ON public.app_settings FOR UPDATE
  TO authenticated
  USING (is_master() OR id = get_my_company_id())
  WITH CHECK (is_master() OR id = get_my_company_id());

-- ============================================================
-- STEP 17: Fix license_cache policies
-- id column stores the company_id
-- ============================================================

DROP POLICY IF EXISTS "select_license_cache" ON public.license_cache;
DROP POLICY IF EXISTS "update_license_cache" ON public.license_cache;

CREATE POLICY "select_license_cache" ON public.license_cache FOR SELECT
  TO authenticated
  USING (is_master() OR id = get_my_company_id());

CREATE POLICY "update_license_cache" ON public.license_cache FOR UPDATE
  TO authenticated
  USING (is_master() OR id = get_my_company_id())
  WITH CHECK (is_master() OR id = get_my_company_id());

-- ============================================================
-- STEP 18: Fix password_reset_requests policies
-- Needs company_id column for isolation
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'password_reset_requests' AND column_name = 'company_id') THEN
    ALTER TABLE public.password_reset_requests ADD COLUMN company_id uuid;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_password_reset_company_id ON public.password_reset_requests(company_id);

DROP TRIGGER IF EXISTS trg_set_company_id_password_reset ON public.password_reset_requests;
CREATE TRIGGER trg_set_company_id_password_reset
  BEFORE INSERT ON public.password_reset_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_company_id_on_insert();

DROP POLICY IF EXISTS "select_password_reset_requests" ON public.password_reset_requests;
DROP POLICY IF EXISTS "insert_password_reset_requests" ON public.password_reset_requests;
DROP POLICY IF EXISTS "update_password_reset_requests" ON public.password_reset_requests;

CREATE POLICY "select_password_reset_requests" ON public.password_reset_requests FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_password_reset_requests" ON public.password_reset_requests FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

CREATE POLICY "update_password_reset_requests" ON public.password_reset_requests FOR UPDATE
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()))
  WITH CHECK (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

-- ============================================================
-- STEP 19: Fix license_validations policies
-- Already has company_id column — just fix the policies
-- ============================================================

DROP POLICY IF EXISTS "insert_license_validations" ON public.license_validations;
DROP POLICY IF EXISTS "select_license_validations" ON public.license_validations;

CREATE POLICY "select_license_validations" ON public.license_validations FOR SELECT
  TO authenticated
  USING (is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()));

CREATE POLICY "insert_license_validations" ON public.license_validations FOR INSERT
  TO authenticated
  WITH CHECK (is_master() OR company_id = get_my_company_id());

-- ============================================================
-- STEP 20: Backfill risk_rules built-in rows
-- Set company_id = NULL for built-in rules (shared across all companies)
-- ============================================================

UPDATE public.risk_rules SET company_id = NULL WHERE is_builtin = true AND company_id IS NULL;
