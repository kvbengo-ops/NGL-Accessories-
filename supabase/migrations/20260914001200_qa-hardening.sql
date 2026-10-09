-- ============================================================
-- NGL Accessories — QA hardening (docs/QA_Audit_2026-10-09.md)
-- Run in: Supabase Dashboard → SQL Editor → New Query. Idempotent.
--
--   #1  New sign-ups are no longer auto-activated as admins
--   #1b Only an active superadmin may change an admin's role / is_active
--       (any admin could previously UPDATE public.admins directly)
--   #3  contact_messages, reviews, shipping/province zones: admins only
--   #8  SET search_path on every SECURITY DEFINER function in public
--
-- DEPLOY ORDER: ship the matching src/admins.js change first (or together).
-- Until it is live, "Add admin" creates the account but leaves it inactive;
-- reactivate it from Admin → Admins.
-- ============================================================

BEGIN;

-- #1. The first user bootstraps as an active superadmin; everyone after that
--     is created INACTIVE. A superadmin activates them (Admin → Admins).
--     Stray self-registrations therefore get no admin access at all.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_first boolean := (SELECT count(*) FROM public.admins) = 0;
BEGIN
  INSERT INTO public.admins (id, name, role, is_active)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Admin'),
    CASE WHEN v_first THEN 'superadmin' ELSE 'admin' END,
    v_first
  );
  RETURN new;
END;
$$;

-- #1b. Privilege-escalation guard. The admins_all policy lets every active admin
--      UPDATE public.admins, including their own role. Block role / is_active
--      changes unless the caller is an active superadmin. auth.uid() IS NULL
--      (SQL editor, service role) is allowed.
CREATE OR REPLACE FUNCTION public.guard_admin_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (new.role IS DISTINCT FROM old.role OR new.is_active IS DISTINCT FROM old.is_active)
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.admins
       WHERE id = auth.uid() AND role = 'superadmin' AND is_active = true
     ) THEN
    RAISE EXCEPTION 'Only a superadmin can change admin roles or status';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS admins_guard_privileges ON public.admins;
CREATE TRIGGER admins_guard_privileges
  BEFORE UPDATE ON public.admins
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_privileges();

-- #3. Admin-only policies (were: any logged-in user).
DROP POLICY IF EXISTS "contact_messages_admin_all" ON public.contact_messages;
CREATE POLICY "contact_messages_admin_all" ON public.contact_messages
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "reviews_admin_all" ON public.reviews;
CREATE POLICY "reviews_admin_all" ON public.reviews
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "shipping_zones_admin_write" ON public.shipping_zones;
CREATE POLICY "shipping_zones_admin_write" ON public.shipping_zones
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "province_zones_admin_write" ON public.province_zones;
CREATE POLICY "province_zones_admin_write" ON public.province_zones
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- #8. Pin search_path on every SECURITY DEFINER function in public that has none.
--     `extensions` stays on the path so crypt()/gen_salt() in update_admin_password
--     keep resolving.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT coalesce(p.proconfig::text ILIKE '%search_path%', false)
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', r.sig);
  END LOOP;
END $$;

COMMIT;
