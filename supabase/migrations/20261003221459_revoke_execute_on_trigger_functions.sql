/*
# Revoke EXECUTE on trigger functions from anon and authenticated

## What this does
Three SECURITY DEFINER functions in the public schema are trigger functions
used internally by the database (in BEFORE INSERT/UPDATE triggers). They are
not meant to be called directly from the API, but currently anyone (including
unauthenticated users) can invoke them via `/rest/v1/rpc/<function_name>`.

## Changes
1. Revoke EXECUTE on the following trigger functions from `anon` and `authenticated`:
   - `check_company_email_unique()` — trigger function that prevents duplicate emails within a company
   - `check_cross_role_email()` — trigger function that prevents the same email appearing in multiple role tables
   - `enforce_master_email()` — trigger function that enforces only the designated master email can create a master account

2. These functions are still executable by their owner and by roles with
   explicit grants, so triggers continue to work normally.

## Security impact
Prevents unauthenticated and authenticated users from calling internal
trigger functions via the REST API. These functions were never designed to
be called directly — they only run as part of INSERT/UPDATE triggers.

## Functions NOT revoked (intentionally public)
The following SECURITY DEFINER functions must remain callable by `anon` and/or
`authenticated` because the frontend calls them during the sign-up flow
(before the user has an authenticated session in some cases):
- `lookup_license_key` — verifies a license key during company sign-up
- `lookup_company_by_id` — verifies a company ID during admin/employee sign-up
- `lookup_signup_record` — looks up a pre-uploaded admin/employee record
- `complete_company_signup` — completes company registration
- `complete_admin_employee_signup` — completes admin/employee registration
- `create_master_account` — creates a master account
- `is_master` — helper used in RLS policy predicates (must be callable by authenticated)
- `is_company_admin` — helper used in RLS policy predicates (must be callable by authenticated)
- `get_my_company_id` — helper used in RLS policy predicates (must be callable by authenticated)
*/

REVOKE EXECUTE ON FUNCTION public.check_company_email_unique() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_cross_role_email() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_master_email() FROM anon, authenticated;
