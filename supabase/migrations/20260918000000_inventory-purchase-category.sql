-- ============================================================
-- NGL Accessories — "Inventory Purchase" expense category
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- RUN THIS BEFORE deploying the matching site build: the inventory
-- page now logs stock purchases under 'Inventory Purchase', which the
-- old CHECK rejects (the insert fails silently and nothing is logged).
-- ------------------------------------------------------------
--   • Stock purchases are an asset swap (cash → inventory), not an
--     operating cost. Their cost reaches the P&L as order total_cost
--     (COGS) when the item sells. Keeping them in operating expenses
--     subtracted every sold item's cost twice.
--   • The dashboard leaves this category out of operating expenses
--     and shows it as a separate "Spent on stock" line.
-- ============================================================

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_category_check CHECK (category IN (
  'Ads & Marketing', 'Packaging Supplies', 'Shipping/Logistics',
  'Software & Hosting', 'Operations/Other', 'Inventory Purchase'
));

-- Move the rows the inventory page auto-logged under 'Packaging Supplies'.
UPDATE public.expenses
SET category = 'Inventory Purchase'
WHERE category = 'Packaging Supplies'
  AND (title LIKE 'Inventory purchase:%' OR title LIKE 'Restock:%');
