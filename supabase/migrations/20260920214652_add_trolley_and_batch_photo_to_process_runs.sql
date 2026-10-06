-- Add trolley_qr_value and batch_photo_url columns to process_runs
ALTER TABLE process_runs ADD COLUMN IF NOT EXISTS trolley_qr_value text;
ALTER TABLE process_runs ADD COLUMN IF NOT EXISTS batch_photo_url text;
