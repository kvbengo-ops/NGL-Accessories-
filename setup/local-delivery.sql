-- ============================================================
-- NGL Accessories — Local Delivery (Metro Cebu corridor only)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
-- Replaces the nationwide zone-based shipping model with a local
-- fulfilment model: the customer chooses a DELIVERY METHOD —
--   • Meetup            → free, agreed spot & time
--   • Maxim / Movit     → fare paid directly to the rider on arrival
-- — and an AREA within our coverage (Cebu City → Consolacion):
--   Cebu City, Mandaue City, Consolacion, Liloan, Compostela.
--
-- Because the buyer shoulders any courier fare (paid to the rider),
-- the order's SHIPPING is always ₱0 at checkout. The AREA is stored
-- in the existing `orders.province` column; the chosen method is
-- stored in the new `orders.delivery_method` column.
--
-- Supersedes setup/shipping-zones.sql. The shipping_zones /
-- province_zones tables are left in place but are no longer read by
-- create_order_safely(); they can be dropped later if unused.
--
-- Safe to run on an existing database (idempotent).
-- ============================================================

-- 1. ORDERS — make sure the columns we read/write all exist --------
-- delivery_method is new here; province/shipping/courier/tracking_number
-- come from earlier migrations (shipping-zones.sql / schema.sql), but we
-- guard them all so this file is safe to run standalone on any database.
DO $$ BEGIN
  ALTER TABLE orders ADD COLUMN province text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE orders ADD COLUMN shipping numeric(10,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE orders ADD COLUMN delivery_method text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE orders ADD COLUMN courier text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE orders ADD COLUMN tracking_number text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- 2. ORDER CREATION — no shipping fee, store delivery method -------
-- Identical to the previous create_order_safely() except:
--   • online orders no longer compute a zone fee (shipping is ₱0)
--   • the chosen delivery_method is persisted
CREATE OR REPLACE FUNCTION public.create_order_safely(
  p_order_data jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_stock integer;
  v_name text;
  v_price numeric(10,2);
  v_subtotal numeric(10,2);
  v_item_cost numeric(10,2);
  v_item_profit numeric(10,2);
  v_order_total_cost numeric(10,2) := 0;
  v_order_profit numeric(10,2) := 0;
  v_computed_subtotal numeric(10,2) := 0;
  v_discount numeric(10,2) := 0;
  v_shipping numeric(10,2) := 0;   -- local model: always 0 (meetup free / fare paid to rider)
  v_net_subtotal numeric(10,2) := 0;
  v_order_total numeric(10,2) := 0;
  v_province text;
BEGIN
  v_order_number := p_order_data->>'order_number';
  IF EXISTS (SELECT 1 FROM public.orders WHERE order_number = v_order_number) THEN
    RAISE EXCEPTION 'Order number already exists';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    SELECT stock INTO v_stock
    FROM public.inventory
    WHERE product_id = v_product_id
    FOR UPDATE;

    IF v_stock IS NULL THEN
      RAISE EXCEPTION 'Product with ID % not found in inventory', v_product_id;
    END IF;

    IF v_stock < v_qty THEN
      SELECT name INTO v_name FROM public.products WHERE id = v_product_id;
      RAISE EXCEPTION 'Insufficient stock for product: % (Available: %, Requested: %)', v_name, v_stock, v_qty;
    END IF;
  END LOOP;

  v_province := p_order_data->>'province';

  INSERT INTO public.orders (
    order_number, type, status, customer_name, customer_email, customer_phone,
    delivery_address, province, delivery_method, order_notes, payment_method,
    subtotal, discount, total, handled_by
  ) VALUES (
    v_order_number,
    p_order_data->>'type',
    coalesce(p_order_data->>'status', 'pending'),
    p_order_data->>'customer_name',
    p_order_data->>'customer_email',
    p_order_data->>'customer_phone',
    p_order_data->>'delivery_address',
    v_province,
    p_order_data->>'delivery_method',
    p_order_data->>'order_notes',
    p_order_data->>'payment_method',
    (p_order_data->>'subtotal')::numeric(10,2),
    (p_order_data->>'discount')::numeric(10,2),
    (p_order_data->>'total')::numeric(10,2),
    (p_order_data->>'handled_by')::uuid
  ) RETURNING id INTO v_order_id;

  v_discount := coalesce((p_order_data->>'discount')::numeric(10,2), 0);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    -- Source price + cost from the products table, never from the client payload,
    -- so a tampered request can't change what the customer is charged.
    SELECT name, price, coalesce(cost_price, 0)
      INTO v_name, v_price, v_item_cost
    FROM public.products
    WHERE id = v_product_id;

    IF v_price IS NULL THEN
      RAISE EXCEPTION 'Product with ID % not found', v_product_id;
    END IF;

    v_subtotal := v_price * v_qty;
    v_item_profit := v_subtotal - (v_item_cost * v_qty);
    v_computed_subtotal := v_computed_subtotal + v_subtotal;
    v_order_total_cost := v_order_total_cost + (v_item_cost * v_qty);

    INSERT INTO public.order_items (order_id, product_id, product_name, cost_price, price, quantity, subtotal, profit)
    VALUES (v_order_id, v_product_id, v_name, v_item_cost, v_price, v_qty, v_subtotal, v_item_profit);

    UPDATE public.inventory
    SET stock = stock - v_qty,
        updated_at = now()
    WHERE product_id = v_product_id;
  END LOOP;

  -- Local delivery model: meetup is free and any Maxim/Movit fare is paid
  -- directly to the rider, so the order never carries a shipping charge.
  v_shipping := 0;

  -- Authoritative totals from server-side prices. The client-supplied discount is
  -- honoured, but subtotal/shipping/total are trusted from the database only.
  v_net_subtotal := greatest(0, v_computed_subtotal - v_discount);
  v_order_total  := v_net_subtotal + v_shipping;
  v_order_profit := v_net_subtotal - v_order_total_cost;  -- merchandise margin

  UPDATE public.orders
  SET subtotal   = v_computed_subtotal,
      discount   = v_discount,
      shipping   = v_shipping,
      total      = v_order_total,
      total_cost = v_order_total_cost,
      profit     = v_order_profit
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number
  );
END;
$$;

-- 3. PUBLIC ORDER LOOKUP — include the delivery method -------------
CREATE OR REPLACE FUNCTION public.get_order_public(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order record;
  v_items jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
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

-- 4. CUSTOMER ORDER TRACKING — include the delivery method --------
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
    'quantity', quantity,
    'subtotal', subtotal
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
