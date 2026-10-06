/*
# Licensing Service Tables

Tables for the central licensing service that manages companies,
license keys, license validations, and master accounts.
*/

-- Companies table
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  license_key text NOT NULL UNIQUE,
  license_status text NOT NULL DEFAULT 'active',
  subscription_tier text NOT NULL DEFAULT 'starter',
  subscription_start timestamptz NOT NULL DEFAULT now(),
  subscription_end timestamptz NOT NULL DEFAULT (now() + interval '1 year'),
  admin_cap integer NOT NULL DEFAULT 5,
  employee_cap integer NOT NULL DEFAULT 50,
  current_admin_count integer NOT NULL DEFAULT 0,
  current_employee_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- License keys table
CREATE TABLE IF NOT EXISTS license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_value text NOT NULL UNIQUE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  status text NOT NULL DEFAULT 'active'
);

ALTER TABLE license_keys ENABLE ROW LEVEL SECURITY;

-- License validations table
CREATE TABLE IF NOT EXISTS license_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  source_ip text,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE license_validations ENABLE ROW LEVEL SECURITY;

-- Master accounts table (stores master user IDs referencing auth.users)
CREATE TABLE IF NOT EXISTS master_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL DEFAULT 'Master',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE master_accounts ENABLE ROW LEVEL SECURITY;

-- Policies for companies (master only via authenticated)
DROP POLICY IF EXISTS "select_companies" ON companies;
CREATE POLICY "select_companies" ON companies FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_companies" ON companies;
CREATE POLICY "insert_companies" ON companies FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_companies" ON companies;
CREATE POLICY "update_companies" ON companies FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Policies for license_keys
DROP POLICY IF EXISTS "select_license_keys" ON license_keys;
CREATE POLICY "select_license_keys" ON license_keys FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_license_keys" ON license_keys;
CREATE POLICY "insert_license_keys" ON license_keys FOR INSERT
  TO authenticated WITH CHECK (true);

-- Policies for license_validations
DROP POLICY IF EXISTS "insert_license_validations" ON license_validations;
CREATE POLICY "insert_license_validations" ON license_validations FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "select_license_validations" ON license_validations;
CREATE POLICY "select_license_validations" ON license_validations FOR SELECT
  TO authenticated USING (true);

-- Policies for master_accounts
DROP POLICY IF EXISTS "select_own_master" ON master_accounts;
CREATE POLICY "select_own_master" ON master_accounts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_master" ON master_accounts;
CREATE POLICY "update_own_master" ON master_accounts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_master" ON master_accounts;
CREATE POLICY "insert_master" ON master_accounts FOR INSERT
  TO authenticated WITH CHECK (true);
