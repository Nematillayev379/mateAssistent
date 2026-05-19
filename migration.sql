-- 1. Scheduled Posts (Content Calendar)
CREATE TABLE IF NOT EXISTS public.scheduled_posts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES public.users(telegram_id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'video', 'audio', 'text'
    content JSONB NOT NULL, -- {url, caption, text}
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Referrals System
CREATE TABLE IF NOT EXISTS public.referrals (
    id BIGSERIAL PRIMARY KEY,
    referrer_id BIGINT REFERENCES public.users(telegram_id),
    referred_id BIGINT REFERENCES public.users(telegram_id),
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(referred_id)
);

-- 3. Extend Users Table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'; -- 'user', 'premium', 'admin', 'owner'
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS daily_digest BOOLEAN DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS digest_time TEXT DEFAULT '08:00';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS schedule_times TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS premium_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS extra_channels TEXT;

CREATE TABLE IF NOT EXISTS public.monitored_channels (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES public.users(telegram_id) ON DELETE CASCADE,
    platform TEXT DEFAULT 'youtube',
    channel_id TEXT NOT NULL,
    name TEXT DEFAULT '',
    last_post_id TEXT,
    last_check TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.monitored_channels ADD COLUMN IF NOT EXISTS forward_mode TEXT DEFAULT 'copy';
ALTER TABLE public.monitored_channels ADD COLUMN IF NOT EXISTS use_ai INTEGER DEFAULT 0;
ALTER TABLE public.monitored_channels ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.telegram_seen_messages (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    source_chat_id TEXT NOT NULL,
    message_id BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, source_chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS public.trends_snapshots (
    id BIGSERIAL PRIMARY KEY,
    topics JSONB NOT NULL,
    summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.post_drafts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES public.users(telegram_id) ON DELETE CASCADE,
    title TEXT,
    body TEXT NOT NULL,
    image_url TEXT,
    channels JSONB,
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Support Tickets (For Elite Support Panel)
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES public.users(telegram_id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open', -- 'open', 'resolved', 'closed'
    assigned_to BIGINT REFERENCES public.users(telegram_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION increment_stat(p_user_id BIGINT, p_field TEXT)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.stats (user_id, total_posts, total_duplicates)
    VALUES (p_user_id, 
            CASE WHEN p_field = 'total_posts' THEN 1 ELSE 0 END,
            CASE WHEN p_field = 'total_duplicates' THEN 1 ELSE 0 END)
    ON CONFLICT (user_id) DO UPDATE SET
        total_posts = stats.total_posts + (CASE WHEN p_field = 'total_posts' THEN 1 ELSE 0 END),
        total_duplicates = stats.total_duplicates + (CASE WHEN p_field = 'total_duplicates' THEN 1 ELSE 0 END);
END;
$$ LANGUAGE plpgsql;

-- 5. RPC Function for Premium
CREATE OR REPLACE FUNCTION extend_premium(p_user_id BIGINT, p_days INTEGER)
RETURNS VOID AS $$
BEGIN
    UPDATE public.users 
    SET is_premium = TRUE,
        premium_until = COALESCE(premium_until, NOW()) + (p_days || ' days')::INTERVAL
    WHERE telegram_id = p_user_id;
END;
$$ LANGUAGE plpgsql;
