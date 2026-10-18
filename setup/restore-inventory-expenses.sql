-- ============================================================
-- NGL Accessories — Restore Inventory Cost Expenses
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- What this does:
--   Recreates one "Inventory purchase" expense row per active
--   product that has a cost_price > 0 and stock > 0, using the
--   current cost_price × stock figures in the products / inventory
--   tables.
--
-- When to run:
--   After accidentally deleting expenses via clear-sales-data.sql.
--
-- What this does NOT touch:
--   • products, inventory, orders — all read-only here
--   • Any existing expenses already in the table
-- ============================================================

INSERT INTO public.expenses (title, category, amount, expense_date, created_by)
SELECT
  'Inventory purchase: ' || p.name || ' (x' || i.stock || ')'  AS title,
  'Inventory Purchase'                                           AS category,
  p.cost_price * i.stock                                        AS amount,
  CURRENT_DATE                                                   AS expense_date,
  NULL                                                           AS created_by
FROM public.products   p
JOIN public.inventory  i ON i.product_id = p.id
WHERE p.is_active   = true
  AND p.cost_price  > 0
  AND i.stock       > 0;

-- Done!
--     One expense row has been inserted for every active product
--     that has a cost_price and stock on hand.
--
--     Check your Expenses page - you should now see entries like:
--       "Inventory purchase: Gold Ring (x12)"  P X,XXX.XX
--
-- Note: expense_date is set to TODAY (the restore date).
--     If you need the original purchase dates, update them
--     manually in the Expenses page after running this script.
