"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const logger_1 = require("../utils/logger");
exports.SourceRepository = {
    async getByUser(userId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('sources').select('*').eq('user_id', userId);
        if (error)
            logger_1.logger.error(`getUserSources error: ${error.message}`);
        return data || [];
    },
    async getAll() {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('sources').select('*');
        if (error)
            logger_1.logger.error(`getAllSources error: ${error.message}`);
        return data || [];
    },
    async add(userId, name, url, lang) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('sources').insert({ user_id: userId, name, url, lang });
        if (error) {
            logger_1.logger.error(`addSource error: ${error.message}`);
            return false;
        }
        return true;
    },
    async remove(userId, sourceId) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('sources').delete().eq('id', sourceId).eq('user_id', userId);
        if (error)
            logger_1.logger.error(`removeSource error: ${error.message}`);
    },
};
