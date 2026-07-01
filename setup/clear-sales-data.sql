-- ============================================================
-- NGL Accessories — Clear All Test Data (Full Reset)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- What this does:
--   1. Restores inventory stock for all test orders
--      (the cancel trigger only fires on status changes,
--       not on DELETE, so we restore manually first)
--   2. Deletes all order_items
--   3. Deletes all orders
--   4. Deletes all expenses
--   5. Resets all product heart reactions (likes_count → 0)
--
-- What this does NOT touch:
--   • products (name, price, image, etc.)
--   • inventory (except restoring stock qty back to what it was)
--   • admins / store settings
--   • newsletter subscribers
-- ============================================================

BEGIN;

-- Step 1: Restore inventory for every order item before we delete them
UPDATE public.inventory inv
SET stock      = inv.stock + agg.total_qty,
    updated_at = now()
FROM (
  SELECT product_id, SUM(quantity) AS total_qty
  FROM   public.order_items
  WHERE  product_id IS NOT NULL
  GROUP  BY product_id
) AS agg
WHERE inv.product_id = agg.product_id;

-- Step 2: Delete all order line items
DELETE FROM public.order_items;

-- Step 3: Delete all orders
DELETE FROM public.orders;

-- Step 4: Delete all test expenses
DELETE FROM public.expenses;

-- Step 5: Reset all heart reactions (likes) back to zero
UPDATE public.products
SET likes_count = 0;

COMMIT;

-- ✅  Done! The following tables are now empty:
--     • order_items
--     • orders
--     • expenses
--
--     Heart reactions (likes_count) have been reset to 0 on all products.
--     Inventory stock has been fully restored.
--     Products, admins, and settings remain untouched.
