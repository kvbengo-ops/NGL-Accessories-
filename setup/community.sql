-- ============================================================
-- NGL Accessories — NGL Circle (community feed + reviews)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ------------------------------------------------------------
--   • community_posts — short posts (+ optional photo and 1–5 stars)
--     shown on review.html.
--   • create_community_post() — the ONLY insert path.
--       – Email or mobile number matches a DELIVERED online order
--         → published immediately with a "Verified buyer" badge.
--       – Anything else (no contact, or no matching order)
--         → 'pending', waiting in Admin → NGL Circle for approval.
--   • admin_list_community_posts() / admin_set_community_post_status()
--     — moderation, admins only. Contact details only leave through these.
--   • react_to_post() — anonymous positive reactions on published posts.
--   • community-photos bucket — public images, small uploads only.
--
-- Self-contained & idempotent. Depends on public.orders and
-- public.is_admin() (setup/audit-fixes.sql).
-- ============================================================

-- 1. Posts ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'published', 'rejected')),
  is_verified   boolean NOT NULL DEFAULT false,
  order_id      uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  contact_email text,   -- private (admins only), lower-cased
  contact_phone text,   -- private (admins only), last 10 digits
  author_name   text CHECK (char_length(author_name) <= 50),
  caption       text NOT NULL CHECK (char_length(caption) BETWEEN 1 AND 500),
  rating        smallint CHECK (rating BETWEEN 1 AND 5),
  photo_path    text,   -- object name inside the community-photos bucket
  reactions     jsonb NOT NULL DEFAULT '{"love":0,"sparkle":0,"clap":0,"hug":0}'::jsonb,
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_posts_feed_idx
  ON public.community_posts (created_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS community_posts_status_idx
  ON public.community_posts (status, created_at DESC);

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

-- Everyone (signed in or not) reads published posts, public columns only.
-- Column grants can't vary by policy, so admins don't read this table
-- directly either — they go through the admin_* functions below. That keeps
-- contact details private even from any non-admin signed-in account.
DROP POLICY IF EXISTS community_posts_public_read ON public.community_posts;
CREATE POLICY community_posts_public_read ON public.community_posts
  FOR SELECT TO anon, authenticated USING (status = 'published');

REVOKE ALL ON public.community_posts FROM anon, authenticated;
GRANT SELECT (id, author_name, caption, rating, photo_path, reactions, is_verified, created_at)
  ON public.community_posts TO anon, authenticated;

-- 2. Create a post --------------------------------------------------
-- Drop the earlier drafts of this function (never shipped, but be safe).
DROP FUNCTION IF EXISTS public.create_community_post(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_community_post(text, text, text, text);
DROP FUNCTION IF EXISTS public.create_community_post(text, text, text, int, text);

CREATE OR REPLACE FUNCTION public.create_community_post(
  p_contact      text,   -- optional: email or mobile number
  p_author_name  text,
  p_caption      text,
  p_rating       int,    -- optional: 1–5
  p_photo_path   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact  text := trim(coalesce(p_contact, ''));
  v_email    text;
  v_phone    text;
  v_order_id uuid;
  v_caption  text := trim(coalesce(p_caption, ''));
  v_name     text := nullif(left(trim(coalesce(p_author_name, '')), 50), '');
  v_photo    text := nullif(trim(coalesce(p_photo_path, '')), '');
  v_post     public.community_posts;
BEGIN
  IF char_length(v_caption) = 0 THEN
    RAISE EXCEPTION 'Please write a few words about your NGL moment.';
  END IF;
  IF char_length(v_caption) > 500 THEN
    RAISE EXCEPTION 'Please keep your post under 500 characters.';
  END IF;
  IF p_rating IS NOT NULL AND (p_rating < 1 OR p_rating > 5) THEN
    RAISE EXCEPTION 'Star ratings go from 1 to 5.';
  END IF;

  -- Mobile numbers compare on their last 10 digits, so 0917…, +63 917…
  -- and 917… all match the same order.
  IF v_contact LIKE '%@%' THEN
    v_email := lower(v_contact);
  ELSIF v_contact <> '' THEN
    v_phone := right(regexp_replace(v_contact, '\D', '', 'g'), 10);
    IF char_length(v_phone) < 10 THEN
      RAISE EXCEPTION 'Please enter a full mobile number, or an email.';
    END IF;
  END IF;

  IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
    -- ponytail: knowing a customer's email or number is enough to post as a
    -- verified buyer, and instant-vs-pending hints whether it has ordered.
    -- Add an emailed/SMS one-time code if that ever matters.
    SELECT id INTO v_order_id
    FROM public.orders
    WHERE type = 'online'
      AND status = 'delivered'
      AND (   (v_email IS NOT NULL AND lower(customer_email) = v_email)
           OR (v_phone IS NOT NULL
               AND right(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), 10) = v_phone))
    ORDER BY created_at DESC
    LIMIT 1;

    -- Max 3 posts a day per email / number.
    IF (SELECT count(*) FROM public.community_posts
        WHERE created_at > now() - interval '1 day'
          AND (contact_email = v_email OR contact_phone = v_phone)) >= 3 THEN
      RAISE EXCEPTION 'You have shared a lot today. Please post again tomorrow.';
    END IF;
  END IF;

  -- ponytail: unverified posts can't be limited per person (anyone can type
  -- any email), so a global cap keeps the review queue from being flooded.
  -- Raise it if genuine traffic ever hits it.
  IF v_order_id IS NULL AND (SELECT count(*) FROM public.community_posts
      WHERE status = 'pending' AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'We are getting a lot of posts right now. Please try again in a little while.';
  END IF;

  -- Photos must be an upload the page just made (posts/<ms>-<uuid>.jpg),
  -- never an arbitrary URL.
  IF v_photo IS NOT NULL AND (
       v_photo !~ '^posts/[0-9]+-[0-9a-f-]{36}\.jpg$'
       OR NOT EXISTS (SELECT 1 FROM storage.objects
                      WHERE bucket_id = 'community-photos' AND name = v_photo)
     ) THEN
    RAISE EXCEPTION 'That photo could not be attached. Please add it again.';
  END IF;

  INSERT INTO public.community_posts
    (status, is_verified, order_id, contact_email, contact_phone,
     author_name, caption, rating, photo_path)
  VALUES
    (CASE WHEN v_order_id IS NULL THEN 'pending' ELSE 'published' END,
     v_order_id IS NOT NULL, v_order_id, v_email, v_phone,
     v_name, v_caption, p_rating, v_photo)
  RETURNING * INTO v_post;

  -- Never echo contact details back.
  RETURN jsonb_build_object(
    'id',          v_post.id,
    'status',      v_post.status,
    'is_verified', v_post.is_verified,
    'author_name', v_post.author_name,
    'caption',     v_post.caption,
    'rating',      v_post.rating,
    'photo_path',  v_post.photo_path,
    'reactions',   v_post.reactions,
    'created_at',  v_post.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_community_post(text, text, text, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_community_post(text, text, text, int, text) TO anon, authenticated;

-- 3. React to a post --------------------------------------------
CREATE OR REPLACE FUNCTION public.react_to_post(
  p_post_id  uuid,
  p_reaction text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_reactions jsonb;
BEGIN
  IF p_reaction IS NULL OR p_reaction NOT IN ('love', 'sparkle', 'clap', 'hug') THEN
    RAISE EXCEPTION 'Unknown reaction.';
  END IF;

  -- ponytail: anonymous and uncapped server-side; the page remembers what a
  -- visitor already tapped. Add a per-visitor table if counts get gamed.
  UPDATE public.community_posts
  SET reactions = jsonb_set(
        reactions, ARRAY[p_reaction],
        to_jsonb(coalesce((reactions ->> p_reaction)::int, 0) + 1))
  WHERE id = p_post_id AND status = 'published'
  RETURNING reactions INTO v_reactions;

  RETURN v_reactions;  -- null when the post is missing or not published
END;
$$;

REVOKE ALL ON FUNCTION public.react_to_post(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.react_to_post(uuid, text) TO anon, authenticated;

-- 4. Moderation (admins only) ------------------------------------
-- ponytail: newest 200 (pending always first); add paging if the queue grows.
CREATE OR REPLACE FUNCTION public.admin_list_community_posts(p_status text)
RETURNS SETOF public.community_posts
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT * FROM public.community_posts
    WHERE p_status IS NULL OR status = p_status
    ORDER BY (status = 'pending') DESC, created_at DESC
    LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_community_posts(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_community_posts(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_community_post_status(
  p_post_id uuid,
  p_status  text
) RETURNS public.community_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_post public.community_posts;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'published', 'rejected') THEN
    RAISE EXCEPTION 'Unknown status.';
  END IF;

  UPDATE public.community_posts
  SET status = p_status, reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = p_post_id
  RETURNING * INTO v_post;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found.';
  END IF;
  RETURN v_post;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_community_post_status(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_community_post_status(uuid, text) TO authenticated;

-- 5. Photo bucket -------------------------------------------------
-- Public URLs for the feed; bucket limits reject anything but small images
-- (the page resizes to ≤1600px JPEG, which also strips EXIF/GPS).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('community-photos', 'community-photos', true, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Upload only into posts/. No SELECT policy on purpose: public URLs still
-- work for a public bucket, but visitors can't list every uploaded file.
-- ponytail: uploads aren't gated (same model as payment-proofs);
-- create_community_post only accepts a photo that exists here, so an
-- abandoned upload just sits unused. Sweep unreferenced objects if it grows.
DROP POLICY IF EXISTS community_photos_anon_insert ON storage.objects;
CREATE POLICY community_photos_anon_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'community-photos'
    AND (storage.foldername(name))[1] = 'posts'
  );
