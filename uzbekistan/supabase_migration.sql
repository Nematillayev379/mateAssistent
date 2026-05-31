-- =============================================
-- YANGILIKLAR-NEWSROOM: To'liq SQL Migratsiyasi
-- Supabase SQL Editor da bir marta ishga tushiring
-- =============================================

-- 1. users jadvaliga yangi ustunlar
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS keywords TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'uz',
  ADD COLUMN IF NOT EXISTS schedule_times TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS daily_digest BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS digest_time TEXT DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS is_owner INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_approved INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_premium INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_channel TEXT,
  ADD COLUMN IF NOT EXISTS extra_channels TEXT;

-- 2. referrals jadvali
CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL,
  referred_id BIGINT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id);

-- 3. tracked_prices jadvali (narx kuzatish)
CREATE TABLE IF NOT EXISTS tracked_prices (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Mahsulot',
  price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tracked_prices_user ON tracked_prices(user_id);

-- 4. processed_news jadvali (digest uchun)
CREATE TABLE IF NOT EXISTS processed_news (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title TEXT,
  url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, url),
  UNIQUE (user_id, title)
);
CREATE INDEX IF NOT EXISTS idx_processed_news_user ON processed_news(user_id, created_at);

-- 5. RPC: extend_premium (premium muddatini uzaytirish)
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

-- 6. RPC: increment_referral_count
CREATE OR REPLACE FUNCTION increment_referral_count(p_user_id BIGINT)
RETURNS void AS $$
BEGIN
  UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1
  WHERE telegram_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 7. RPC: increment_stat (existing - ensure it works)
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

-- 8. stats jadvali (agar mavjud bo'lmasa)
CREATE TABLE IF NOT EXISTS stats (
  user_id BIGINT PRIMARY KEY,
  total_posts INTEGER DEFAULT 0,
  total_duplicates INTEGER DEFAULT 0
);

-- 9. monitored_channels jadvali (Kanal monitoringi uchun)
CREATE TABLE IF NOT EXISTS monitored_channels (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  channel_username TEXT NOT NULL,
  channel_id TEXT,
  platform TEXT DEFAULT 'youtube',
  last_post_id TEXT,
  keywords TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monitored_channels_user ON monitored_channels(user_id);

-- 10. users jadvali (agar mavjud bo'lmasa)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  is_owner INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_approved INTEGER DEFAULT 0,
  is_premium INTEGER DEFAULT 0,
  premium_until TIMESTAMPTZ,
  target_channel TEXT,
  extra_channels TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  referral_code TEXT UNIQUE,
  referral_count INTEGER DEFAULT 0,
  keywords TEXT DEFAULT '',
  language TEXT DEFAULT 'uz',
  schedule_times TEXT DEFAULT '',
  daily_digest BOOLEAN DEFAULT FALSE,
  digest_time TEXT DEFAULT '20:00'
);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active, is_approved);

DO $$ BEGIN
  ALTER TABLE users ALTER COLUMN target_channel TYPE TEXT USING target_channel::text;
EXCEPTION WHEN others THEN NULL;
END $$;

ALTER TABLE monitored_channels ADD COLUMN IF NOT EXISTS forward_mode TEXT DEFAULT 'copy';
ALTER TABLE monitored_channels ADD COLUMN IF NOT EXISTS use_ai INTEGER DEFAULT 0;
ALTER TABLE monitored_channels ADD COLUMN IF NOT EXISTS last_check TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS telegram_seen_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  source_chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, source_chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS trends_snapshots (
  id BIGSERIAL PRIMARY KEY,
  topics JSONB NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_drafts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  image_url TEXT,
  channels JSONB,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. bot_settings jadvali (konfiguratsiyalar uchun)
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. user_api_keys jadvali (API kalitlari uchun)
CREATE TABLE IF NOT EXISTS user_api_keys (
  id BIGSERIAL PRIMARY KEY,
  api_key TEXT NOT NULL UNIQUE,
  api_type TEXT NOT NULL, -- 'groq', 'cerebras', 'openrouter', 'gemini'
  is_valid INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_type ON user_api_keys(api_type);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_valid ON user_api_keys(is_valid);

-- 13. RPC: get_valid_api_keys (faol API kalitlarini olish)
CREATE OR REPLACE FUNCTION get_valid_api_keys()
RETURNS TABLE(api_key TEXT, api_type TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT uak.api_key, uak.api_type
    FROM user_api_keys uak
    WHERE uak.is_valid = 1;
END;
$$ LANGUAGE plpgsql;

-- 14. RPC: get_setting (sozlamani olish)
CREATE OR REPLACE FUNCTION get_setting(p_key TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT value FROM bot_settings WHERE key = p_key LIMIT 1);
END;
$$ LANGUAGE plpgsql;

-- 15. RPC: set_setting (sozlama qo'yish)
CREATE OR REPLACE FUNCTION set_setting(p_key TEXT, p_value TEXT)
RETURNS void AS $$
BEGIN
  INSERT INTO bot_settings (key, value) VALUES (p_key, p_value)
    ON CONFLICT (key) DO UPDATE SET value = p_value, updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
