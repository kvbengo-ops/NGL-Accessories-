-- ============================================================
-- NGL Accessories — Database Audit Fixes
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
-- Idempotent and safe to re-run. Wrapped in a single transaction
-- so a failure rolls everything back. All new CHECK constraints
-- are added NOT VALID, so they enforce on NEW writes without
-- scanning/blocking on any pre-existing rows.
--
-- Addresses the audit findings:
--   #1  RLS gated on "is an active admin", not just "is logged in"
--   #3  Drop open anonymous INSERT on orders / order_items
--   #4  sales_summary view no longer bypasses RLS
--   #5  Missing indexes on FKs + hot filter columns
--   #6  orders.status CHECK constraint
--   #10 Non-negative / positivity CHECK constraints
--   #11 order_items.order_id NOT NULL
--   + handled_by ON DELETE SET NULL, newsletter email normalization,
--     store_settings numeric validation
--
-- NOT covered here (require manual / non-SQL action — see bottom):
--   #2  Rotate & scrub the leaked webhook secret  (@Bebong123)
--   #7  Edge function should re-fetch order totals, not trust payload
--   #9  Move admin password changes to the Supabase Admin API
--   Verify: Supabase Auth → public sign-ups are DISABLED
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. Helper: is the current user an active admin?
--    SECURITY DEFINER so it can read public.admins regardless of
--    RLS (and so a policy ON admins won't recurse into itself).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins
    WHERE id = auth.uid() AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- ------------------------------------------------------------
-- 1 + 3. Tighten Row Level Security
--    Replace every "auth.role() = 'authenticated'" policy with an
--    is_admin() check. Public SELECT is kept where the storefront
--    needs it. Anonymous INSERT on orders/order_items is dropped —
--    create_order_safely() is SECURITY DEFINER and bypasses RLS,
--    so the public checkout path keeps working without it.
-- ------------------------------------------------------------

-- PRODUCTS — public read, admin write
DROP POLICY IF EXISTS "products_admin_write" ON public.products;
CREATE POLICY "products_admin_write" ON public.products
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- INVENTORY — public read, admin write
DROP POLICY IF EXISTS "inventory_admin_write" ON public.inventory;
CREATE POLICY "inventory_admin_write" ON public.inventory
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ORDERS — admins only (public uses create_order_safely / get_order_* RPCs)
DROP POLICY IF EXISTS "orders_anon_insert" ON public.orders;
DROP POLICY IF EXISTS "orders_admin_all" ON public.orders;
CREATE POLICY "orders_admin_all" ON public.orders
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ORDER ITEMS — admins only (created server-side by the RPC)
DROP POLICY IF EXISTS "order_items_anon_insert" ON public.order_items;
DROP POLICY IF EXISTS "order_items_admin_all" ON public.order_items;
CREATE POLICY "order_items_admin_all" ON public.order_items
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ADMINS — only active admins can read/manage the admin roster
DROP POLICY IF EXISTS "admins_authenticated" ON public.admins;
DROP POLICY IF EXISTS "admins_all" ON public.admins;
CREATE POLICY "admins_all" ON public.admins
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ADMIN TASKS — admins only
DROP POLICY IF EXISTS "admin_tasks_all" ON public.admin_tasks;
CREATE POLICY "admin_tasks_all" ON public.admin_tasks
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- EXPENSES — admins only
DROP POLICY IF EXISTS "expenses_all" ON public.expenses;
CREATE POLICY "expenses_all" ON public.expenses
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- NEWSLETTER — keep public INSERT (signup), restrict read/manage to admins
DROP POLICY IF EXISTS "newsletter_admin_all" ON public.newsletter_subscribers;
CREATE POLICY "newsletter_admin_all" ON public.newsletter_subscribers
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- (newsletter_anon_insert is intentionally left in place.)

-- Make sure the public RPCs stay callable after the lock-down.
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.create_order_safely(jsonb, jsonb) TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_order_public(uuid)            TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_order_status(text, text)      TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.increment_engagement(uuid, text)  TO anon, authenticated;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'One or more public RPCs not found while granting EXECUTE — skipping.';
END $$;

-- ------------------------------------------------------------
-- 4. sales_summary must NOT bypass RLS (it aggregates revenue/profit)
--    security_invoker = on  → the view runs with the caller's RLS,
--    so only admins see results. Anon is revoked outright.
-- ------------------------------------------------------------
DO $$
BEGIN
  ALTER VIEW public.sales_summary SET (security_invoker = on);
  REVOKE ALL ON public.sales_summary FROM anon;
  GRANT SELECT ON public.sales_summary TO authenticated;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'View sales_summary not found — skipping security_invoker fix.';
END $$;

-- ------------------------------------------------------------
-- 5. Indexes on foreign keys + hot filter columns
--    (plain CREATE INDEX is fine at this data size; for very large
--     tables you'd use CREATE INDEX CONCURRENTLY outside a txn.)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_order_items_order_id   ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);

CREATE INDEX IF NOT EXISTS idx_orders_status      ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_type        ON public.orders (type);
CREATE INDEX IF NOT EXISTS idx_orders_created_at  ON public.orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_handled_by  ON public.orders (handled_by);
-- Functional index for get_order_status() which matches lower(customer_email)
CREATE INDEX IF NOT EXISTS idx_orders_customer_email_lower
  ON public.orders (lower(customer_email));

CREATE INDEX IF NOT EXISTS idx_admin_tasks_assigned_to ON public.admin_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_created_by  ON public.admin_tasks (created_by);

CREATE INDEX IF NOT EXISTS idx_expenses_created_by   ON public.expenses (created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON public.expenses (expense_date);

CREATE INDEX IF NOT EXISTS idx_products_is_active  ON public.products (is_active);
CREATE INDEX IF NOT EXISTS idx_products_collection ON public.products (collection);
CREATE INDEX IF NOT EXISTS idx_products_category   ON public.products (category);

-- ------------------------------------------------------------
-- 6 + 10. CHECK constraints (added NOT VALID so existing rows are
--    never scanned/blocked; they enforce on every new write).
--    Re-runnable: each is wrapped in a "skip if already present" guard.
--    NOTE: profit is intentionally NOT constrained — a loss is valid.
-- ------------------------------------------------------------
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('orders',      'orders_status_check',        $q$status IN ('pending','processing','shipped','delivered','cancelled','completed','voided')$q$),
    ('orders',      'orders_subtotal_nonneg',     'subtotal >= 0'),
    ('orders',      'orders_total_nonneg',        'total >= 0'),
    ('orders',      'orders_discount_nonneg',     'discount >= 0'),
    ('orders',      'orders_total_cost_nonneg',   'total_cost >= 0'),
    ('order_items', 'order_items_qty_positive',   'quantity > 0'),
    ('order_items', 'order_items_price_nonneg',   'price >= 0'),
    ('order_items', 'order_items_subtotal_nonneg','subtotal >= 0'),
    ('inventory',   'inventory_stock_nonneg',     'stock >= 0'),
    ('inventory',   'inventory_threshold_nonneg', 'low_stock_threshold >= 0'),
    ('products',    'products_price_nonneg',      'price >= 0'),
    ('products',    'products_cost_nonneg',       'cost_price >= 0'),
    ('expenses',    'expenses_amount_nonneg',     'amount >= 0')
  ) AS t(tbl, cname, expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = c.cname
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
        c.tbl, c.cname, c.expr
      );
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 11. order_items.order_id should never be NULL.
--     Guarded: only applied if there are no existing orphan rows.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id IS NULL) THEN
    ALTER TABLE public.order_items ALTER COLUMN order_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'order_items has rows with NULL order_id — clean them, then re-run to apply NOT NULL.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- orders.handled_by → ON DELETE SET NULL
--    Without this, deleting an admin's auth.users row is blocked
--    if they ever handled an order.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_handled_by_fkey') THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_handled_by_fkey;
  END IF;
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_handled_by_fkey
    FOREIGN KEY (handled_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

-- ------------------------------------------------------------
-- Newsletter: normalize email to lower(trim()) on write so the
-- existing UNIQUE(email) constraint becomes effectively
-- case-insensitive and stops duplicate subscribers.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_newsletter_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS newsletter_normalize_email ON public.newsletter_subscribers;
CREATE TRIGGER newsletter_normalize_email
  BEFORE INSERT OR UPDATE ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.normalize_newsletter_email();

-- ------------------------------------------------------------
-- store_settings: reject a non-numeric value for the keys that
-- create_order_safely() casts with ::numeric, so a bad save can't
-- break every online checkout.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_store_setting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IN ('shipping_fee', 'free_shipping_threshold') THEN
    IF NEW.value !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'store_settings.% must be a number, got: %', NEW.key, NEW.value;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS store_settings_validate ON public.store_settings;
CREATE TRIGGER store_settings_validate
  BEFORE INSERT OR UPDATE ON public.store_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_store_setting();

COMMIT;

-- ============================================================
-- OPTIONAL FOLLOW-UP (run later, off-peak, NOT in the txn above):
--   Validate the NOT VALID constraints against existing data. If any
--   of these error, you have legacy rows that violate the rule and
--   should be cleaned first.
-- ------------------------------------------------------------
--   ALTER TABLE public.orders      VALIDATE CONSTRAINT orders_status_check;
--   ALTER TABLE public.orders      VALIDATE CONSTRAINT orders_subtotal_nonneg;
--   ALTER TABLE public.orders      VALIDATE CONSTRAINT orders_total_nonneg;
--   ALTER TABLE public.orders      VALIDATE CONSTRAINT orders_discount_nonneg;
--   ALTER TABLE public.orders      VALIDATE CONSTRAINT orders_total_cost_nonneg;
--   ALTER TABLE public.order_items VALIDATE CONSTRAINT order_items_qty_positive;
--   ALTER TABLE public.order_items VALIDATE CONSTRAINT order_items_price_nonneg;
--   ALTER TABLE public.order_items VALIDATE CONSTRAINT order_items_subtotal_nonneg;
--   ALTER TABLE public.inventory   VALIDATE CONSTRAINT inventory_stock_nonneg;
--   ALTER TABLE public.inventory   VALIDATE CONSTRAINT inventory_threshold_nonneg;
--   ALTER TABLE public.products    VALIDATE CONSTRAINT products_price_nonneg;
--   ALTER TABLE public.products    VALIDATE CONSTRAINT products_cost_nonneg;
--   ALTER TABLE public.expenses    VALIDATE CONSTRAINT expenses_amount_nonneg;
-- ============================================================

-- ============================================================
-- MANUAL ACTIONS (cannot be done in SQL):
--   #2  setup/newsletter-emails.sql has a hardcoded webhook secret
--       ('@Bebong123'). Rotate WEBHOOK_SECRET on BOTH edge functions,
--       replace the literal with a placeholder, and scrub it from git
--       history (BFG / git filter-repo).
--   #7  supabase/functions/order-notification/index.ts trusts the
--       webhook payload's order header (subtotal/total/discount), which
--       is the pre-correction CLIENT value. Re-SELECT the order row by
--       id with the service role (as it already does for order_items)
--       so emails show the authoritative total.
--   #9  update_admin_password() writes auth.users directly. Prefer the
--       Supabase Admin API (auth.admin.updateUserById) from a trusted
--       edge function.
--   Verify in Supabase Dashboard → Authentication → Providers that
--   public email sign-ups are DISABLED (otherwise anyone can self-
--   register and handle_new_user() auto-adds them to admins).
-- ============================================================
