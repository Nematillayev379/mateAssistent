"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const logger_1 = require("../utils/logger");
exports.NewsRepository = {
    async isSeen(userId, url, title) {
        if (await this.isSeenByUrl(userId, url))
            return true;
        return this.isSeenByTitle(userId, title);
    },
    async isSeenByUrl(userId, url) {
        const nUrl = (0, BaseRepository_1.normalizeUrl)(url);
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('processed_news').select('id').eq('user_id', userId).eq('url', nUrl).limit(1);
        if (error)
            logger_1.logger.error(`isSeen error: ${error.message}`);
        return !!(data && data.length > 0);
    },
    async isSeenByTitle(userId, title) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)()
            .from('processed_news').select('title').eq('user_id', userId)
            .order('created_at', { ascending: false }).limit(200);
        if (error)
            logger_1.logger.error(`isSeenByTitle error: ${error.message}`);
        if (!data || data.length === 0)
            return false;
        return data.some((row) => (0, BaseRepository_1.isLikelyDuplicate)(row.title, title));
    },
    async markSeen(userId, url, title) {
        const nUrl = (0, BaseRepository_1.normalizeUrl)(url);
        const { error } = await (0, BaseRepository_1.getSupabase)().from('processed_news').upsert({ user_id: userId, url: nUrl, title }, { onConflict: 'user_id,url' });
        if (error) {
            logger_1.logger.error(`markSeen error: ${error.message}`);
            throw error;
        }
    },
    async getLastTitles(userId, limit = 20) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('processed_news').select('title').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
        if (error)
            logger_1.logger.error(`getLastTitles error: ${error.message}`);
        return (data || []).map(r => r.title);
    },
    async getRecentTitles(limit = 80) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('processed_news').select('title').order('created_at', { ascending: false }).limit(limit);
        if (error)
            logger_1.logger.error(`getRecentNewsTitles error: ${error.message}`);
        return (data || []).map((r) => r?.title).filter(Boolean);
    },
};
