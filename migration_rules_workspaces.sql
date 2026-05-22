-- Automation Rules (No-Code IF-THEN)
CREATE TABLE IF NOT EXISTS automation_rules (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('keyword', 'source', 'time', 'category')),
  condition TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('add_price_tracker', 'forward_to_channel', 'add_keyword', 'schedule_post', 'notify')),
  action_value TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_user ON automation_rules(user_id);

-- Workspaces (Multi-Channel Management)
CREATE TABLE IF NOT EXISTS workspaces (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);

CREATE TABLE IF NOT EXISTS workspace_channels (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_wschannels_workspace ON workspace_channels(workspace_id);
