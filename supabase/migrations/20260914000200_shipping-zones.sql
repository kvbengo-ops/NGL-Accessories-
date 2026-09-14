-- ============================================================
-- NGL Accessories — Zone-based Shipping (Cebu origin → nationwide)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
-- Replaces the single flat shipping fee with a per-zone rate card.
-- The customer picks their PROVINCE at checkout; each province maps
-- to a shipping ZONE that has its own fee + (optional) free-shipping
-- threshold. Like the old flat fee, the charged amount is computed
-- SERVER-SIDE in create_order_safely() so it can't be tampered with.
--
-- Safe to run on an existing database (idempotent): tables use
-- IF NOT EXISTS, columns are added guarded, seeds use ON CONFLICT.
-- Fees below are EXAMPLES — tune them to your courier's rate card
-- in Admin → Store Settings (or by editing shipping_zones directly).
-- ============================================================

-- 1. ZONE RATE CARD ------------------------------------------------
-- One row per zone. free_shipping_threshold = 0 (or NULL) means the
-- zone never ships free; otherwise orders whose subtotal >= the
-- threshold ship free for that zone.
CREATE TABLE IF NOT EXISTS shipping_zones (
  id                       text PRIMARY KEY,        -- e.g. 'cebu','visayas'
  label                    text NOT NULL,           -- shown to customers
  fee                      numeric(10,2) NOT NULL DEFAULT 0,
  free_shipping_threshold  numeric(10,2) NOT NULL DEFAULT 0,
  sort_order               integer NOT NULL DEFAULT 0,
  updated_at               timestamptz DEFAULT now()
);

INSERT INTO shipping_zones (id, label, fee, free_shipping_threshold, sort_order) VALUES
  ('cebu',     'Metro Cebu / Cebu Province', 60,  1500, 1),
  ('visayas',  'Rest of Visayas',            95,  2000, 2),
  ('luzon',    'Luzon (incl. Metro Manila)', 120, 0,    3),
  ('mindanao', 'Mindanao',                   130, 0,    4)
ON CONFLICT (id) DO NOTHING;

-- 2. PROVINCE → ZONE MAP ------------------------------------------
-- Single source of truth shared by the checkout dropdown and the
-- server-side fee computation.
CREATE TABLE IF NOT EXISTS province_zones (
  province  text PRIMARY KEY,
  zone_id   text NOT NULL REFERENCES shipping_zones(id) ON UPDATE CASCADE
);

INSERT INTO province_zones (province, zone_id) VALUES
  -- ── Cebu (origin) ──
  ('Cebu', 'cebu'),

  -- ── Rest of Visayas ──
  ('Aklan', 'visayas'), ('Antique', 'visayas'), ('Capiz', 'visayas'),
  ('Guimaras', 'visayas'), ('Iloilo', 'visayas'), ('Negros Occidental', 'visayas'),
  ('Bohol', 'visayas'), ('Negros Oriental', 'visayas'), ('Siquijor', 'visayas'),
  ('Biliran', 'visayas'), ('Eastern Samar', 'visayas'), ('Leyte', 'visayas'),
  ('Northern Samar', 'visayas'), ('Samar', 'visayas'), ('Southern Leyte', 'visayas'),

  -- ── Luzon (incl. NCR) ──
  ('Metro Manila', 'luzon'),
  ('Abra', 'luzon'), ('Apayao', 'luzon'), ('Benguet', 'luzon'), ('Ifugao', 'luzon'),
  ('Kalinga', 'luzon'), ('Mountain Province', 'luzon'),
  ('Ilocos Norte', 'luzon'), ('Ilocos Sur', 'luzon'), ('La Union', 'luzon'), ('Pangasinan', 'luzon'),
  ('Batanes', 'luzon'), ('Cagayan', 'luzon'), ('Isabela', 'luzon'),
  ('Nueva Vizcaya', 'luzon'), ('Quirino', 'luzon'),
  ('Aurora', 'luzon'), ('Bataan', 'luzon'), ('Bulacan', 'luzon'), ('Nueva Ecija', 'luzon'),
  ('Pampanga', 'luzon'), ('Tarlac', 'luzon'), ('Zambales', 'luzon'),
  ('Batangas', 'luzon'), ('Cavite', 'luzon'), ('Laguna', 'luzon'), ('Quezon', 'luzon'), ('Rizal', 'luzon'),
  ('Marinduque', 'luzon'), ('Occidental Mindoro', 'luzon'), ('Oriental Mindoro', 'luzon'),
  ('Palawan', 'luzon'), ('Romblon', 'luzon'),
  ('Albay', 'luzon'), ('Camarines Norte', 'luzon'), ('Camarines Sur', 'luzon'),
  ('Catanduanes', 'luzon'), ('Masbate', 'luzon'), ('Sorsogon', 'luzon'),

  -- ── Mindanao ──
  ('Zamboanga del Norte', 'mindanao'), ('Zamboanga del Sur', 'mindanao'), ('Zamboanga Sibugay', 'mindanao'),
  ('Bukidnon', 'mindanao'), ('Camiguin', 'mindanao'), ('Lanao del Norte', 'mindanao'),
  ('Misamis Occidental', 'mindanao'), ('Misamis Oriental', 'mindanao'),
  ('Davao de Oro', 'mindanao'), ('Davao del Norte', 'mindanao'), ('Davao del Sur', 'mindanao'),
  ('Davao Occidental', 'mindanao'), ('Davao Oriental', 'mindanao'),
  ('Cotabato', 'mindanao'), ('Sarangani', 'mindanao'), ('South Cotabato', 'mindanao'), ('Sultan Kudarat', 'mindanao'),
  ('Agusan del Norte', 'mindanao'), ('Agusan del Sur', 'mindanao'), ('Dinagat Islands', 'mindanao'),
  ('Surigao del Norte', 'mindanao'), ('Surigao del Sur', 'mindanao'),
  ('Basilan', 'mindanao'), ('Lanao del Sur', 'mindanao'), ('Maguindanao', 'mindanao'),
  ('Sulu', 'mindanao'), ('Tawi-Tawi', 'mindanao')
