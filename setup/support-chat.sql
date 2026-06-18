-- ============================================================
-- AI Customer-Support Chat — Phase 1: schema, security, realtime
-- See SUPPORT_BOT_PLAN.md. Safe to re-run (idempotent).
--
-- Security model:
--   • Admins (authenticated + is_admin()) get full RLS access.
--   • Anonymous customers get NO direct table access — they go through
--     SECURITY DEFINER RPCs gated by an unguessable access_token.
--   • Customers receive live replies via a realtime broadcast on
--     topic 'convo:<access_token>' (no table SELECT needed).
-- ============================================================

-- ── Tables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token    uuid NOT NULL DEFAULT gen_random_uuid(),  -- customer bearer secret
  status          text NOT NULL DEFAULT 'ai'
                    CHECK (status IN ('ai','needs_human','with_admin','resolved')),
  customer_name   text,
  customer_email  text,
  assigned_admin  uuid REFERENCES auth.users(id),
  page_url        text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_preview    text,
  unread_admin    int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('customer','ai','admin','system')),
  body            text NOT NULL,
  admin_id        uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_convo
  ON support_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_conv_status
  ON support_conversations (status, last_message_at DESC);

-- ── Row-level security ──────────────────────────────────────
ALTER TABLE support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages      ENABLE ROW LEVEL SECURITY;

-- Admins: full access. (No anon policies => anon cannot touch tables directly.)
DROP POLICY IF EXISTS support_conv_admin_all ON support_conversations;
CREATE POLICY support_conv_admin_all ON support_conversations
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS support_msg_admin_all ON support_messages;
CREATE POLICY support_msg_admin_all ON support_messages
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ── Keep parent conversation fresh + broadcast to the customer ──
CREATE OR REPLACE FUNCTION support_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token uuid;
BEGIN
  -- Bump the parent thread; count unread for admins on customer messages.
  UPDATE support_conversations
     SET last_message_at = NEW.created_at,
         last_preview    = left(NEW.body, 140),
         unread_admin    = unread_admin + (CASE WHEN NEW.role = 'customer' THEN 1 ELSE 0 END)
   WHERE id = NEW.conversation_id
   RETURNING access_token INTO v_token;

  -- Live-push the message to the customer's private-by-obscurity channel.
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'conversation_id', NEW.conversation_id,
      'role', NEW.role,
      'body', NEW.body,
      'created_at', NEW.created_at
    ),
    'message',                       -- event name
    'convo:' || v_token::text,       -- topic (token is the secret)
    false                            -- public broadcast on an unguessable topic
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_on_message ON support_messages;
CREATE TRIGGER trg_support_on_message
  AFTER INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION support_on_message();

-- ── Anonymous customer RPCs (token-gated) ───────────────────

