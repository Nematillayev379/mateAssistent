-- Users table
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  language TEXT DEFAULT 'uz',
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
  referred_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracked Prices table
CREATE TABLE IF NOT EXISTS tracked_prices (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  price BIGINT NOT NULL,
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
