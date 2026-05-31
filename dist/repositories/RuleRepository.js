"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DraftRepository = exports.TicketRepository = exports.RuleRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const logger_1 = require("../utils/logger");
exports.RuleRepository = {
    async getByUser(userId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('automation_rules').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error) {
            logger_1.logger.error(`getUserRules error: ${error.message}`);
            return [];
        }
        return data || [];
    },
    async add(userId, trigger, condition, action, actionValue) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('automation_rules').insert({ user_id: userId, trigger, condition, action, action_value: actionValue });
        if (error) {
            logger_1.logger.error(`addRule error: ${error.message}`);
            return false;
        }
        return true;
    },
    async toggle(ruleId, isActive) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('automation_rules').update({ is_active: isActive }).eq('id', ruleId);
        if (error) {
            logger_1.logger.error(`toggleRule error: ${error.message}`);
            return false;
        }
        return true;
    },
    async delete(ruleId) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('automation_rules').delete().eq('id', ruleId);
        if (error) {
            logger_1.logger.error(`deleteRule error: ${error.message}`);
            return false;
        }
        return true;
    },
};
exports.TicketRepository = {
    async create(userId, subject, message) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('support_tickets').insert({ user_id: userId, subject, message }).select().single();
        if (error)
            logger_1.logger.error(`createTicket error: ${error.message}`);
        return data;
    },
    async getByUser(userId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('support_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error)
            logger_1.logger.error(`getUserTickets error: ${error.message}`);
        return data || [];
    },
    async getAll() {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('support_tickets').select('*, users(username, first_name)').order('created_at', { ascending: false });
        if (error)
            logger_1.logger.error(`getTickets error: ${error.message}`);
        return data || [];
    },
    async updateStatus(ticketId, status) {
        if (!['open', 'closed', 'resolved'].includes(status))
            return;
        await (0, BaseRepository_1.getSupabase)().from('support_tickets').update({ status }).eq('id', ticketId);
    },
};
exports.DraftRepository = {
    async save(userId, draft) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('post_drafts').insert({
            user_id: userId, title: draft.title || null, body: draft.body,
            image_url: draft.image_url || null, channels: draft.channels || null, status: 'draft',
        }).select().single();
        if (error)
            logger_1.logger.error(`savePostDraft error: ${error.message}`);
        return data;
    },
    async getByUser(userId) {
        const { data } = await (0, BaseRepository_1.getSupabase)().from('post_drafts').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20);
        return data || [];
    },
};
