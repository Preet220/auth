/*
# Add company_id to employees and admins, plus extra columns and cross-role email uniqueness
# Originally migration 20260901233333
*/

-- Add company_id to employees and admins tables
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'company_id') THEN
    ALTER TABLE employees ADD COLUMN company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admins' AND column_name = 'company_id') THEN
    ALTER TABLE admins ADD COLUMN company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add email column to companies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'email') THEN
    ALTER TABLE companies ADD COLUMN email text;
  END IF;
END $$;

-- Add user_id to companies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'user_id') THEN
    ALTER TABLE companies ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add employee_name column to employees
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'employee_name') THEN
    ALTER TABLE employees ADD COLUMN employee_name text NOT NULL DEFAULT '';
  END IF;
END $$;

-- Add company_name column to companies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'company_name') THEN
    ALTER TABLE companies ADD COLUMN company_name text NOT NULL DEFAULT '';
  END IF;
END $$;

-- Sync company_name from name for existing rows
UPDATE companies SET company_name = name WHERE company_name = '' AND name IS NOT NULL;

-- Helper functions (create now since company_id columns exist)
CREATE OR REPLACE FUNCTION is_master() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM master_accounts WHERE user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION is_master() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION get_my_company_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM admins WHERE user_id = auth.uid() AND status = 'approved'
  UNION ALL
  SELECT company_id FROM employees WHERE user_id = auth.uid() AND status = 'active'
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION get_my_company_id() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION is_company_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND status = 'approved')
  OR EXISTS (SELECT 1 FROM companies WHERE user_id = auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION is_company_admin() FROM anon, authenticated;

-- master_accounts unique email
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'master_accounts_email_unique') THEN
    ALTER TABLE master_accounts ADD CONSTRAINT master_accounts_email_unique UNIQUE (email);
  END IF;
END $$;

-- master_accounts email enforcement trigger
CREATE OR REPLACE FUNCTION enforce_master_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE configured_email text;
BEGIN
  SELECT value INTO configured_email FROM app_config WHERE key = 'master_email';
  IF NEW.email != configured_email THEN
    RAISE EXCEPTION 'Master account email must be %.', configured_email USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_master_email ON master_accounts;
CREATE TRIGGER trg_enforce_master_email BEFORE INSERT ON master_accounts FOR EACH ROW EXECUTE FUNCTION enforce_master_email();
REVOKE EXECUTE ON FUNCTION enforce_master_email() FROM anon, authenticated;

-- Update employees status default
ALTER TABLE employees ALTER COLUMN status SET DEFAULT 'pending';

-- Harden RLS policies
-- companies
DROP POLICY IF EXISTS "select_companies" ON companies;
DROP POLICY IF EXISTS "insert_companies" ON companies;
DROP POLICY IF EXISTS "update_companies" ON companies;
DROP POLICY IF EXISTS "delete_companies" ON companies;
DROP POLICY IF EXISTS "Allow public company select" ON companies;
DROP POLICY IF EXISTS "Allow public license validation" ON companies;
CREATE POLICY "select_companies" ON companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_companies" ON companies FOR INSERT TO authenticated WITH CHECK (is_master());
CREATE POLICY "update_companies" ON companies FOR UPDATE TO authenticated USING (is_master() OR auth.uid() = user_id) WITH CHECK (is_master() OR auth.uid() = user_id);
CREATE POLICY "delete_companies" ON companies FOR DELETE TO authenticated USING (is_master());

-- license_keys
DROP POLICY IF EXISTS "select_license_keys" ON license_keys;
DROP POLICY IF EXISTS "insert_license_keys" ON license_keys;
DROP POLICY IF EXISTS "update_license_keys" ON license_keys;
DROP POLICY IF EXISTS "delete_license_keys" ON license_keys;
CREATE POLICY "select_license_keys" ON license_keys FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_license_keys" ON license_keys FOR INSERT TO authenticated WITH CHECK (is_master());
CREATE POLICY "update_license_keys" ON license_keys FOR UPDATE TO authenticated USING (is_master()) WITH CHECK (is_master());
CREATE POLICY "delete_license_keys" ON license_keys FOR DELETE TO authenticated USING (is_master());

