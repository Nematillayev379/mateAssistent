-- Ensure scheduled_posts table exists with all needed columns
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('video', 'audio', 'text')),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_status
  ON scheduled_posts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_pending
  ON scheduled_posts(scheduled_at) WHERE status = 'pending';
