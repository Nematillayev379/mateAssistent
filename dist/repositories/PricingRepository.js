"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleRepository = exports.SettingsRepository = exports.PriceRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const logger_1 = require("../utils/logger");
exports.PriceRepository = {
    async add(userId, url, name, price) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('tracked_prices').insert({ user_id: userId, url, item_name: name, last_price: price });
        if (error) {
            logger_1.logger.error(`addTrackedPrice error: ${error.message}`);
            throw new Error('Narxni kuzatuvga olishda xatolik.');
        }
    },
    async getByUser(userId) {
        const { data } = await (0, BaseRepository_1.getSupabase)().from('tracked_prices').select('*').eq('user_id', userId);
        return data || [];
    },
    async getAll() {
        const { data } = await (0, BaseRepository_1.getSupabase)().from('tracked_prices').select('*');
        return data || [];
    },
    async updatePrice(id, newPrice) {
        await (0, BaseRepository_1.getSupabase)().from('tracked_prices').update({ last_price: newPrice }).eq('id', id);
    },
    async remove(userId, id) {
        await (0, BaseRepository_1.getSupabase)().from('tracked_prices').delete().eq('id', id).eq('user_id', userId);
    },
};
exports.SettingsRepository = {
    async get(key) {
        const { data } = await (0, BaseRepository_1.getSupabase)().from('settings').select('value').eq('key', key).maybeSingle();
        return data?.value ?? null;
    },
    async set(key, value) {
        await (0, BaseRepository_1.getSupabase)().from('settings').upsert({ key, value }, { onConflict: 'key' });
    },
};
exports.ScheduleRepository = {
    async add(userId, type, content, scheduledAt) {
        const validTypes = ['video', 'audio', 'text'];
        if (!validTypes.includes(type))
            throw new Error(`Invalid scheduled post type: ${type}`);
        if (!scheduledAt || isNaN(Date.parse(scheduledAt)))
            throw new Error(`Invalid scheduledAt: ${scheduledAt}`);
        const { error } = await (0, BaseRepository_1.getSupabase)().from('scheduled_posts').insert({ user_id: userId, type, content, scheduled_at: scheduledAt, status: 'pending' });
        if (error)
            logger_1.logger.error(`addScheduledPost error: ${error.message}`);
    },
    async cancel(userId, id) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('scheduled_posts').update({ status: 'cancelled' }).eq('id', id).eq('user_id', userId);
        if (error)
            logger_1.logger.error(`cancelScheduledPost error: ${error.message}`);
    },
    async getPending() {
        const now = new Date().toISOString();
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('scheduled_posts').select('*').eq('status', 'pending').lte('scheduled_at', now);
        if (error)
            logger_1.logger.error(`getPendingScheduledPosts error: ${error.message}`);
        return data || [];
    },
    async getByUser(userId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('scheduled_posts').select('*').eq('user_id', userId).in('status', ['pending', 'sent']).order('scheduled_at', { ascending: false });
        if (error)
            logger_1.logger.error(`getUserScheduledPosts error: ${error.message}`);
        return data || [];
    },
    async markSent(id) {
        await (0, BaseRepository_1.getSupabase)().from('scheduled_posts').update({ status: 'sent' }).eq('id', id);
    },
    async updateStatus(id, status) {
        await (0, BaseRepository_1.getSupabase)().from('scheduled_posts').update({ status }).eq('id', id);
    },
};
