/*
# Add Action Column to Risk Rules and Alerts

## Changes

### 1. Add `action` column to `risk_rules`
- New column `action text NOT NULL DEFAULT 'alert'`
- Values: 'block' (prevent process from completing), 'alert' (generate alert only), 'warn' (show warning but allow)
- Built-in rules default to 'block' for critical rules, 'alert' for others
- Backfill built-in rules with appropriate actions

### 2. Add `action_taken` column to `risk_alerts`
- New column `action_taken text DEFAULT 'alert'`
- Records what action was triggered when the alert was generated
- Values mirror the rule's action: 'block', 'alert', 'warn'

### 3. Add `resolution_status` column to `process_runs`
- New column `resolution_status text DEFAULT 'clean'`
- Values: 'clean' (no breaches), 'warned' (breaches with warn action), 'blocked' (breaches with block action)
- Allows the dashboard to show blocked runs distinctly from clean completed ones

## Security
- RLS policies remain unchanged — the new columns inherit existing policies
- No data is lost
*/

-- Add action column to risk_rules
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'risk_rules' AND column_name = 'action') THEN
    ALTER TABLE public.risk_rules ADD COLUMN action text NOT NULL DEFAULT 'alert';
  END IF;
END $$;

-- Add action_taken column to risk_alerts
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'risk_alerts' AND column_name = 'action_taken') THEN
    ALTER TABLE public.risk_alerts ADD COLUMN action_taken text DEFAULT 'alert';
  END IF;
END $$;

-- Add resolution_status column to process_runs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'process_runs' AND column_name = 'resolution_status') THEN
    ALTER TABLE public.process_runs ADD COLUMN resolution_status text DEFAULT 'clean';
  END IF;
END $$;

-- Backfill built-in rules with sensible default actions
-- Critical built-in rules get 'block', others get 'alert'
UPDATE public.risk_rules SET action = 'block' WHERE is_builtin = true AND rule_type IN ('duplicate_seal', 'seal_matching');
UPDATE public.risk_rules SET action = 'warn' WHERE is_builtin = true AND rule_type IN ('weight_reconciliation', 'process_deviation', 'manual_weight_no_photo');
UPDATE public.risk_rules SET action = 'alert' WHERE is_builtin = true AND rule_type IN ('single_person_completion', 'time_limit');
