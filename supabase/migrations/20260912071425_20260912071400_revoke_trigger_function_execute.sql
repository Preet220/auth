/* Revoke EXECUTE from anon on internal trigger functions */
REVOKE EXECUTE ON FUNCTION public.check_cross_role_email() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_company_email_unique() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_master_email() FROM anon;
