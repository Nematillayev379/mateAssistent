"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const logger_1 = require("../utils/logger");
exports.StatsRepository = {
    async increment(userId, field) {
        const { error } = await (0, BaseRepository_1.getSupabase)().rpc('increment_stat', { p_user_id: userId, p_field: field });
        if (error)
            logger_1.logger.error(`incrementStat rpc error: ${error.message}`);
    },
    async get(userId) {
        const { data } = await (0, BaseRepository_1.getSupabase)().from('stats').select('*').eq('user_id', userId).maybeSingle();
        return data || { total_posts: 0, total_duplicates: 0 };
    },
};
