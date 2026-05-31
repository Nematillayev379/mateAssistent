"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReferralRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const logger_1 = require("../utils/logger");
exports.ReferralRepository = {
    async has(referredId) {
        const { data } = await (0, BaseRepository_1.getSupabase)().from('referrals').select('id').eq('referred_id', referredId).maybeSingle();
        return !!data;
    },
    async create(referrerId, referredId) {
        const exists = await this.has(referredId);
        if (exists) {
            logger_1.logger.warn(`createReferral: user ${referredId} already has a referrer`);
            return false;
        }
        const { error } = await (0, BaseRepository_1.getSupabase)().from('referrals').insert({ referrer_id: referrerId, referred_id: referredId });
        if (error) {
            logger_1.logger.error(`createReferral: ${error.message}`);
            return false;
        }
        await this.giveReferredBonus(referredId);
        return true;
    },
    async getStats(userId) {
        const { data: all } = await (0, BaseRepository_1.getSupabase)().from('referrals').select('*').eq('referrer_id', userId);
        const total = all?.length || 0;
        const active = all?.filter(r => r.is_active).length || 0;
        const needed = 10 - (active % 10);
        return { total, active, needed };
    },
    async checkAndMarkActive(userId) {
        const { data: ref } = await (0, BaseRepository_1.getSupabase)().from('referrals').select('*').eq('referred_id', userId).maybeSingle();
        if (ref && ref.is_active === false) {
            await (0, BaseRepository_1.getSupabase)().from('referrals').update({ is_active: true }).eq('referred_id', userId);
            await this.givePremium(ref.referrer_id);
        }
    },
    async givePremium(referrerId) {
        const { count } = await (0, BaseRepository_1.getSupabase)().from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', referrerId).eq('is_active', true);
        const activeCount = count || 0;
        if (activeCount > 0 && activeCount % 10 === 0) {
            const { error } = await (0, BaseRepository_1.getSupabase)().rpc('extend_premium', { p_user_id: referrerId, p_days: 30 });
            if (error)
                logger_1.logger.error(`extend_premium RPC error: ${error.message}`);
        }
        const { error } = await (0, BaseRepository_1.getSupabase)().rpc('increment_referral_count', { p_user_id: referrerId });
        if (error)
            logger_1.logger.error(`increment_referral_count RPC error: ${error.message}`);
    },
    async giveReferredBonus(userId) {
        try {
            const { error } = await (0, BaseRepository_1.getSupabase)().rpc('extend_premium', { p_user_id: userId, p_days: 3 });
            if (error)
                logger_1.logger.error(`giveReferredBonus error: ${error.message}`);
        }
        catch (e) {
            logger_1.logger.warn(`giveReferredBonus failed: ${e.message}`);
        }
    },
};
