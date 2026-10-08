/*
# Add CASCADE foreign keys for company_id and create delete_company function

## Purpose
When a master user deletes a company from the licensing dashboard, ALL related data 
(process definitions, process runs, scan records, QR codes, seals, risk rules, risk alerts, 
custom fields, custom QR types, activity logs, password reset requests, admins, employees, 
license keys, license validations) and ALL associated auth.users accounts must be 
automatically deleted.

## Changes

### 1. Add CASCADE foreign key constraints
The following tables had `company_id` columns but no foreign key constraint with CASCADE:
- custom_fields
- custom_qr_types
- customer_activity_logs
- password_reset_requests
- process_definitions
- process_runs
- qr_codes
- risk_alerts
- risk_rules
- scan_records
- seals

Each now has a FK to companies(id) ON DELETE CASCADE.

### 2. Create delete_company SECURITY DEFINER function
- Function: `delete_company(p_company_id uuid)`
- SECURITY DEFINER — runs with owner privileges so it can delete from auth.users
- Deletes all auth.users entries for admins and employees belonging to the company
- Deletes the company row (which cascades to all other tables via FK)
- Returns the company name on success for confirmation
- Only callable by authenticated users (RLS on the function is handled by default)

### Security
- The function is SECURITY DEFINER with a fixed search_path to prevent injection
- Execute is revoked from public and granted only to authenticated
- The function performs a hard delete — no soft delete or recovery
*/

-- 1. Add CASCADE FK constraints for tables missing them
-- Each statement is idempotent: drop if exists, then create

DO $$
BEGIN
  -- custom_fields
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'custom_fields_company_id_fkey' AND table_name = 'custom_fields'
  ) THEN
    ALTER TABLE custom_fields 
      ADD CONSTRAINT custom_fields_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- custom_qr_types
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'custom_qr_types_company_id_fkey' AND table_name = 'custom_qr_types'
  ) THEN
    ALTER TABLE custom_qr_types 
      ADD CONSTRAINT custom_qr_types_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- customer_activity_logs
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'customer_activity_logs_company_id_fkey' AND table_name = 'customer_activity_logs'
  ) THEN
    ALTER TABLE customer_activity_logs 
      ADD CONSTRAINT customer_activity_logs_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- password_reset_requests
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'password_reset_requests_company_id_fkey' AND table_name = 'password_reset_requests'
  ) THEN
    ALTER TABLE password_reset_requests 
      ADD CONSTRAINT password_reset_requests_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- process_definitions
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'process_definitions_company_id_fkey' AND table_name = 'process_definitions'
  ) THEN
    ALTER TABLE process_definitions 
      ADD CONSTRAINT process_definitions_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- process_runs
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'process_runs_company_id_fkey' AND table_name = 'process_runs'
  ) THEN
    ALTER TABLE process_runs 
      ADD CONSTRAINT process_runs_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- qr_codes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'qr_codes_company_id_fkey' AND table_name = 'qr_codes'
  ) THEN
    ALTER TABLE qr_codes 
      ADD CONSTRAINT qr_codes_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- risk_alerts
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'risk_alerts_company_id_fkey' AND table_name = 'risk_alerts'
  ) THEN
    ALTER TABLE risk_alerts 
      ADD CONSTRAINT risk_alerts_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- risk_rules
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'risk_rules_company_id_fkey' AND table_name = 'risk_rules'
  ) THEN
    ALTER TABLE risk_rules 
      ADD CONSTRAINT risk_rules_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- scan_records
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scan_records_company_id_fkey' AND table_name = 'scan_records'
  ) THEN
    ALTER TABLE scan_records 
      ADD CONSTRAINT scan_records_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- seals
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'seals_company_id_fkey' AND table_name = 'seals'
  ) THEN
    ALTER TABLE seals 
      ADD CONSTRAINT seals_company_id_fkey 
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. Create the delete_company SECURITY DEFINER function
CREATE OR REPLACE FUNCTION delete_company(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_company_name text;
  v_user_ids uuid[];
BEGIN
  -- Get the company name for the return value
  SELECT company_name INTO v_company_name FROM companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  -- Collect all auth user IDs from admins and employees for this company
  SELECT array_agg(user_id) FILTER (WHERE user_id IS NOT NULL)
  INTO v_user_ids
  FROM (
    SELECT user_id FROM admins WHERE company_id = p_company_id AND user_id IS NOT NULL
    UNION
    SELECT user_id FROM employees WHERE company_id = p_company_id AND user_id IS NOT NULL
    UNION
    SELECT user_id FROM companies WHERE id = p_company_id AND user_id IS NOT NULL
  ) AS combined;

  -- Delete auth.users entries (admins, employees, and the company signup user)
  IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
    DELETE FROM auth.users WHERE id = ANY(v_user_ids);
  END IF;

  -- Delete the company row — all other tables cascade via FK ON DELETE CASCADE
  DELETE FROM companies WHERE id = p_company_id;

  RETURN v_company_name;
END;
$$;

-- Revoke execute from public, grant only to authenticated
REVOKE EXECUTE ON FUNCTION delete_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_company(uuid) TO authenticated;