-- Start a thread; returns the id + bearer token + greeting, and seeds
-- the AI greeting as the first message.
CREATE OR REPLACE FUNCTION support_start(p_page_url text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id    uuid;
  v_token uuid;
  v_greet text;
BEGIN
  INSERT INTO support_conversations (page_url)
  VALUES (p_page_url)
  RETURNING id, access_token INTO v_id, v_token;

  SELECT value INTO v_greet FROM store_settings WHERE key = 'support_greeting';
  IF v_greet IS NOT NULL AND length(trim(v_greet)) > 0 THEN
    INSERT INTO support_messages (conversation_id, role, body)
    VALUES (v_id, 'ai', v_greet);
  END IF;

  RETURN json_build_object(
    'conversation_id', v_id,
    'access_token',    v_token,
    'greeting',        v_greet
  );
END;
$$;

-- Internal helper: validate a (conversation, token) pair.
CREATE OR REPLACE FUNCTION support_auth(p_conversation_id uuid, p_access_token uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM support_conversations
    WHERE id = p_conversation_id AND access_token = p_access_token
  ) THEN
    RAISE EXCEPTION 'invalid conversation token' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Post a customer message; returns the new message id + current status
-- (so the widget knows whether to ask the AI backend for a reply).
CREATE OR REPLACE FUNCTION support_post(
  p_conversation_id uuid,
  p_access_token    uuid,
  p_body            text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     uuid;
  v_status text;
  v_body   text := trim(coalesce(p_body, ''));
BEGIN
  PERFORM support_auth(p_conversation_id, p_access_token);

  IF length(v_body) = 0 OR length(v_body) > 4000 THEN
    RAISE EXCEPTION 'message must be 1–4000 characters';
  END IF;

  INSERT INTO support_messages (conversation_id, role, body)
  VALUES (p_conversation_id, 'customer', v_body)
  RETURNING id INTO v_id;

  SELECT status INTO v_status FROM support_conversations WHERE id = p_conversation_id;
  RETURN json_build_object('id', v_id, 'status', v_status);
END;
$$;

-- Load a thread's history (no secrets returned).
CREATE OR REPLACE FUNCTION support_fetch(
  p_conversation_id uuid,
  p_access_token    uuid
)
RETURNS TABLE (id uuid, role text, body text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM support_auth(p_conversation_id, p_access_token);
  RETURN QUERY
    SELECT m.id, m.role, m.body, m.created_at
    FROM support_messages m
    WHERE m.conversation_id = p_conversation_id
    ORDER BY m.created_at ASC;
END;
$$;

-- Capture name/email at escalation.
CREATE OR REPLACE FUNCTION support_set_contact(
  p_conversation_id uuid,
  p_access_token    uuid,
  p_name            text,
  p_email           text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM support_auth(p_conversation_id, p_access_token);
  UPDATE support_conversations
     SET customer_name  = NULLIF(trim(coalesce(p_name, '')), ''),
         customer_email = NULLIF(trim(coalesce(p_email, '')), '')
   WHERE id = p_conversation_id;
END;
$$;

-- Only anon/authenticated may execute these (not the broad PUBLIC role).
REVOKE EXECUTE ON FUNCTION support_start(text)                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION support_post(uuid, uuid, text)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION support_fetch(uuid, uuid)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION support_set_contact(uuid, uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION support_start(text)                       TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION support_post(uuid, uuid, text)            TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION support_fetch(uuid, uuid)                 TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION support_set_contact(uuid, uuid, text, text) TO anon, authenticated;
-- support_auth is internal; keep it off the API surface.
REVOKE EXECUTE ON FUNCTION support_auth(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Realtime: publish tables for the admin console (postgres_changes) ──
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE support_conversations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE support_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Settings (CMS-editable) ─────────────────────────────────
INSERT INTO store_settings (key, value) VALUES
  ('support_enabled', 'false'),
  ('support_greeting',
   'Hi! 👋 I''m the NGL Accessories assistant. Ask me about your order, shipping, returns, or our jewelry — and I''ll connect you with a teammate whenever you need a human.'),
  ('support_kb',
   E'NGL Accessories — support facts for the assistant:\n'
   '- Delivery: Metro Cebu only (Cebu City up to Consolacion). Options at checkout: free Meetup, or Maxim/Movit delivery (rider fare paid to the rider on arrival). Orders usually ready in 1–2 days.\n'
   '- Payment: GCash, bank transfer, or cash (meetup/on delivery). For GCash/bank, the customer enters a reference number or uploads a receipt at checkout.\n'
   '- Returns/exchanges: unworn items in original condition within 7 days of delivery; email support with the order number. Return shipping is on the customer unless the item arrived damaged/incorrect.\n'
   '- Jewelry: water-resistant for everyday wear (handwashing, light sweat); remove before pools/sea to maximise lifespan.\n'
   '- Order tracking: customers can check status at /track-order.html using their order number + email.\n'
   '- Escalate to a human for: refunds/complaints, payment disputes, anything you are unsure about, or whenever the customer asks for a person.')
ON CONFLICT (key) DO NOTHING;
