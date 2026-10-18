-- ============================================================
-- NGL Accessories — admin-only settings (owner finances)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
--   • store_settings is public-read (the storefront needs it), so
--     private numbers like the owner's starting cash can't live there.
--   • admin_settings: same key/value shape, readable and writable by
--     admins only. First key: 'starting_cash' (dashboard Cash on hand).
--   • Fail-closed: until this runs, the dashboard's save just errors.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_settings_admin_all" ON public.admin_settings;
CREATE POLICY "admin_settings_admin_all" ON public.admin_settings FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.admin_settings FROM anon;
