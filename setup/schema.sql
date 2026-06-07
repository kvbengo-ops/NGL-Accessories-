-- ============================================================
-- NGL Accessories — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  collection    text NOT NULL CHECK (collection IN ('Natural','Grace','Lush')),
  category      text NOT NULL CHECK (category IN ('Earrings','Rings','Bracelets','Necklaces','Anklets')),
  cost_price    numeric(10,2) DEFAULT 0,
  price         numeric(10,2) NOT NULL,
  description   text,
  image_url     text,
  tags          text[],
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

-- Safely add cost_price if the table already existed before this script
DO $$ BEGIN
  ALTER TABLE products ADD COLUMN cost_price numeric(10,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;


-- 2. INVENTORY
CREATE TABLE IF NOT EXISTS inventory (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           uuid REFERENCES products(id) ON DELETE CASCADE UNIQUE,
  stock                integer NOT NULL DEFAULT 0,
  low_stock_threshold  integer NOT NULL DEFAULT 5,
  updated_at           timestamptz DEFAULT now()
);

-- 3. ORDERS
CREATE TABLE IF NOT EXISTS orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     text UNIQUE NOT NULL,
  type             text NOT NULL CHECK (type IN ('online','pos')),
  status           text NOT NULL DEFAULT 'pending',
  customer_name    text,
  customer_email   text,
  customer_phone   text,
  delivery_address text,
  order_notes      text,
  payment_method   text,
  subtotal         numeric(10,2) NOT NULL,
  discount         numeric(10,2) DEFAULT 0,
  total            numeric(10,2) NOT NULL,
  total_cost       numeric(10,2) DEFAULT 0,
  profit           numeric(10,2) DEFAULT 0,
  handled_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE orders ADD COLUMN total_cost numeric(10,2) DEFAULT 0;
  ALTER TABLE orders ADD COLUMN profit numeric(10,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;


-- 4. ORDER ITEMS
CREATE TABLE IF NOT EXISTS order_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid REFERENCES orders(id) ON DELETE CASCADE,
  product_id   uuid REFERENCES products(id),
  product_name text NOT NULL,
  cost_price   numeric(10,2) DEFAULT 0,
  price        numeric(10,2) NOT NULL,
  quantity     integer NOT NULL,
  subtotal     numeric(10,2) NOT NULL,
  profit       numeric(10,2) DEFAULT 0
);

DO $$ BEGIN
  ALTER TABLE order_items ADD COLUMN cost_price numeric(10,2) DEFAULT 0;
  ALTER TABLE order_items ADD COLUMN profit numeric(10,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;


-- 5. ADMINS (profile table extending auth.users)
CREATE TABLE IF NOT EXISTS admins (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  role        text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','superadmin')),
  is_active   boolean DEFAULT true,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  last_login  timestamptz
);

-- 6. SALES SUMMARY VIEW
CREATE OR REPLACE VIEW sales_summary AS
SELECT
  date_trunc('day', created_at AT TIME ZONE 'Asia/Manila') AS sale_date,
  COUNT(*) AS order_count,
  SUM(total) AS revenue,
  SUM(profit) AS profit
FROM orders
WHERE status NOT IN ('cancelled','voided')
GROUP BY 1
ORDER BY 1;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE products   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_public_read" ON products;
CREATE POLICY "products_public_read"  ON products   FOR SELECT USING (true);

DROP POLICY IF EXISTS "products_admin_write" ON products;
CREATE POLICY "products_admin_write"  ON products   FOR ALL    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "inventory_public_read" ON inventory;
CREATE POLICY "inventory_public_read" ON inventory  FOR SELECT USING (true);

DROP POLICY IF EXISTS "inventory_admin_write" ON inventory;
CREATE POLICY "inventory_admin_write" ON inventory  FOR ALL    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "orders_anon_insert" ON orders;
CREATE POLICY "orders_anon_insert"    ON orders     FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "orders_admin_all" ON orders;
CREATE POLICY "orders_admin_all"      ON orders     FOR ALL    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "order_items_anon_insert" ON order_items;
CREATE POLICY "order_items_anon_insert" ON order_items FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "order_items_admin_all" ON order_items;
CREATE POLICY "order_items_admin_all"   ON order_items FOR ALL    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "admins_authenticated" ON admins;
CREATE POLICY "admins_authenticated"  ON admins     FOR ALL    USING (auth.role() = 'authenticated');

-- ============================================================
-- SEED DATA — Products (only inserts if table is empty)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products) THEN
    INSERT INTO products (name, collection, category, cost_price, price, description, image_url, tags) VALUES
    ('Dainty Chain Bracelet',    'Natural', 'Bracelets', 120, 380, 'Delicate sterling-silver chain with a hand-polished finish. Light and stackable — perfect for everyday wear.',              '/images/natural_chain_bracelet.png',      ARRAY['#minimalist','#stackable','#sterling']),
    ('Pearl Stud Earrings',      'Natural', 'Earrings',  90,  290, 'Freshwater pearls set in brushed silver. Timeless studs that complement any outfit effortlessly.',                          '/images/natural_pearl_studs.png',         ARRAY['#freshwater','#classic','#everyday']),
    ('Slim Band Ring',           'Natural', 'Rings',     75,  250, 'Smooth slim band crafted from recycled silver. Minimalist design that stacks beautifully.',                                  '/images/natural_slim_ring.png',           ARRAY['#ring','#minimalist','#recycled']),
    ('Crystal Drop Earrings',    'Grace',   'Earrings',  210, 650, 'Hand-set Swarovski-grade crystals cascade gracefully from 18K gold-plated hooks. Pure refined elegance.',                    '/images/grace_crystal_earrings.png',      ARRAY['#crystal','#goldplated','#luxury']),
    ('Statement Choker',         'Grace',   'Necklaces', 250, 780, 'Layered gold-tone chain choker with a vintage clasp. Makes a bold statement at any occasion.',                               '/images/grace_statement_choker.png',      ARRAY['#choker','#statement','#vintage']),
    ('Layered Bracelet Set',     'Grace',   'Bracelets', 180, 590, 'Curated set of three gold-plated bracelets — chain, beaded, and twisted rope — designed to layer together.',                 '/images/grace_layered_bracelet_set.png',  ARRAY['#set','#layered','#goldplated']),
    ('Shell Drop Earrings',      'Lush',    'Earrings',  140, 420, 'Natural white shells with coral-tinted trim, wire-wrapped on brass hooks. Effortless tropical charm.',                       '/images/lush_shell_earrings.png',         ARRAY['#shell','#boho','#tropical']),
    ('Turquoise Beaded Bracelet','Lush',    'Bracelets', 110, 360, 'Genuine turquoise beads hand-knotted on stretch elastic. Bold colour that catches the light.',                               '/images/lush_turquoise_bracelet.png',     ARRAY['#turquoise','#beaded','#bold']),
    ('Floral Charm Anklet',      'Lush',    'Anklets',   95,  310, 'Dainty brass chain with hand-painted enamel flower charms. Playful, colourful, and adjustable.',                             '/images/lush_floral_anklet.png',          ARRAY['#anklet','#floral','#enamel']);
  END IF;
END $$;

-- ============================================================
-- SEED DATA — Inventory
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inventory) THEN
    INSERT INTO inventory (product_id, stock, low_stock_threshold)
    SELECT id, 20, 5 FROM products;
  END IF;
