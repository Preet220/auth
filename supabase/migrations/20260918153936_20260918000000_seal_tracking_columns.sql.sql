/*
# Seal Tracking Columns

## Summary
Adds seal consumption tracking columns to the `seals` table so the app can
prevent reuse of seals across process runs.

## Changes

### seals table — new columns
- `used_in_process` (boolean, default false): marks whether a seal has been
  consumed in a completed process run.
- `process_run_id` (uuid, nullable): the run that consumed this seal, if any.
  No foreign key constraint because process_runs.process_definition_id uses
  ON DELETE SET NULL and we want to avoid circular dependency issues.

### Index
- Partial index on `used_in_process` for quick lookups of consumed seals.

## Security
- No policy changes. Existing RLS policies on `seals` remain unchanged.
*/

ALTER TABLE seals
  ADD COLUMN IF NOT EXISTS used_in_process boolean NOT NULL DEFAULT false;

ALTER TABLE seals
  ADD COLUMN IF NOT EXISTS process_run_id uuid;

CREATE INDEX IF NOT EXISTS idx_seals_used_in_process
  ON seals (used_in_process)
  WHERE used_in_process = true;
