-- Users table
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  language TEXT DEFAULT 'uz',
  role TEXT DEFAULT 'user',
  is_owner INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_approved INTEGER DEFAULT 0,
  is_premium INTEGER DEFAULT 0,
  premium_until TIMESTAMPTZ,
  referral_code TEXT UNIQUE,
  referral_count INTEGER DEFAULT 0,
  target_channel TEXT,
  extra_channels TEXT,
  interval_minutes INTEGER DEFAULT 15,
  keywords TEXT,
  schedule_times TEXT,
  daily_digest BOOLEAN DEFAULT FALSE,
  digest_time TEXT DEFAULT '20:00',
  digest_last_sent TEXT,
  has_seen_lang BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_post_time BIGINT DEFAULT 0
);

-- Sources table
CREATE TABLE IF NOT EXISTS sources (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  lang TEXT DEFAULT 'uz',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  referrer_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  referred_id BIGINT UNIQUE REFERENCES users(telegram_id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API Keys table (api_key is unique to prevent duplicates)
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  api_key TEXT UNIQUE NOT NULL,
  api_type TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Processed News (for deduplication)
CREATE TABLE IF NOT EXISTS processed_news (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster dedup lookups
CREATE INDEX IF NOT EXISTS idx_processed_news_user_url ON processed_news(user_id, url);
CREATE INDEX IF NOT EXISTS idx_processed_news_user_title ON processed_news(user_id, title);
CREATE UNIQUE INDEX IF NOT EXISTS uq_processed_news_user_url ON processed_news(user_id, url);

-- Stats table
CREATE TABLE IF NOT EXISTS stats (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT UNIQUE REFERENCES users(telegram_id) ON DELETE CASCADE,
  total_posts INTEGER DEFAULT 0,
  total_duplicates INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- News Embeddings (for semantic search)
CREATE TABLE IF NOT EXISTS news_embeddings (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  embedding VECTOR(768),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Support Tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled Posts
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Monitored Channels (YouTube/Instagram)
CREATE TABLE IF NOT EXISTS monitored_channels (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  name TEXT,
  last_post_id TEXT,
  last_check TIMESTAMPTZ DEFAULT NOW(),
  forward_mode TEXT DEFAULT 'copy',
  use_ai INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1
);

-- Settings/Prices
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Price Tracker table
CREATE TABLE IF NOT EXISTS tracked_prices (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  item_name TEXT NOT NULL,
  last_price BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

DO $$ BEGIN
  ALTER TABLE users ALTER COLUMN target_channel TYPE TEXT USING target_channel::text;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════
-- SQL Functions (RPCs)
-- ═══════════════════════════════════════════════════

-- Increment stat (safe upsert)
CREATE OR REPLACE FUNCTION increment_stat(p_user_id BIGINT, p_field TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO stats (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  
  IF p_field = 'total_posts' THEN
    UPDATE stats SET total_posts = total_posts + 1 WHERE user_id = p_user_id;
  ELSIF p_field = 'total_duplicates' THEN
    UPDATE stats SET total_duplicates = total_duplicates + 1 WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Extend premium
CREATE OR REPLACE FUNCTION extend_premium(p_user_id BIGINT, p_days INTEGER)
RETURNS VOID AS $$
DECLARE
  current_until TIMESTAMPTZ;
BEGIN
  SELECT premium_until INTO current_until FROM users WHERE telegram_id = p_user_id;
  
  IF current_until IS NOT NULL AND current_until > NOW() THEN
    UPDATE users SET is_premium = 1, premium_until = current_until + (p_days || ' days')::INTERVAL WHERE telegram_id = p_user_id;
  ELSE
    UPDATE users SET is_premium = 1, premium_until = NOW() + (p_days || ' days')::INTERVAL WHERE telegram_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Increment referral count
CREATE OR REPLACE FUNCTION increment_referral_count(p_user_id BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1 WHERE telegram_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Match news by vector similarity (requires pgvector extension)
-- Run: CREATE EXTENSION IF NOT EXISTS vector;
CREATE OR REPLACE FUNCTION match_news(
  query_embedding VECTOR(768),
  match_threshold FLOAT,
  p_user_id BIGINT
)
RETURNS TABLE(id BIGINT, similarity FLOAT) AS $$
BEGIN
  RETURN QUERY
    SELECT ne.id, 1 - (ne.embedding <=> query_embedding)::FLOAT AS similarity
    FROM news_embeddings ne
    WHERE ne.user_id = p_user_id
      AND 1 - (ne.embedding <=> query_embedding) > match_threshold
    ORDER BY ne.embedding <=> query_embedding
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;
