-- ============================================================
-- NGL Accessories — Order Email Notifications
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
-- Fires the `order-notification` Edge Function on every new
-- order, which emails the customer (confirmation) and the
-- admin (new-order alert) via Resend.
--
-- PREREQUISITES
--   1. Deploy the function:
--        supabase functions deploy order-notification --no-verify-jwt
--   2. Set its secrets (see the header of
--      supabase/functions/order-notification/index.ts).
--   3. Replace <WEBHOOK_SECRET> below with the SAME value you
--      set for the function's WEBHOOK_SECRET secret.
-- ============================================================

-- pg_net lets Postgres make outbound HTTP calls
create extension if not exists pg_net;

create or replace function public.notify_order_created()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url     := 'https://vevzlrnwhckuekkvujhq.supabase.co/functions/v1/order-notification',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-webhook-secret', '<WEBHOOK_SECRET>'
    ),
    body    := jsonb_build_object(
      'type',   'INSERT',
      'table',  'orders',
      'record', to_jsonb(NEW)
    )
  );
  return NEW;
end;
$$;

drop trigger if exists on_order_created on public.orders;
create trigger on_order_created
  after insert on public.orders
  for each row
  when (NEW.type = 'online')   -- skip in-store POS sales
  execute function public.notify_order_created();

-- ------------------------------------------------------------
-- NOTE: pg_net queues the request and sends it AFTER the order
-- transaction commits, so order_items are already written by
-- the time the function reads them. The function fetches items
-- itself, so they don't need to be in the payload above.
-- ------------------------------------------------------------

-- ============================================================
-- ORDER DELIVERED → thank-you + review-request email
-- Fires the same Edge Function with event = 'delivered' when an
-- online order's status transitions INTO 'delivered'.
-- ============================================================

create or replace function public.notify_order_delivered()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.status = 'delivered'
     and OLD.status is distinct from 'delivered'
     and NEW.type = 'online'
     and NEW.customer_email is not null then
    perform net.http_post(
      url     := 'https://vevzlrnwhckuekkvujhq.supabase.co/functions/v1/order-notification',
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'x-webhook-secret', '<WEBHOOK_SECRET>'
      ),
      body    := jsonb_build_object(
        'event',  'delivered',
        'table',  'orders',
        'record', to_jsonb(NEW)
      )
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_order_delivered on public.orders;
create trigger on_order_delivered
  after update of status on public.orders
  for each row
  execute function public.notify_order_delivered();