ON CONFLICT (province) DO NOTHING;

-- 3. RLS — public read (checkout needs it), admin write -----------
ALTER TABLE shipping_zones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE province_zones  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipping_zones_public_read" ON shipping_zones;
CREATE POLICY "shipping_zones_public_read" ON shipping_zones FOR SELECT USING (true);
DROP POLICY IF EXISTS "shipping_zones_admin_write" ON shipping_zones;
CREATE POLICY "shipping_zones_admin_write" ON shipping_zones FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "province_zones_public_read" ON province_zones;
CREATE POLICY "province_zones_public_read" ON province_zones FOR SELECT USING (true);
DROP POLICY IF EXISTS "province_zones_admin_write" ON province_zones;
CREATE POLICY "province_zones_admin_write" ON province_zones FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP TRIGGER IF EXISTS shipping_zones_updated_at ON shipping_zones;
CREATE TRIGGER shipping_zones_updated_at
  BEFORE UPDATE ON shipping_zones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. ORDERS — store the destination + the shipping line -----------
DO $$ BEGIN
  ALTER TABLE orders ADD COLUMN province text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE orders ADD COLUMN shipping numeric(10,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- 5. ORDER CREATION — compute shipping from the province's zone ---
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
  v_shipping numeric(10,2) := 0;
  v_net_subtotal numeric(10,2) := 0;
  v_order_total numeric(10,2) := 0;
  v_ship_fee numeric(10,2);
  v_free_at numeric(10,2);
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
    delivery_address, province, order_notes, payment_method, subtotal, discount, total, handled_by
  ) VALUES (
    v_order_number,
    p_order_data->>'type',
    coalesce(p_order_data->>'status', 'pending'),
    p_order_data->>'customer_name',
    p_order_data->>'customer_email',
    p_order_data->>'customer_phone',
    p_order_data->>'delivery_address',
    v_province,
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

  -- Compute shipping server-side from the destination province's zone.
  -- POS orders have no shipping. If the province is unknown/unmapped we
  -- fall back to the legacy flat store_settings rule so an order never
  -- fails just because a province wasn't matched.
  IF (p_order_data->>'type') = 'online' THEN
    SELECT z.fee, coalesce(z.free_shipping_threshold, 0)
      INTO v_ship_fee, v_free_at
    FROM public.province_zones pz
    JOIN public.shipping_zones z ON z.id = pz.zone_id
    WHERE pz.province = v_province;

    IF v_ship_fee IS NULL THEN
      SELECT coalesce((SELECT value FROM public.store_settings WHERE key = 'shipping_fee')::numeric, 150)
        INTO v_ship_fee;
      SELECT coalesce((SELECT value FROM public.store_settings WHERE key = 'free_shipping_threshold')::numeric, 1500)
        INTO v_free_at;
    END IF;

    v_shipping := CASE
      WHEN v_free_at > 0 AND v_computed_subtotal >= v_free_at THEN 0
      ELSE v_ship_fee
    END;
  END IF;

  -- Authoritative totals from server-side prices. The client-supplied discount is
  -- honoured, but subtotal/shipping/total are trusted from the database only.
  v_net_subtotal := greatest(0, v_computed_subtotal - v_discount);
  v_order_total  := v_net_subtotal + v_shipping;
  v_order_profit := v_net_subtotal - v_order_total_cost;  -- merchandise margin, excludes shipping

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

-- 6. PUBLIC ORDER LOOKUP — include shipping + province ------------
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
    'payment_method', v_order.payment_method,
    'created_at', v_order.created_at,
    'items', v_items
  );
END;
$$;

-- 7. CUSTOMER ORDER TRACKING — include shipping + province --------
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
    'courier',          v_order.courier,
    'tracking_number',  v_order.tracking_number,
    'created_at',       v_order.created_at,
    'updated_at',       v_order.updated_at,
    'items',            coalesce(v_items, '[]'::jsonb)
  );
END;
$$;
