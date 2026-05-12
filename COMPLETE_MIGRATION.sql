-- =============================================
-- YANGILIKLAR-NEWSROOM: To'liq SQL Migratsiyasi
-- Supabase SQL Editor da bir marta ishga tushiring
-- =============================================

-- Enable pgvector extension (required for news_embeddings)
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. USERS jadvalini to'liq yaratish
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  is_owner INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_approved INTEGER DEFAULT 0,
  is_premium INTEGER DEFAULT 0,
  premium_until TIMESTAMPTZ,
  target_channel TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_post_time BIGINT DEFAULT 0,
  interval_minutes INTEGER DEFAULT 15,
  referral_code TEXT UNIQUE,
  referral_count INTEGER DEFAULT 0,
  keywords TEXT DEFAULT '',
  language TEXT DEFAULT 'uz',
  schedule_times TEXT DEFAULT '',
  daily_digest BOOLEAN DEFAULT FALSE,
  digest_time TEXT DEFAULT '20:00',
  custom_signature TEXT DEFAULT '',
  username TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  extra_sources INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active, is_approved);

-- 2. STATS jadvali
CREATE TABLE IF NOT EXISTS stats (
  user_id BIGINT PRIMARY KEY,
  total_posts INTEGER DEFAULT 0,
  total_duplicates INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);

-- 3. SEEN jadvali (dublikatlar uchun)
CREATE TABLE IF NOT EXISTS seen (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_seen_user ON seen(user_id, created_at);

-- 4. SOURCES jadvali (RSS manbalari)
CREATE TABLE IF NOT EXISTS user_sources (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  lang TEXT DEFAULT 'uz',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_sources_user ON user_sources(user_id);

-- 5. referrals jadvali
CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL,
  referred_id BIGINT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (referrer_id) REFERENCES users(telegram_id) ON DELETE CASCADE,
  FOREIGN KEY (referred_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id);

-- 6. tracked_prices jadvali (narx kuzatish)
CREATE TABLE IF NOT EXISTS tracked_prices (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  url TEXT NOT NULL,
  item_name TEXT NOT NULL DEFAULT 'Mahsulot',
  last_price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tracked_prices_user ON tracked_prices(user_id);

-- 7. processed_news jadvali (digest uchun)
CREATE TABLE IF NOT EXISTS processed_news (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title TEXT,
  url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_processed_news_user ON processed_news(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_processed_news_title ON processed_news(title);
CREATE INDEX IF NOT EXISTS idx_processed_news_created_at ON processed_news(created_at);

-- 8. bot_settings jadvali
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. user_api_keys jadvali
CREATE TABLE IF NOT EXISTS user_api_keys (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  api_key TEXT NOT NULL UNIQUE,
  api_type TEXT NOT NULL, -- 'groq', 'cerebras', 'openrouter', 'gemini'
  is_valid INTEGER DEFAULT 1,
  key_limit INTEGER DEFAULT 5,
  extra_sources INTEGER DEFAULT 0, -- Additional sources beyond the default limit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_type ON user_api_keys(api_type);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_valid ON user_api_keys(is_valid);

-- 10. monitored_channels jadvali
CREATE TABLE IF NOT EXISTS monitored_channels (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  platform TEXT DEFAULT 'youtube',
  last_post_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monitored_channels_user ON monitored_channels(user_id);

-- 11. news_embeddings jadvali (semantik dublikat tekshirish uchun)
CREATE TABLE IF NOT EXISTS news_embeddings (
    id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    embedding VECTOR(768), -- Gemini embeddings size
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_news_embeddings_user ON news_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_news_embeddings_hash ON news_embeddings(content_hash);

-- =============================================
-- RPC FUNCTIONS
-- =============================================

-- 1. RPC: extend_premium
CREATE OR REPLACE FUNCTION extend_premium(p_user_id BIGINT, p_days INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE users SET
    is_premium = 1,
    premium_until = CASE
      WHEN premium_until IS NULL OR premium_until < NOW()
        THEN NOW() + (p_days || ' days')::INTERVAL
      ELSE premium_until + (p_days || ' days')::INTERVAL
    END
  WHERE telegram_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 2. RPC: increment_referral_count
CREATE OR REPLACE FUNCTION increment_referral_count(p_user_id BIGINT)
RETURNS void AS $$
BEGIN
  UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1
  WHERE telegram_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 3. RPC: increment_stat
CREATE OR REPLACE FUNCTION increment_stat(p_user_id BIGINT, p_field TEXT)
RETURNS void AS $$
BEGIN
  IF p_field = 'total_posts' THEN
    INSERT INTO stats (user_id, total_posts, total_duplicates)
      VALUES (p_user_id, 1, 0)
      ON CONFLICT (user_id) DO UPDATE SET total_posts = stats.total_posts + 1;
  ELSIF p_field = 'total_duplicates' THEN
    INSERT INTO stats (user_id, total_posts, total_duplicates)
      VALUES (p_user_id, 0, 1)
      ON CONFLICT (user_id) DO UPDATE SET total_duplicates = stats.total_duplicates + 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 4. RPC: get_valid_api_keys
CREATE OR REPLACE FUNCTION get_valid_api_keys()
RETURNS TABLE(api_key TEXT, api_type TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT uak.api_key, uak.api_type
    FROM user_api_keys uak
    WHERE uak.is_valid = 1;
END;
$$ LANGUAGE plpgsql;

-- 5. RPC: get_setting
CREATE OR REPLACE FUNCTION get_setting(p_key TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT value FROM bot_settings WHERE key = p_key LIMIT 1);
END;
$$ LANGUAGE plpgsql;

-- 6. RPC: set_setting
CREATE OR REPLACE FUNCTION set_setting(p_key TEXT, p_value TEXT)
RETURNS void AS $$
BEGIN
  INSERT INTO bot_settings (key, value) VALUES (p_key, p_value)
    ON CONFLICT (key) DO UPDATE SET value = p_value, updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 7. RPC: match_news
CREATE OR REPLACE FUNCTION match_news(p_user_id BIGINT, query_embedding VECTOR(768), match_threshold FLOAT DEFAULT 0.8)
RETURNS TABLE(content_hash TEXT, similarity FLOAT) AS $$
BEGIN
  RETURN QUERY
    SELECT 
      ne.content_hash,
      1 - (ne.embedding <=> query_embedding) as similarity
    FROM news_embeddings ne
    WHERE ne.user_id = p_user_id
      AND (1 - (ne.embedding <=> query_embedding)) >= match_threshold
    ORDER BY similarity DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- INITIAL DATA
-- =============================================

-- Clear worker lock
INSERT INTO bot_settings (key, value) VALUES ('worker_lock_time', '0')
  ON CONFLICT (key) DO UPDATE SET value = '0';

-- Set default settings
INSERT INTO bot_settings (key, value) VALUES 
  ('price_premium_month', '50000'),
  ('price_premium_year', '500000')
  ON CONFLICT (key) DO NOTHING;
