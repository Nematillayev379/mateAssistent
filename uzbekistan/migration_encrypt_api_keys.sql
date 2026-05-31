-- Add api_key_hash column for encrypted key lookups
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(api_key_hash);

-- Encrypt existing plaintext keys (run once)
-- After deploy, existing keys will be re-encrypted on next addApiKey call.
-- For existing plaintext keys that need immediate encryption,
-- run: UPDATE api_keys SET api_key_hash = encode(sha256(api_key::bytea), 'hex');
-- This is a placeholder; the app handles both encrypted and plaintext keys.
