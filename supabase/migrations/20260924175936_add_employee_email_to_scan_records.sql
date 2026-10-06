-- Add employee_email column to scan_records
ALTER TABLE scan_records
  ADD COLUMN IF NOT EXISTS employee_email text NOT NULL DEFAULT '';

-- Add UPDATE policy for scan_records (was missing)
DROP POLICY IF EXISTS "update_scan_records" ON scan_records;
CREATE POLICY "update_scan_records" ON scan_records FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
