-- =============================================
-- NEWSROOM ELITE: To'liq SQL Migratsiyasi v3
-- Supabase SQL Editor da bir marta ishga tushiring
-- =============================================

-- MUHIM: Avval Supabase Dashboard > Database > Extensions da
-- "vector" (pgvector) extensionni yoqing, keyin bu skriptni ishga tushiring.

-- Enable pgvector extension (Supabase da oldindan yoqilgan bo'lishi kerak)
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================
-- 1. USERS jadvali
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  is_owner INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_approved INTEGER DEFAULT 1,
  is_premium INTEGER DEFAULT 0,
  premium_until TIMESTAMPTZ,
  target_channel TEXT,
  role TEXT DEFAULT 'user',
  has_seen_lang BOOLEAN DEFAULT FALSE,
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
  digest_last_sent TEXT DEFAULT NULL,
  custom_signature TEXT DEFAULT '',
  username TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  extra_sources INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active, is_approved);

-- Mavjud jadvalga ustunlar qo'shish (xatoliksiz)
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_lang BOOLEAN DEFAULT FALSE;
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved INTEGER DEFAULT 1;
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_sources INTEGER DEFAULT 0;
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_signature TEXT DEFAULT '';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_last_sent TEXT DEFAULT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT DEFAULT '';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT DEFAULT '';
EXCEPTION WHEN others THEN NULL;
END $$;

-- =============================================
-- 2. STATS jadvali
-- =============================================
CREATE TABLE IF NOT EXISTS stats (
  user_id BIGINT PRIMARY KEY,
  total_posts INTEGER DEFAULT 0,
  total_duplicates INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);

-- =============================================
-- 3. SOURCES jadvali
-- =============================================
CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  lang TEXT DEFAULT 'uz',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sources_user ON sources(user_id);

-- =============================================
-- 4. PROCESSED_NEWS jadvali
-- =============================================
CREATE TABLE IF NOT EXISTS processed_news (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title TEXT,
  url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE,
  UNIQUE (user_id, url),
  UNIQUE (user_id, title)
);
CREATE INDEX IF NOT EXISTS idx_processed_news_user ON processed_news(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_processed_news_title ON processed_news(title);
CREATE INDEX IF NOT EXISTS idx_processed_news_created_at ON processed_news(created_at);

-- =============================================
-- 5. REFERRALS jadvali
-- =============================================
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

-- =============================================
-- 6. TRACKED_PRICES jadvali
-- =============================================
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

-- =============================================
-- 7. SETTINGS jadvali
-- =============================================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 8. API_KEYS jadvali
-- =============================================
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  api_key TEXT NOT NULL UNIQUE,
  api_type TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_type ON api_keys(api_type);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- =============================================
-- 9. MONITORED_CHANNELS jadvali
-- =============================================
CREATE TABLE IF NOT EXISTS monitored_channels (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  platform TEXT DEFAULT 'youtube',
  last_post_id TEXT,
  last_check TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monitored_channels_user ON monitored_channels(user_id);
DO $$ BEGIN
  ALTER TABLE monitored_channels ADD COLUMN IF NOT EXISTS last_check TIMESTAMPTZ;
EXCEPTION WHEN others THEN NULL;
END $$;

-- =============================================
-- 10. NEWS_EMBEDDINGS jadvali (pgvector kerak)
-- =============================================
CREATE TABLE IF NOT EXISTS news_embeddings (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  embedding vector(768),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_news_embeddings_user ON news_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_news_embeddings_hash ON news_embeddings(content_hash);

-- =============================================
-- 11. SUPPORT_TICKETS jadvali
-- =============================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

-- =============================================
-- 12. SCHEDULED_POSTS jadvali
-- =============================================
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user ON scheduled_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status, scheduled_at);

-- =============================================
-- RPC FUNKSIYALAR
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

CREATE OR REPLACE FUNCTION get_setting(p_key TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT value FROM settings WHERE key = p_key LIMIT 1);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_setting(p_key TEXT, p_value TEXT)
RETURNS void AS $$
BEGIN
  INSERT INTO settings (key, value) VALUES (p_key, p_value)
    ON CONFLICT (key) DO UPDATE SET value = p_value, updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- match_news funksiyasini barcha versiyalarini o'chirish
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'match_news'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION match_news(
  p_user_id BIGINT,
  query_embedding vector(768),
  match_threshold FLOAT DEFAULT 0.8
)
RETURNS TABLE(content_hash TEXT, similarity FLOAT) AS $$
BEGIN
  RETURN QUERY
    SELECT
      ne.content_hash,
      (1 - (ne.embedding <=> query_embedding))::FLOAT AS similarity
    FROM news_embeddings ne
    WHERE ne.user_id = p_user_id
      AND (1 - (ne.embedding <=> query_embedding)) >= match_threshold
    ORDER BY similarity DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- MA'LUMOTLARNI KO'CHIRISH (ESKI JADVALLARDAN)
-- =============================================

DO $$
BEGIN

  -- 1. user_api_keys -> api_keys
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_api_keys') THEN
    INSERT INTO api_keys (user_id, api_key, api_type, is_active, created_at)
    SELECT
      user_id,
      api_key,
      COALESCE(api_type, 'groq'),
      CASE WHEN COALESCE(is_valid, 1) = 1 THEN TRUE ELSE FALSE END,
      NOW()
    FROM user_api_keys
    ON CONFLICT (api_key) DO NOTHING;
    RAISE NOTICE 'user_api_keys -> api_keys kochirildi';
  END IF;

  -- 2. user_sources -> sources
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_sources') THEN
    INSERT INTO sources (user_id, name, url, lang, is_active, created_at)
    SELECT
      user_id,
      COALESCE(name, url),
      url,
      COALESCE(lang, 'uz'),
      TRUE,
      NOW()
    FROM user_sources
    ON CONFLICT DO NOTHING;
    RAISE NOTICE 'user_sources -> sources kochirildi';
  END IF;

  -- 3. bot_settings -> settings
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bot_settings') THEN
    INSERT INTO settings (key, value, created_at, updated_at)
    SELECT key, value, NOW(), NOW()
    FROM bot_settings
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    RAISE NOTICE 'bot_settings -> settings kochirildi';
  END IF;

  -- 4. seen -> processed_news
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'seen') THEN
    INSERT INTO processed_news (user_id, url, title, created_at)
    SELECT
      user_id,
      COALESCE(url, ''),
      COALESCE(title, ''),
      COALESCE(created_at, NOW())
    FROM seen
    ON CONFLICT DO NOTHING;
    RAISE NOTICE 'seen -> processed_news kochirildi';
  END IF;

END $$;

-- =============================================
-- BOSHLANG'ICH MA'LUMOTLAR
-- =============================================

INSERT INTO settings (key, value) VALUES ('worker_lock_time', '0') ON CONFLICT (key) DO UPDATE SET value = '0';
INSERT INTO settings (key, value) VALUES ('price_monthly', '25000') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('price_yearly', '250000') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('premium_stars_price', '500') ON CONFLICT (key) DO NOTHING;

-- =============================================
-- MUVAFFAQIYATLI YAKUNLANDI!
-- Endi botni ishga tushirishingiz mumkin.
-- =============================================
