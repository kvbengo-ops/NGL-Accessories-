-- ============================================================
-- NGL Accessories — Fix: order tracking throws "Something went wrong"
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
-- ROOT CAUSE (confirmed on this database)
-- get_order_status() returns v_order.courier / v_order.tracking_number,
-- but those fulfilment columns were never added to the orders table
-- (the guarded ALTER in schema.sql didn't apply here). When a matching
-- order is found, Postgres raises:
--     record "v_order" has no field "courier"
-- and the tracker shows the generic error. The same gap also breaks the
-- admin "Save Fulfilment" button.
--
-- Other late-added columns (province, shipping, delivery_method) are
-- guarded here too so this stays safe on any older database.
--
-- THE FIX (idempotent, safe to run any time)
--   1. Make sure every column the order functions touch exists.
--   2. Redeploy get_order_status() to match the current schema.
--   3. Re-grant EXECUTE to the anonymous (storefront) role.
-- ============================================================

-- 1. GUARANTEE THE LATE-ADDED COLUMNS EXIST -----------------------
DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN courier text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN tracking_number text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN province text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN shipping numeric(10,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN delivery_method text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- 2. REDEPLOY THE TRACKING FUNCTION -------------------------------
-- Returns everything track-order.js renders, using only columns that
-- are now guaranteed to exist. Online orders only (the storefront
-- tracker is for customer web orders, not in-store POS sales).
CREATE OR REPLACE FUNCTION public.get_order_status(p_order_number text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order record;
  v_items jsonb;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE order_number = trim(p_order_number)
    AND lower(customer_email) = lower(trim(p_email))
    AND type = 'online';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name', product_name,
    'quantity',     quantity,
    'subtotal',     subtotal
  )) INTO v_items
  FROM public.order_items
  WHERE order_id = v_order.id;

  RETURN jsonb_build_object(
    'order_number',     v_order.order_number,
    'status',           v_order.status,
    'subtotal',         v_order.subtotal,
    'shipping',         v_order.shipping,
    'total',            v_order.total,
    'payment_method',   v_order.payment_method,
    'customer_name',    v_order.customer_name,
    'customer_phone',   v_order.customer_phone,
    'delivery_address', v_order.delivery_address,
    'province',         v_order.province,
    'delivery_method',  v_order.delivery_method,
    'courier',          v_order.courier,
    'tracking_number',  v_order.tracking_number,
    'created_at',       v_order.created_at,
    'updated_at',       v_order.updated_at,
    'items',            coalesce(v_items, '[]'::jsonb)
  );
END;
$$;

-- 3. RE-GRANT EXECUTE TO THE STOREFRONT (ANON) ROLE ---------------
GRANT EXECUTE ON FUNCTION public.get_order_status(text, text) TO anon, authenticated;
