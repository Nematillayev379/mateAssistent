"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebUserRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const logger_1 = require("../utils/logger");
exports.WebUserRepository = {
    async getByEmail(email) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('web_users').select('*').eq('email', email).maybeSingle();
        if (error) {
            logger_1.logger.error(`getWebUserByEmail error: ${error.message}`);
            return null;
        }
        return data;
    },
    async list() {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('web_users').select('email, telegram_id, approved, created_at').order('created_at', { ascending: false });
        if (error) {
            logger_1.logger.error(`listWebUsers error: ${error.message}`);
            return [];
        }
        return data || [];
    },
    async create(record) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('web_users').insert(record).select('*').single();
        if (error) {
            logger_1.logger.error(`createWebUser error: ${error.message}`);
            return null;
        }
        return data;
    },
};
