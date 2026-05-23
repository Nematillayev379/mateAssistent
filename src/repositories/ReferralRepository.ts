import { getSupabase } from "./BaseRepository";
import { logger } from "../utils/logger";

export const ReferralRepository = {
  async has(referredId: number): Promise<boolean> {
    const { data } = await getSupabase().from('referrals').select('id').eq('referred_id', referredId).maybeSingle();
    return !!data;
  },

  async create(referrerId: number, referredId: number): Promise<boolean> {
    const exists = await this.has(referredId);
    if (exists) { logger.warn(`createReferral: user ${referredId} already has a referrer`); return false; }
    const { error } = await getSupabase().from('referrals').insert({ referrer_id: referrerId, referred_id: referredId });
    if (error) { logger.error(`createReferral: ${error.message}`); return false; }
    return true;
  },

  async getStats(userId: number) {
    const { data: all } = await getSupabase().from('referrals').select('*').eq('referrer_id', userId);
    const total = all?.length || 0;
    const active = all?.filter(r => r.is_active).length || 0;
    const needed = 10 - (active % 10);
    return { total, active, needed };
  },

  async checkAndMarkActive(userId: number) {
    const { data: ref } = await getSupabase().from('referrals').select('*').eq('referred_id', userId).maybeSingle();
    if (ref && ref.is_active === false) {
      await getSupabase().from('referrals').update({ is_active: true }).eq('referred_id', userId);
      await this.givePremium(ref.referrer_id);
    }
  },

  async givePremium(referrerId: number) {
    const { count } = await getSupabase().from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', referrerId).eq('is_active', true);
    const activeCount = count || 0;
    if (activeCount > 0 && activeCount % 10 === 0) {
      const { error } = await getSupabase().rpc('extend_premium', { p_user_id: referrerId, p_days: 30 });
      if (error) logger.error(`extend_premium RPC error: ${error.message}`);
    }
    const { error } = await getSupabase().rpc('increment_referral_count', { p_user_id: referrerId });
    if (error) logger.error(`increment_referral_count RPC error: ${error.message}`);
  },
};
