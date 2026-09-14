-- ============================================================
-- Contact Messages Table
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  subject text NOT NULL,
  message text NOT NULL,
  status text DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
  created_at timestamptz DEFAULT now()
);

-- Safely add phone if the table already existed
DO $$ BEGIN
  ALTER TABLE contact_messages ADD COLUMN phone text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Enable RLS
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to insert messages
DROP POLICY IF EXISTS "contact_messages_anon_insert" ON contact_messages;
CREATE POLICY "contact_messages_anon_insert" 
ON contact_messages 
FOR INSERT 
WITH CHECK (true);

-- Only authenticated users (admins) can view or modify messages
DROP POLICY IF EXISTS "contact_messages_admin_all" ON contact_messages;
CREATE POLICY "contact_messages_admin_all" 
ON contact_messages 
FOR ALL 
USING (auth.role() = 'authenticated');
