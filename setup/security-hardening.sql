-- ============================================================
-- NGL Accessories — Security Hardening (audit follow-up)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
-- Run order: this is the LATEST migration. Apply it AFTER
-- schema.sql, audit-fixes.sql, payment-proof.sql and
-- local-delivery.sql. Idempotent and safe to re-run.
--
-- Addresses audit findings:
--   H1  Hide products.cost_price / margins from the public anon role
--   H2  get_order_public() now requires the matching email (was UUID-only)
--   M3  Lock the payment-proofs bucket to small image files
--   M5  Auto-cancel only truly-unpaid orders, after 24h (not 2h)
--   F2  Commit get_admin_users() + delete_admin() to version control
--       (they existed only on the live DB — not reproducible from the repo)
--
-- Still MANUAL (cannot be done in SQL):
--   C1  Rotate WEBHOOK_SECRET on both edge functions + scrub git history
--   C2  Authentication → Providers → disable public email sign-ups
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- H1. Stop exposing cost_price / margins to anonymous visitors.
--     Column-level grant: anon may read only the storefront columns;
--     cost_price stays readable by `authenticated` (admin pages).
--     NOTE: getProducts() in src/supabase.js now selects an explicit
--     column list, so the public storefront keeps working.
-- ------------------------------------------------------------
REVOKE SELECT ON public.products FROM anon;
GRANT  SELECT (id, name, collection, category, price, description,
               image_url, tags, is_active, created_at, likes_count)
  ON public.products TO anon;

-- ------------------------------------------------------------
-- H2. Ownership-gate the public order lookup.
--     The old get_order_public(uuid) returned customer PII keyed by the
--     order UUID alone. Replace it with a version that also requires the
--     matching email, then drop the ungated overload.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_order_public(uuid);

CREATE OR REPLACE FUNCTION public.get_order_public(p_order_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_items jsonb;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND lower(customer_email) = lower(trim(coalesce(p_email, '')))
    AND coalesce(p_email, '') <> '';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'product_id', product_id,
    'product_name', product_name,
    'price', price,
    'quantity', quantity,
    'subtotal', subtotal
  )) INTO v_items
  FROM public.order_items
  WHERE order_id = p_order_id;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'subtotal', v_order.subtotal,
    'shipping', v_order.shipping,
    'total', v_order.total,
    'customer_name', v_order.customer_name,
    'customer_email', v_order.customer_email,
    'delivery_address', v_order.delivery_address,
    'province', v_order.province,
    'delivery_method', v_order.delivery_method,
    'payment_method', v_order.payment_method,
    'created_at', v_order.created_at,
    'items', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_public(uuid, text) TO anon, authenticated;

-- ------------------------------------------------------------
-- M5. Auto-cancel stale orders — gentler + payment-aware.
--     Only cancel orders that show NO payment evidence at all
--     (no uploaded proof, and a bare gcash/bank method with no
--     reference number), and only after 24h. Cash-on-meetup ('cod')
--     and any order with a proof/reference are left alone.
-- ------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN payment_proof_url text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
  SET status = 'cancelled', updated_at = now()
  WHERE status = 'pending'
    AND type = 'online'
    AND payment_proof_url IS NULL
    AND payment_method IN ('gcash', 'bank_transfer')  -- bare = no reference attached
    AND created_at < now() - interval '24 hours';
  -- The orders_restore_stock trigger returns inventory automatically.
END;
$$;

-- ------------------------------------------------------------
-- F2. Admin-roster RPCs used by admin/admins.js. These lived only on
--     the live database (not in any migration) so the schema wasn't
--     reproducible from the repo. Committed here, superadmin-gated.
-- ------------------------------------------------------------

-- List admins + their auth email (any active admin may view the roster).
CREATE OR REPLACE FUNCTION public.get_admin_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',         a.id,
        'name',       a.name,
        'role',       a.role,
        'is_active',  a.is_active,
        'last_login', a.last_login,
        'email',      u.email
      ) ORDER BY a.created_at
    )
    FROM public.admins a
    LEFT JOIN auth.users u ON u.id = a.id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_users() TO authenticated;

-- Delete an admin (superadmin only; can't delete yourself). Removing the
-- auth.users row cascades to public.admins; orders.handled_by is SET NULL.
CREATE OR REPLACE FUNCTION public.delete_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admins
    WHERE id = auth.uid() AND role = 'superadmin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only superadmins can delete admins';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete your own account';
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_admin(uuid) TO authenticated;

COMMIT;

-- ------------------------------------------------------------
-- M3. Lock down the payment-proofs storage bucket (outside the txn).
--     Bucket-level limits reject anything that isn't a small image, and
--     uploads are scoped to the proofs/ prefix the checkout uses.
-- ------------------------------------------------------------
UPDATE storage.buckets
SET file_size_limit  = 5242880,                                  -- 5 MB
    allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']
WHERE id = 'payment-proofs';

DROP POLICY IF EXISTS "payment_proofs_anon_insert" ON storage.objects;
CREATE POLICY "payment_proofs_anon_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = 'proofs'
  );

-- ------------------------------------------------------------
-- FOLLOW-UP (consider): make payment-proofs PRIVATE and serve receipts
-- via short-lived signed URLs instead of a public bucket, so customer
-- payment screenshots aren't readable by anyone with the URL. That needs
-- a small admin change (createSignedUrl) and is left as a separate step.
-- ------------------------------------------------------------
