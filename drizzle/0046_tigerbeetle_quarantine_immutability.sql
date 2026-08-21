-- Make TigerBeetle collision evidence append-only.
-- Run after 0045_tigerbeetle_identifier_quarantine.sql.

CREATE OR REPLACE FUNCTION public.reject_tigerbeetle_quarantine_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'tigerbeetle_identifier_quarantine is append-only';
END;
$$;

REVOKE UPDATE, DELETE ON public.tigerbeetle_identifier_quarantine
FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.tigerbeetle_identifier_quarantine'::regclass
      AND tgname = 'tigerbeetle_quarantine_append_only'
  ) THEN
    CREATE TRIGGER tigerbeetle_quarantine_append_only
    BEFORE UPDATE OR DELETE
    ON public.tigerbeetle_identifier_quarantine
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_tigerbeetle_quarantine_mutation();
  END IF;
END
$$;

COMMENT ON FUNCTION public.reject_tigerbeetle_quarantine_mutation() IS
  'Rejects all updates and deletes from immutable TigerBeetle collision evidence.';
