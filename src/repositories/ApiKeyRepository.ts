import { getSupabase } from "./BaseRepository";
import { hashKey, encrypt, decrypt } from "../utils/crypto";
import { logger } from "../utils/logger";

export const ApiKeyRepository = {
  async add(userId: number, key: string, type: string) {
    const hashed = hashKey(key);
    const { data: existing } = await getSupabase().from('api_keys').select('user_id').eq('api_key_hash', hashed).maybeSingle();
    if (existing && existing.user_id !== userId) { logger.warn(`addApiKey: key already owned by another user`); return; }
    const encrypted = encrypt(key);
    const { error } = await getSupabase().from('api_keys').upsert({
      user_id: userId, api_key: encrypted, api_key_hash: hashed, api_type: type, is_active: true
    }, { onConflict: 'api_key_hash' });
    if (error) logger.error(`addApiKey error: ${error.message}`);
  },

  async remove(userId: number, key: string) {
    const hashed = hashKey(key);
    const { error } = await getSupabase().from('api_keys').delete().eq('user_id', userId).eq('api_key_hash', hashed);
    if (error) logger.error(`removeApiKey error: ${error.message}`);
  },

  async removeById(id: number) {
    const { error } = await getSupabase().from('api_keys').delete().eq('id', id);
    if (error) logger.error(`removeApiKeyById error: ${error.message}`);
  },

  async count(userId: number): Promise<number> {
    const { count, error } = await getSupabase().from('api_keys').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    return count || 0;
  },

  async exists(key: string): Promise<boolean> {
    const hashed = hashKey(key);
    const { data } = await getSupabase().from('api_keys').select('id').eq('api_key_hash', hashed).maybeSingle();
    return !!data;
  },

  async getValid() {
    const { data, error } = await getSupabase().from('api_keys').select('api_key, api_type').eq('is_active', true);
    if (error) { logger.error(`getValidApiKeys error: ${error.message}`); return []; }
    return (data || []).map(k => {
      try { return { key: decrypt(k.api_key), type: k.api_type }; }
      catch { return { key: k.api_key, type: k.api_type }; }
    });
  },

  async getByUser(userId: number) {
    const { data, error } = await getSupabase().from('api_keys').select('*').eq('user_id', userId).eq('is_active', true);
    if (error) { logger.error(`getUserApiKeys error: ${error.message}`); return []; }
    return (data || []).map(k => {
      try { return { ...k, api_key: decrypt(k.api_key) }; }
      catch { return k; }
    });
  },
};
