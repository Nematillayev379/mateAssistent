"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeyRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const crypto_1 = require("../utils/crypto");
const logger_1 = require("../utils/logger");
exports.ApiKeyRepository = {
    async add(userId, key, type) {
        const hashed = (0, crypto_1.hashKey)(key);
        const { data: existing } = await (0, BaseRepository_1.getSupabase)().from('api_keys').select('user_id').eq('api_key_hash', hashed).maybeSingle();
        if (existing && existing.user_id !== userId) {
            logger_1.logger.warn(`addApiKey: key already owned by another user`);
            return;
        }
        const encrypted = (0, crypto_1.encrypt)(key);
        const { error } = await (0, BaseRepository_1.getSupabase)().from('api_keys').upsert({
            user_id: userId, api_key: encrypted, api_key_hash: hashed, api_type: type, is_active: true
        }, { onConflict: 'api_key_hash' });
        if (error)
            logger_1.logger.error(`addApiKey error: ${error.message}`);
    },
    async remove(userId, key) {
        const hashed = (0, crypto_1.hashKey)(key);
        const { error } = await (0, BaseRepository_1.getSupabase)().from('api_keys').delete().eq('user_id', userId).eq('api_key_hash', hashed);
        if (error)
            logger_1.logger.error(`removeApiKey error: ${error.message}`);
    },
    async removeById(id) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('api_keys').delete().eq('id', id);
        if (error)
            logger_1.logger.error(`removeApiKeyById error: ${error.message}`);
    },
    async count(userId) {
        const { count, error } = await (0, BaseRepository_1.getSupabase)().from('api_keys').select('*', { count: 'exact', head: true }).eq('user_id', userId);
        return count || 0;
    },
    async exists(key) {
        const hashed = (0, crypto_1.hashKey)(key);
        const { data } = await (0, BaseRepository_1.getSupabase)().from('api_keys').select('id').eq('api_key_hash', hashed).maybeSingle();
        return !!data;
    },
    async getValid() {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('api_keys').select('api_key, api_type, user_id').eq('is_active', true);
        if (error) {
            logger_1.logger.error(`getValidApiKeys error: ${error.message}`);
            return [];
        }
        return (data || []).map(k => {
            try {
                return { key: (0, crypto_1.decrypt)(k.api_key), type: k.api_type, user_id: k.user_id };
            }
            catch {
                return { key: k.api_key, type: k.api_type, user_id: k.user_id };
            }
        });
    },
    async getByUser(userId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('api_keys').select('*').eq('user_id', userId).eq('is_active', true);
        if (error) {
            logger_1.logger.error(`getUserApiKeys error: ${error.message}`);
            return [];
        }
        return (data || []).map(k => {
            try {
                return { ...k, api_key: (0, crypto_1.decrypt)(k.api_key) };
            }
            catch {
                return k;
            }
        });
    },
};
