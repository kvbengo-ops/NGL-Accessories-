-- ============================================================
-- NGL Accessories — Proof of Payment (manual flow upgrade)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
-- Lets customers attach a screenshot of their GCash/bank payment
-- at checkout. The admin views it and approves (→ processing) or
-- rejects (→ cancelled) the order. No new status column — payment
-- verification maps onto the existing order status transitions.
--
-- Self-contained & idempotent. Does NOT touch create_order_safely,
-- so it deploys independently of the other migrations.
-- ============================================================

-- 1. Store the uploaded proof URL on the order ----------------
DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN payment_proof_url text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- 2. Anon-safe RPC to attach the proof after the order is made
-- The checkout is anonymous and the orders RLS only allows INSERT,
-- so the client can't UPDATE the row directly. This SECURITY DEFINER
-- function lets it attach a proof URL to its own just-created order,
-- with guards so it can't be used to tamper with other orders:
--   • online + still pending
--   • created within the last hour
--   • proof not already set (no overwrite)
CREATE OR REPLACE FUNCTION public.attach_payment_proof(
  p_order_id  uuid,
  p_proof_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.orders
  SET payment_proof_url = p_proof_url
  WHERE id = p_order_id
    AND type = 'online'
    AND status = 'pending'
    AND payment_proof_url IS NULL
    AND created_at > now() - interval '1 hour';
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_payment_proof(uuid, text) TO anon, authenticated;

-- 3. Storage bucket for the receipt screenshots ---------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (admin views via the URL); anonymous upload at checkout.
-- Filenames are random UUIDs so the public URLs are unguessable.
DROP POLICY IF EXISTS "payment_proofs_public_read" ON storage.objects;
CREATE POLICY "payment_proofs_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'payment-proofs');

DROP POLICY IF EXISTS "payment_proofs_anon_insert" ON storage.objects;
CREATE POLICY "payment_proofs_anon_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'payment-proofs');