-- admins
DROP POLICY IF EXISTS "select_admins" ON admins;
DROP POLICY IF EXISTS "insert_admins" ON admins;
DROP POLICY IF EXISTS "update_admins" ON admins;
DROP POLICY IF EXISTS "delete_admins" ON admins;
CREATE POLICY "select_admins" ON admins FOR SELECT TO authenticated USING (
  is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()) OR auth.uid() = user_id
);
CREATE POLICY "insert_admins" ON admins FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_admins" ON admins FOR UPDATE TO authenticated USING (is_master() OR is_company_admin() OR auth.uid() = user_id) WITH CHECK (is_master() OR is_company_admin() OR auth.uid() = user_id);
CREATE POLICY "delete_admins" ON admins FOR DELETE TO authenticated USING (is_master() OR is_company_admin());

-- employees
DROP POLICY IF EXISTS "select_employees" ON employees;
DROP POLICY IF EXISTS "insert_employees" ON employees;
DROP POLICY IF EXISTS "update_employees" ON employees;
DROP POLICY IF EXISTS "delete_employees" ON employees;
CREATE POLICY "select_employees" ON employees FOR SELECT TO authenticated USING (
  is_master() OR (company_id IS NOT NULL AND company_id = get_my_company_id()) OR auth.uid() = user_id
);
CREATE POLICY "insert_employees" ON employees FOR INSERT TO authenticated WITH CHECK (is_master() OR is_company_admin());
CREATE POLICY "update_employees" ON employees FOR UPDATE TO authenticated USING (is_master() OR is_company_admin() OR auth.uid() = user_id) WITH CHECK (is_master() OR is_company_admin() OR auth.uid() = user_id);
CREATE POLICY "delete_employees" ON employees FOR DELETE TO authenticated USING (is_master() OR is_company_admin());

-- master_accounts delete
DROP POLICY IF EXISTS "delete_master_accounts" ON master_accounts;
CREATE POLICY "delete_master_accounts" ON master_accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Cross-role email uniqueness triggers
CREATE OR REPLACE FUNCTION public.check_cross_role_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'admins' THEN
    IF EXISTS (SELECT 1 FROM employees WHERE work_email = NEW.work_email) THEN
      RAISE EXCEPTION 'Email % is already registered as an employee.', NEW.work_email USING ERRCODE = 'unique_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'employees' THEN
    IF EXISTS (SELECT 1 FROM admins WHERE work_email = NEW.work_email) THEN
      RAISE EXCEPTION 'Email % is already registered as an admin.', NEW.work_email USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE email = NEW.work_email) THEN
    RAISE EXCEPTION 'Email % is already registered as a company account.', NEW.work_email USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_cross_role_email() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_cross_role_email_admins ON admins;
CREATE TRIGGER trg_cross_role_email_admins BEFORE INSERT OR UPDATE OF work_email ON admins FOR EACH ROW EXECUTE FUNCTION public.check_cross_role_email();

DROP TRIGGER IF EXISTS trg_cross_role_email_employees ON employees;
CREATE TRIGGER trg_cross_role_email_employees BEFORE INSERT OR UPDATE OF work_email ON employees FOR EACH ROW EXECUTE FUNCTION public.check_cross_role_email();

CREATE OR REPLACE FUNCTION public.check_company_email_unique()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM admins WHERE work_email = NEW.email) THEN
    RAISE EXCEPTION 'Email % is already registered as an admin.', NEW.email USING ERRCODE = 'unique_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM employees WHERE work_email = NEW.email) THEN
    RAISE EXCEPTION 'Email % is already registered as an employee.', NEW.email USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_company_email_unique() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_cross_role_email_companies ON companies;
CREATE TRIGGER trg_cross_role_email_companies BEFORE INSERT OR UPDATE OF email ON companies FOR EACH ROW EXECUTE FUNCTION public.check_company_email_unique();
