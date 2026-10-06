/*
# Fix duplicate key violation on company signup

## Problem
The `complete_company_signup` function marks the license key as "used" BEFORE
inserting the company row. If the insert fails (e.g. duplicate license_key
from a previous partial attempt), the license stays stuck as "used" and the
user can never retry — every subsequent attempt sees "already used."

## Fix
Rewrite `complete_company_signup` to be idempotent:
1. If a company with this license_key already exists, update it with the
   new user_id/email (re-link) and return its id.
2. Only insert a new company row if no existing company has this key.
3. Mark the license as "used" only after the company row is committed.

## Security
- Function remains SECURITY DEFINER (needed for unauthenticated signup).
- No new tables or columns.
*/

DROP FUNCTION IF EXISTS public.complete_company_signup(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.complete_company_signup(p_user_id uuid, p_email text, p_company_name text, p_key_value text);

CREATE OR REPLACE FUNCTION public.complete_company_signup(
  p_user_id uuid,
  p_email text,
  p_company_name text,
  p_key_value text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_license record;
  v_company_id uuid;
  v_existing_company record;
BEGIN
  -- Lock the license row
  SELECT * INTO v_license FROM license_keys WHERE key_value = p_key_value FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid license key.');
  END IF;

  -- Check if a company already exists with this license key (from a previous partial attempt)
  SELECT * INTO v_existing_company FROM companies WHERE license_key = p_key_value LIMIT 1;

  IF FOUND THEN
    -- Re-link the existing company to the new user
    UPDATE companies
    SET user_id = p_user_id, email = p_email, company_name = p_company_name
    WHERE id = v_existing_company.id;
    v_company_id := v_existing_company.id;
  ELSE
    -- Insert new company
    INSERT INTO companies (
      company_name, license_key, license_status,
      subscription_tier, subscription_start, subscription_end,
      admin_cap, employee_cap, user_id, email
    ) VALUES (
      p_company_name, p_key_value, 'active',
      'starter', now(), now() + interval '1 year',
      5, 50, p_user_id, p_email
    )
    RETURNING id INTO v_company_id;
  END IF;

  -- Mark license as used and link to company
  UPDATE license_keys SET status = 'used', company_id = v_company_id WHERE id = v_license.id;

  RETURN jsonb_build_object('company_id', v_company_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_company_signup(uuid, text, text, text) TO anon, authenticated;
