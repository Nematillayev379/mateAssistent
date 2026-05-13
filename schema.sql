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
  target_channel TEXT,
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

-- Sources table (Bug #45 Fix: Unified name)
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
  referred_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
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

-- Stats table
CREATE TABLE IF NOT EXISTS stats (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  total_posts INTEGER DEFAULT 0,
  total_duplicates INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- News Embeddings (for semantic search)
CREATE TABLE IF NOT EXISTS news_embeddings (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
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

-- Monitored Channels
CREATE TABLE IF NOT EXISTS monitored_channels (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  name TEXT,
  last_post_id TEXT,
  last_check TIMESTAMPTZ DEFAULT NOW()
);

-- Settings/Prices
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
