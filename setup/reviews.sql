-- ============================================================
-- NGL Accessories — Customer Reviews
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
--   • reviews table (public reads published ones)
--   • submit_review() RPC — the ONLY way to insert. It verifies
--     the reviewer actually has a DELIVERED online order (matched
--     by order number + email, same model as get_order_status),
--     so the review wall can't be spammed with fake entries.
-- ============================================================

create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders(id) on delete set null,
  order_number  text,
  customer_name text,
  rating        int not null check (rating between 1 and 5),
  body          text,
  is_published  boolean not null default true,
  created_at    timestamptz default now()
);

-- One review per order.
create unique index if not exists reviews_one_per_order
  on public.reviews(order_id) where order_id is not null;

alter table public.reviews enable row level security;

-- Anyone may read published reviews (the public review wall).
drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read" on public.reviews
  for select using (is_published = true);

-- Admins manage everything (moderate / unpublish).
drop policy if exists "reviews_admin_all" on public.reviews;
create policy "reviews_admin_all" on public.reviews
  for all using (auth.role() = 'authenticated');

-- Note: there is intentionally NO anon INSERT policy. The only insert
-- path is submit_review() below, which runs as SECURITY DEFINER after
-- confirming the order was delivered.

create or replace function public.submit_review(
  p_order_number text,
  p_email        text,
  p_rating       int,
  p_body         text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_order record;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Please choose a rating from 1 to 5 stars.';
  end if;

  select * into v_order
  from public.orders
  where order_number = trim(p_order_number)
    and lower(customer_email) = lower(trim(p_email))
    and type = 'online'
    and status = 'delivered';

  if not found then
    raise exception 'We could not find a delivered order matching those details.';
  end if;

  if exists (select 1 from public.reviews where order_id = v_order.id) then
    raise exception 'A review has already been submitted for this order. Thank you!';
  end if;

  insert into public.reviews (order_id, order_number, customer_name, rating, body)
  values (v_order.id, v_order.order_number, v_order.customer_name,
          p_rating, nullif(left(trim(coalesce(p_body, '')), 1000), ''));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.submit_review(text, text, int, text) to anon, authenticated;
