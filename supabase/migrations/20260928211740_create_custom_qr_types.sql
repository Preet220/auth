/*
# Create custom_qr_types table

1. New Tables
- `custom_qr_types`
  - `id` (uuid, primary key)
  - `type_key` (text, unique identifier for the tab, e.g. "vehicle", "equipment")
  - `label` (text, display name for the tab, e.g. "Vehicle", "Equipment")
  - `fields` (jsonb, array of { key, label, required } objects defining the detail fields)
  - `created_at` (timestamptz)

2. Security
- Enable RLS on `custom_qr_types`.
- Allow authenticated users full CRUD (admins manage types for their company).
*/

CREATE TABLE IF NOT EXISTS custom_qr_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key text UNIQUE NOT NULL,
  label text NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE custom_qr_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_custom_qr_types" ON custom_qr_types;
CREATE POLICY "select_custom_qr_types" ON custom_qr_types FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_custom_qr_types" ON custom_qr_types;
CREATE POLICY "insert_custom_qr_types" ON custom_qr_types FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_custom_qr_types" ON custom_qr_types;
CREATE POLICY "update_custom_qr_types" ON custom_qr_types FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_custom_qr_types" ON custom_qr_types;
CREATE POLICY "delete_custom_qr_types" ON custom_qr_types FOR DELETE
  TO authenticated USING (true);