END $$;

-- ============================================================
-- HELPER FUNCTION — auto-update updated_at on orders
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS inventory_updated_at ON inventory;
CREATE TRIGGER inventory_updated_at
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AUTOMATICALLY SYNC AUTH.USERS TO ADMINS TABLE
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.admins (id, name, role, is_active)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Admin'),
    CASE WHEN (SELECT count(*) FROM public.admins) = 0 THEN 'superadmin' ELSE 'admin' END,
    true
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 7. TRANSACTION SAFE ORDER CREATION WITH STOCK LOCKING
-- ============================================================

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

  INSERT INTO public.orders (
    order_number, type, status, customer_name, customer_email, customer_phone,
    delivery_address, order_notes, payment_method, subtotal, discount, total, handled_by
  ) VALUES (
    v_order_number,
    p_order_data->>'type',
    coalesce(p_order_data->>'status', 'pending'),
    p_order_data->>'customer_name',
    p_order_data->>'customer_email',
    p_order_data->>'customer_phone',
    p_order_data->>'delivery_address',
    p_order_data->>'order_notes',
    p_order_data->>'payment_method',
    (p_order_data->>'subtotal')::numeric(10,2),
    (p_order_data->>'discount')::numeric(10,2),
    (p_order_data->>'total')::numeric(10,2),
    (p_order_data->>'handled_by')::uuid
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_price := (v_item->>'price')::numeric(10,2);
    v_name := v_item->>'product_name';
    v_subtotal := v_price * v_qty;

    SELECT coalesce(cost_price, 0) INTO v_item_cost FROM public.products WHERE id = v_product_id;
    
    v_item_profit := v_subtotal - (v_item_cost * v_qty);
    v_order_total_cost := v_order_total_cost + (v_item_cost * v_qty);
    v_order_profit := v_order_profit + v_item_profit;

    INSERT INTO public.order_items (order_id, product_id, product_name, cost_price, price, quantity, subtotal, profit)
    VALUES (v_order_id, v_product_id, v_name, v_item_cost, v_price, v_qty, v_subtotal, v_item_profit);

    UPDATE public.inventory
    SET stock = stock - v_qty,
        updated_at = now()
    WHERE product_id = v_product_id;
  END LOOP;

  -- Update order with total cost and profit
  UPDATE public.orders
  SET total_cost = v_order_total_cost,
      profit = v_order_profit
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number
  );
