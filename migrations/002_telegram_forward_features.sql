-- Telegram forward monitoring + multi-channel + trends
ALTER TABLE monitored_channels ADD COLUMN IF NOT EXISTS forward_mode TEXT DEFAULT 'copy';
ALTER TABLE monitored_channels ADD COLUMN IF NOT EXISTS use_ai INTEGER DEFAULT 0;
ALTER TABLE monitored_channels ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1;

ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_channels TEXT;

CREATE TABLE IF NOT EXISTS telegram_seen_messages (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT NOT NULL,
  source_chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, source_chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_seen_user ON telegram_seen_messages(user_id, source_chat_id);

CREATE TABLE IF NOT EXISTS trends_snapshots (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  topics JSONB NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_drafts (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  image_url TEXT,
  channels JSONB,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
