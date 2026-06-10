-- ============================================================
-- NGL Accessories — Newsletter Welcome Emails
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
-- Fires the `newsletter-welcome` Edge Function whenever someone
-- joins the Inner Circle (INSERT into newsletter_subscribers),
-- which sends them a branded welcome email via Resend.
--
-- PREREQUISITES
--   1. Deploy the function:
--        supabase functions deploy newsletter-welcome --no-verify-jwt
--   2. It reuses the secrets already set for order-notification
--      (RESEND_API_KEY, FROM_EMAIL, STORE_URL, WEBHOOK_SECRET) —
--      nothing new to set.
--   3. Replace <WEBHOOK_SECRET> below with the SAME value as the
--      function's WEBHOOK_SECRET secret.
-- ============================================================

-- pg_net lets Postgres make outbound HTTP calls
create extension if not exists pg_net;

create or replace function public.notify_newsletter_signup()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url     := 'https://vevzlrnwhckuekkvujhq.supabase.co/functions/v1/newsletter-welcome',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-webhook-secret', '@Bebong123'
    ),
    body    := jsonb_build_object(
      'type',   'INSERT',
      'table',  'newsletter_subscribers',
      'record', to_jsonb(NEW)
    )
  );
  return NEW;
end;
$$;

drop trigger if exists on_newsletter_signup on public.newsletter_subscribers;
create trigger on_newsletter_signup
  after insert on public.newsletter_subscribers
  for each row
  execute function public.notify_newsletter_signup();

-- ------------------------------------------------------------
-- NOTE: pg_net queues the request and sends it AFTER the
-- transaction commits, so duplicate-email inserts that fail the
-- unique constraint never trigger an email.
-- ------------------------------------------------------------