END;
$$;

-- ============================================================
-- 8. SECURE ADMIN USER CREATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_admin_user(
  p_email text,
  p_password text,
  p_name text,
  p_role text,
  p_creator_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_encrypted_pw text;
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admins
    WHERE id = auth.uid() AND role = 'superadmin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only superadmins can create new admins';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'Email already registered';
  END IF;

  v_user_id := gen_random_uuid();
  v_encrypted_pw := crypt(p_password, gen_salt('bf'));

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
  ) VALUES (
    v_user_id, '00000000-0000-0000-0000-000000000000', p_email, v_encrypted_pw, now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', p_name),
    'authenticated', 'authenticated', now(), now()
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_user_id, v_user_id, jsonb_build_object('sub', v_user_id, 'email', p_email),
    'email', now(), now(), now()
  );

  INSERT INTO public.admins (id, name, role, is_active, created_by, created_at)
  VALUES (v_user_id, p_name, p_role, true, p_creator_id, now());

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id
  );
END;
$$;

-- ============================================================
-- 9. ADMIN TASKS (TODO LIST)
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  assigned_to uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  due_date timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE admin_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_tasks_all" ON admin_tasks;
CREATE POLICY "admin_tasks_all" ON admin_tasks FOR ALL USING (auth.role() = 'authenticated');

DROP TRIGGER IF EXISTS admin_tasks_updated_at ON admin_tasks;
CREATE TRIGGER admin_tasks_updated_at
  BEFORE UPDATE ON admin_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 10. BUSINESS EXPENSES
-- ============================================================

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('Ads & Marketing', 'Packaging Supplies', 'Shipping/Logistics', 'Software & Hosting', 'Operations/Other')),
  amount numeric(10,2) NOT NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_all" ON expenses;
CREATE POLICY "expenses_all" ON expenses FOR ALL USING (auth.role() = 'authenticated');

DROP TRIGGER IF EXISTS expenses_updated_at ON expenses;
CREATE TRIGGER expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 9. PRODUCT ENGAGEMENT (Views & Likes)
-- ============================================================

-- Safely add engagement columns if the table already existed
DO $$ BEGIN
  ALTER TABLE products ADD COLUMN likes_count integer DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- A secure remote procedure call to increment likes 
-- without exposing direct write access to anonymous users.
CREATE OR REPLACE FUNCTION increment_engagement(product_id uuid, type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF type = 'like' THEN
    UPDATE products SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = product_id;
  END IF;
END;
$$;
