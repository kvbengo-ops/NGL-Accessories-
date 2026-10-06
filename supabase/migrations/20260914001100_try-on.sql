-- ============================================================
-- NGL Accessories — Earring virtual try-on
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
--   • product_try_on_configs: one row per earring (placement settings)
--   • Bounds are CHECKs; they MUST match BOUNDS in src/try-on/assets.js
--   • A trigger refuses enabled = true for non-earrings
--   • RLS: the public reads only ENABLED rows of ACTIVE earrings;
--     every write needs public.is_admin()
--   • try-on-assets bucket: public read, admin-only write, ≤1 MB webp/png
-- Additive: rolling back = disable rows (or build with VITE_TRY_ON_ENABLED
-- false); leave the table in place.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper for {x, y} jsonb bounds (a CHECK can't loop over keys)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_on_xy_ok(p jsonb, lo numeric, hi numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p) = 'object'
     AND jsonb_typeof(p->'x') = 'number'
     AND jsonb_typeof(p->'y') = 'number'
    THEN (p->>'x')::numeric BETWEEN lo AND hi
     AND (p->>'y')::numeric BETWEEN lo AND hi
    ELSE false
  END;
$$;

-- ------------------------------------------------------------
-- 2. Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_try_on_configs (
  product_id            uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT false,
  -- Paths inside the try-on-assets bucket: <product_id>/<left|right>-<ms>.<webp|png>
  asset_left_path       text,
  asset_right_path      text,
  mirror_left_for_right boolean NOT NULL DEFAULT true,
  anchor_left           jsonb   NOT NULL DEFAULT '{"x":0.5,"y":0.1}',
  anchor_right          jsonb   NOT NULL DEFAULT '{"x":0.5,"y":0.1}',
  offset_left           jsonb   NOT NULL DEFAULT '{"x":0,"y":0}',
  offset_right          jsonb   NOT NULL DEFAULT '{"x":0,"y":0}',
  rotation_left_deg     numeric NOT NULL DEFAULT 0,
  rotation_right_deg    numeric NOT NULL DEFAULT 0,
  scale_ratio           numeric NOT NULL DEFAULT 0.18,
  product_length_mm     numeric,
  config_version        integer NOT NULL DEFAULT 1,
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT try_on_asset_left_path  CHECK (asset_left_path  IS NULL
    OR asset_left_path  ~ ('^' || product_id::text || '/left-[0-9]+\.(webp|png)$')),
  CONSTRAINT try_on_asset_right_path CHECK (asset_right_path IS NULL
    OR asset_right_path ~ ('^' || product_id::text || '/right-[0-9]+\.(webp|png)$')),
  -- Publishing needs a left image, and a right one unless the pair is mirrored.
  CONSTRAINT try_on_enabled_has_assets CHECK (NOT enabled
    OR (asset_left_path IS NOT NULL AND (mirror_left_for_right OR asset_right_path IS NOT NULL))),
  CONSTRAINT try_on_anchor_left   CHECK (public.try_on_xy_ok(anchor_left,  0, 1)),
  CONSTRAINT try_on_anchor_right  CHECK (public.try_on_xy_ok(anchor_right, 0, 1)),
  CONSTRAINT try_on_offset_left   CHECK (public.try_on_xy_ok(offset_left,  -0.5, 0.5)),
  CONSTRAINT try_on_offset_right  CHECK (public.try_on_xy_ok(offset_right, -0.5, 0.5)),
  CONSTRAINT try_on_rotation_left  CHECK (rotation_left_deg  BETWEEN -45 AND 45),
  CONSTRAINT try_on_rotation_right CHECK (rotation_right_deg BETWEEN -45 AND 45),
  CONSTRAINT try_on_scale_ratio    CHECK (scale_ratio BETWEEN 0.02 AND 1),
  CONSTRAINT try_on_length_mm      CHECK (product_length_mm IS NULL OR (product_length_mm > 0 AND product_length_mm <= 500)),
  CONSTRAINT try_on_version        CHECK (config_version >= 1)
);

-- ------------------------------------------------------------
-- 3. Trigger: only earrings can be published; keep updated_at honest.
--    (A CHECK can't read another table. SECURITY DEFINER so the lookup
--    doesn't depend on the caller's products grants.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_on_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.enabled AND NOT EXISTS (
    SELECT 1 FROM public.products WHERE id = NEW.product_id AND category = 'Earrings'
  ) THEN
    RAISE EXCEPTION 'Try-on can only be enabled for earrings' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS try_on_guard ON public.product_try_on_configs;
CREATE TRIGGER try_on_guard
  BEFORE INSERT OR UPDATE ON public.product_try_on_configs
  FOR EACH ROW EXECUTE FUNCTION public.try_on_guard();

-- ------------------------------------------------------------
-- 4. RLS + grants
-- ------------------------------------------------------------
ALTER TABLE public.product_try_on_configs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_try_on_configs FROM anon, authenticated;
GRANT SELECT ON public.product_try_on_configs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_try_on_configs TO authenticated;

-- Public: published rows of active earrings only (the trigger covers writes;
-- this repeats the category rule in case a product is re-categorised later).
DROP POLICY IF EXISTS try_on_public_read ON public.product_try_on_configs;
CREATE POLICY try_on_public_read ON public.product_try_on_configs
  FOR SELECT TO anon, authenticated
  USING (
    enabled
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_try_on_configs.product_id AND p.is_active AND p.category = 'Earrings'
    )
  );

-- Admins: everything, including drafts.
DROP POLICY IF EXISTS try_on_admin_all ON public.product_try_on_configs;
CREATE POLICY try_on_admin_all ON public.product_try_on_configs
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 5. Storage bucket: product artwork only (never customer images)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('try-on-assets', 'try-on-assets', true, 1048576,
        ARRAY['image/webp', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public URLs work for a public bucket without a SELECT policy, so visitors
-- can't list files. Admins get SELECT/INSERT/UPDATE/DELETE, and uploads must
-- use the <product_id>/<left|right>-<ms>.<webp|png> naming.
DROP POLICY IF EXISTS try_on_assets_admin_select ON storage.objects;
CREATE POLICY try_on_assets_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'try-on-assets' AND public.is_admin());

DROP POLICY IF EXISTS try_on_assets_admin_insert ON storage.objects;
CREATE POLICY try_on_assets_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'try-on-assets'
    AND public.is_admin()
    AND name ~ '^[0-9a-f-]{36}/(left|right)-[0-9]+\.(webp|png)$'
  );

DROP POLICY IF EXISTS try_on_assets_admin_update ON storage.objects;
CREATE POLICY try_on_assets_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'try-on-assets' AND public.is_admin())
  WITH CHECK (bucket_id = 'try-on-assets' AND public.is_admin());

DROP POLICY IF EXISTS try_on_assets_admin_delete ON storage.objects;
CREATE POLICY try_on_assets_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'try-on-assets' AND public.is_admin());
