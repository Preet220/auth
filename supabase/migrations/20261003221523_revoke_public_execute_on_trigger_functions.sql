/*
# Revoke PUBLIC EXECUTE on trigger functions

## What this does
PostgreSQL functions are executable by PUBLIC by default. The previous migration
revoked EXECUTE from `anon` and `authenticated` individually, but the default
`PUBLIC` grant still allows both roles to call these functions.

## Changes
1. REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC for three trigger functions:
   - `check_company_email_unique()`
   - `check_cross_role_email()`
   - `enforce_master_email()`

2. These functions are still executable by `postgres` and `service_role` (their
   explicit grants are not touched), so triggers continue to work normally.

## Security impact
After this change, only `postgres` and `service_role` can call these functions.
The `anon` and `authenticated` roles (used by the frontend) can no longer
invoke them via `/rest/v1/rpc/`. This closes a gap where internal trigger
functions were accidentally exposed through the REST API.
*/

REVOKE EXECUTE ON FUNCTION public.check_company_email_unique() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_cross_role_email() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_master_email() FROM PUBLIC;
