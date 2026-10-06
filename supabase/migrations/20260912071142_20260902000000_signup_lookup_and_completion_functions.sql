/*
# Signup lookup and completion functions
# Combines migrations: 20260901233359, 20260901233433, 20260902002158, 20260902002257
*/

-- lookup_signup_record (updated version with empty company_id support)
CREATE OR REPLACE FUNCTION public.lookup_signup_record(
  p_email text,
  p_company_id text,
  p_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_role = 'admin' THEN
    IF p_company_id = '' OR p_company_id IS NULL THEN
      SELECT jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'work_email', a.work_email,
        'name', a.name, 'company_id', a.company_id
      )
      INTO result
      FROM admins a
      WHERE a.work_email = p_email;
    ELSE
      SELECT jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'work_email', a.work_email,
        'name', a.name, 'company_id', a.company_id
      )
      INTO result
      FROM admins a
      WHERE a.work_email = p_email AND a.company_id::text = p_company_id;
    END IF;
  ELSIF p_role = 'employee' THEN
    IF p_company_id = '' OR p_company_id IS NULL THEN
      SELECT jsonb_build_object(
        'id', e.id, 'user_id', e.user_id, 'work_email', e.work_email,
        'employee_name', e.employee_name, 'employee_id', e.employee_id,
        'company_id', e.company_id
      )
      INTO result
      FROM employees e
      WHERE e.work_email = p_email;
    ELSE
      SELECT jsonb_build_object(
        'id', e.id, 'user_id', e.user_id, 'work_email', e.work_email,
        'employee_name', e.employee_name, 'employee_id', e.employee_id,
        'company_id', e.company_id
      )
      INTO result
      FROM employees e
      WHERE e.work_email = p_email AND e.company_id::text = p_company_id;
    END IF;
  END IF;
  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.lookup_signup_record(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_signup_record(text, text, text) TO anon, authenticated;

-- lookup_company_by_id
CREATE OR REPLACE FUNCTION public.lookup_company_by_id(
  p_company_id text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', c.id,
    'company_name', COALESCE(c.company_name, c.name),
    'license_status', c.license_status,
    'admin_cap', c.admin_cap,
    'employee_cap', c.employee_cap
  )
  FROM companies c
  WHERE c.id::text = p_company_id;
$$;
REVOKE EXECUTE ON FUNCTION public.lookup_company_by_id(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_company_by_id(text) TO anon, authenticated;

-- lookup_license_key
CREATE OR REPLACE FUNCTION public.lookup_license_key(
  p_key_value text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', k.id, 'key_value', k.key_value, 'status', k.status
  )
  FROM license_keys k
  WHERE k.key_value = p_key_value;
$$;
REVOKE EXECUTE ON FUNCTION public.lookup_license_key(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_license_key(text) TO anon, authenticated;

-- complete_company_signup
CREATE OR REPLACE FUNCTION public.complete_company_signup(
  p_user_id uuid,
  p_email text,
  p_company_name text,
  p_key_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_license record;
  v_company_id uuid;
BEGIN
  SELECT * INTO v_license FROM license_keys WHERE key_value = p_key_value FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid license key.');
  END IF;
  IF v_license.status <> 'available' THEN
    RETURN jsonb_build_object('error', 'This license key has already been used.');
  END IF;
  UPDATE license_keys SET status = 'used' WHERE id = v_license.id;
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
  UPDATE license_keys SET company_id = v_company_id WHERE id = v_license.id;
  RETURN jsonb_build_object('company_id', v_company_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_company_signup(uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_company_signup(uuid, text, text, text) TO anon, authenticated;

-- complete_admin_employee_signup
CREATE OR REPLACE FUNCTION public.complete_admin_employee_signup(
  p_user_id uuid,
  p_email text,
  p_role text,
  p_company_id text,
  p_record_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count_col text;
  v_current_val integer;
BEGIN
  IF p_role = 'admin' THEN
    UPDATE admins
    SET user_id = p_user_id, status = 'approved'
    WHERE id::text = p_record_id AND work_email = p_email AND user_id IS NULL;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Could not link admin record. It may already be linked.');
    END IF;
    v_count_col := 'current_admin_count';
  ELSIF p_role = 'employee' THEN
    UPDATE employees
    SET user_id = p_user_id, status = 'active', first_sign_in_completed = true
    WHERE id::text = p_record_id AND work_email = p_email AND user_id IS NULL;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Could not link employee record. It may already be linked.');
    END IF;
    v_count_col := 'current_employee_count';
  ELSE
    RETURN jsonb_build_object('error', 'Invalid role.');
  END IF;
  EXECUTE format('SELECT %I FROM companies WHERE id::text = $1', v_count_col)
    INTO v_current_val USING p_company_id;
  IF v_current_val IS NOT NULL THEN
    EXECUTE format('UPDATE companies SET %I = $1 WHERE id::text = $2', v_count_col)
      USING v_current_val + 1, p_company_id;
  END IF;
  RETURN jsonb_build_object('status', 'ok');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_admin_employee_signup(uuid, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_admin_employee_signup(uuid, text, text, text, text) TO anon, authenticated;
