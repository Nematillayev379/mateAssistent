import { createClient } from '@supabase/supabase-js';
import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import crypto from 'crypto';

const supabaseUrl = CONFIG.SUPABASE_URL;
const supabaseKey = CONFIG.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);


export const DBService = {
  // --- USERS ---
  async getUser(telegramId: number) {
    const { data, error } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
    if (error && error.code !== 'PGRST116') logger.error(`getUser error: ${error.message}`);
    return data;
  },
  
  async getAllUsers() {
    const { data, error } = await supabase.from('users').select('*');
    if (error) logger.error(`getAllUsers error: ${error.message}`);
    return data || [];
  },

  async getActiveUsers() {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // Users who are (Approved OR Registered in last 24h) AND have target_channel AND are active
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('is_active', 1)
      .not('target_channel', 'is', null)
      .or(`is_approved.eq.1,created_at.gte.${yesterday}`);

    if (error) logger.error(`getActiveUsers error: ${error.message}`);
    return data || [];
  },

  async upsertUser(telegramId: number, isOwner = 0, username?: string, firstName?: string) {
    const existing = await this.getUser(telegramId);
    if (!existing) {
      const insertData: Record<string, any> = { telegram_id: telegramId, is_owner: isOwner, is_approved: 1 };
      if (username) insertData.username = username;
      if (firstName) insertData.first_name = firstName;
      const { data, error } = await supabase.from('users').insert(insertData).select().single();
      if (error) logger.error(`upsertUser insert error: ${error.message}`);
      return data;
    } else {
      // Always keep username/first_name up to date
      const updates: Record<string, any> = {};
      if (username && username !== existing.username) updates.username = username;
      if (firstName && firstName !== existing.first_name) updates.first_name = firstName;
      if (isOwner === 1 && existing.is_owner === 0) { updates.is_owner = 1; updates.is_approved = 1; }
      if (Object.keys(updates).length > 0) {
        const { data, error } = await supabase.from('users').update(updates).eq('telegram_id', telegramId).select().single();
        if (error) logger.error(`upsertUser update error: ${error.message}`);
        return data || existing;
      }
    }
    return existing;
  },

  async updateUser(telegramId: number, updates: Record<string, any>) {
    const { error } = await supabase.from('users').update(updates).eq('telegram_id', telegramId);
    if (error) logger.error(`updateUser error: ${error.message}`);
  },

  // --- SOURCES ---
  async getUserSources(userId: number) {
    const { data, error } = await supabase.from('user_sources').select('*').eq('user_id', userId);
    if (error) logger.error(`getUserSources error: ${error.message}`);
    return data || [];
  },

  async addSource(userId: number, name: string, url: string, lang: string) {
    const { error } = await supabase.from('user_sources').insert({ user_id: userId, name, url, lang });
    if (error) logger.error(`addSource error: ${error.message}`);
  },

  async removeSource(userId: number, sourceId: number) {
    const { error } = await supabase.from('user_sources').delete().eq('id', sourceId).eq('user_id', userId);
    if (error) logger.error(`removeSource error: ${error.message}`);
  },

  // --- NEWS DEDUPLICATION ---
  async isSeen(userId: number, url: string): Promise<boolean> {
    const { data, error } = await supabase.from('processed_news').select('id').eq('user_id', userId).eq('url', url).limit(1);
    if (error) logger.error(`isSeen error: ${error.message}`);
    return !!(data && data.length > 0);
  },

  async isSeenByTitle(userId: number, title: string): Promise<boolean> {
    const { data, error } = await supabase.from('processed_news').select('id').eq('user_id', userId).eq('title', title).limit(1);
    if (error) logger.error(`isSeenByTitle error: ${error.message}`);
    return !!(data && data.length > 0);
  },

  async markSeen(userId: number, url: string, title: string) {
    const { error } = await supabase.from('processed_news').insert({ user_id: userId, url, title });
    if (error) logger.error(`markSeen error: ${error.message}`);
  },

  async getLastTitles(userId: number, limit: number = 20): Promise<string[]> {
    const { data, error } = await supabase.from('processed_news').select('title').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (error) logger.error(`getLastTitles error: ${error.message}`);
    return (data || []).map(r => r.title);
  },

  // --- API KEYS ---
  async addApiKey(userId: number, key: string, type: string) {
    const { error } = await supabase.from('user_api_keys').upsert({ user_id: userId, api_key: key, api_type: type, is_valid: 1 }, { onConflict: 'api_key' });
    if (error) logger.error(`addApiKey error: ${error.message}`);
  },

  async getUserApiKeyCount(userId: number): Promise<number> {
    const { count, error } = await supabase.from('user_api_keys').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (error) logger.error(`getUserApiKeyCount error: ${error.message}`);
    return count || 0;
  },

  async isKeyExists(key: string): Promise<boolean> {
    const { data, error } = await supabase.from('user_api_keys').select('id').eq('api_key', key).maybeSingle();
    return !!data;
  },

  async getValidApiKeys() {
    const { data, error } = await supabase.from('user_api_keys').select('api_key, api_type').eq('is_valid', 1);
    if (error) logger.error(`getValidApiKeys error: ${error.message}`);
    return (data || []).map(k => ({ key: k.api_key, type: k.api_type }));
  },

  async getUserApiKeys(userId: number) {
    const { data, error } = await supabase.from('user_api_keys').select('*').eq('user_id', userId).eq('is_valid', 1);
    if (error) logger.error(`getUserApiKeys error: ${error.message}`);
    return data || [];
  },

  // removeApiKey function removed - API keys are no longer deletable

  // --- STATS ---

  async incrementStat(userId: number, field: 'total_posts' | 'total_duplicates') {
    const { error } = await supabase.rpc('increment_stat', { p_user_id: userId, p_field: field });
    if (error) logger.error(`incrementStat rpc error: ${error.message}`);
  },

  async getStats(userId: number) {
    const { data } = await supabase.from('stats').select('*').eq('user_id', userId).maybeSingle();
    return data || { total_posts: 0, total_duplicates: 0 };
  },

  // --- PRICE TRACKER ---
  async addTrackedPrice(userId: number, url: string, name: string, price: number) {
    await supabase.from('tracked_prices').insert({ user_id: userId, url, item_name: name, last_price: price });
  },

  async getTrackedPrices(userId: number) {
    const { data } = await supabase.from('tracked_prices').select('*').eq('user_id', userId);
    return data || [];
  },

  async getAllTrackedPrices() {
    const { data } = await supabase.from('tracked_prices').select('*');
    return data || [];
  },

  async updatePrice(id: number, newPrice: number) {
    await supabase.from('tracked_prices').update({ last_price: newPrice }).eq('id', id);
  },

  async removePrice(userId: number, id: number) {
    await supabase.from('tracked_prices').delete().eq('id', id).eq('user_id', userId);
  },

  // --- SETTINGS ---
  async getSetting(key: string): Promise<string | null> {
    const { data } = await supabase.from('bot_settings').select('value').eq('key', key).maybeSingle();
    return data?.value ?? null;
  },

  async setSetting(key: string, value: string) {
    await supabase.from('bot_settings').upsert({ key, value }, { onConflict: 'key' });
  },

  // --- MONITORED CHANNELS ---
  async getMonitoredChannels() {
    const { data, error } = await supabase.from('monitored_channels').select('*');
    if (error) logger.error(`getMonitoredChannels error: ${error.message}`);
    return data || [];
  },

  async getUserMonitoredChannels(userId: number) {
    const { data, error } = await supabase.from('monitored_channels').select('*').eq('user_id', userId);
    if (error) logger.error(`getUserMonitoredChannels error: ${error.message}`);
    return data || [];
  },

  async addMonitoredChannel(userId: number, platform: string, channelId: string, name: string) {
    const { error } = await supabase.from('monitored_channels').insert({ user_id: userId, platform, channel_id: channelId, name });
    if (error) logger.error(`addMonitoredChannel error: ${error.message}`);
  },

  async updateMonitoredChannel(id: number, lastPostId: string) {
    const { error } = await supabase.from('monitored_channels').update({ last_post_id: lastPostId }).eq('id', id);
    if (error) logger.error(`updateMonitoredChannel error: ${error.message}`);
  },

  async removeMonitoredChannel(userId: number, id: number) {
    const { error } = await supabase.from('monitored_channels').delete().eq('id', id).eq('user_id', userId);
    if (error) logger.error(`removeMonitoredChannel error: ${error.message}`);
  },

  // --- VECTOR DEDUPLICATION ---
  async findSimilarNews(userId: number, embedding: number[], threshold: number = 0.9) {
    const { data, error } = await supabase.rpc('match_news', {
      query_embedding: embedding,
      match_threshold: threshold,
      p_user_id: userId
    });
    
    if (error) {
      // If the function doesn't exist yet, we log it but don't crash
      if (error.message.includes('function match_news') && error.message.includes('does not exist')) {
         logger.warn('⚠️ Supabase SQL migration (match_news) hali bajarilmagan. Iltimos, SQL Editorda migrationni ishga tushiring.');
      } else {
         logger.error(`findSimilarNews error: ${error.message}`);
      }
      return null;
    }
    return data && data.length > 0 ? data[0] : null;
  },

  async saveEmbedding(userId: number, contentHash: string, embedding: number[]) {
    const { error } = await supabase.from('news_embeddings').insert({
      user_id: userId,
      content_hash: contentHash,
      embedding: embedding
    });
    if (error) {
      if (error.code === '42P01') { // Table does not exist
         logger.warn('⚠️ news_embeddings jadvali topilmadi. Migration bajarilishi kerak.');
      } else {
         logger.error(`saveEmbedding error: ${error.message}`);
      }
    }
  },

  async cleanupOldEmbeddings(days: number = 7) {
     const date = new Date();
     date.setDate(date.getDate() - days);
     await supabase.from('news_embeddings').delete().lt('created_at', date.toISOString());
  },

  // ── REFERRAL ──────────────────────────────

  async getUserByReferralCode(code: string) {
    const { data } = await supabase.from('users').select('*').eq('referral_code', code.toUpperCase()).maybeSingle();
    return data;
  },

  async hasReferral(referredId: number): Promise<boolean> {
    const { data } = await supabase.from('referrals').select('id').eq('referred_id', referredId).maybeSingle();
    return !!data;
  },

  async createReferral(referrerId: number, referredId: number): Promise<boolean> {
    const { error } = await supabase.from('referrals').insert({ referrer_id: referrerId, referred_id: referredId });
    if (error) { logger.error(`createReferral: ${error.message}`); return false; }
    return true;
  },

  async checkAndMarkReferralActive(userId: number) {
    const user = await this.getUser(userId);
    if (!user || !user.target_channel) return;
    
    const sources = await this.getUserSources(userId);
    if (sources.length === 0) return;

    // Check if already active to avoid redundant DB calls
    const { data: ref } = await supabase.from('referrals').select('*').eq('referred_id', userId).maybeSingle();
    if (ref && !ref.is_active) {
       await supabase.from('referrals').update({ is_active: true }).eq('referred_id', userId);
       logger.info(`🎉 Referral active: User ${userId} completed setup!`);
       await this.checkAndGivePremium(ref.referrer_id);
    }
  },

  async checkAndGivePremium(referrerId: number) {
    const { count } = await supabase
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', referrerId)
      .eq('is_active', true);

    const activeCount = count || 0;

    if (activeCount > 0 && activeCount % 10 === 0) {
      await supabase.rpc('extend_premium', { p_user_id: referrerId, p_days: 30 });
      await supabase.rpc('increment_referral_count', { p_user_id: referrerId });
      return { rewarded: true, activeCount };
    }

    await supabase.rpc('increment_referral_count', { p_user_id: referrerId });
    return { rewarded: false, activeCount };
  },

  async getReferralStats(userId: number) {
    const { data: all } = await supabase.from('referrals').select('*').eq('referrer_id', userId);
    const total = all?.length || 0;
    const active = all?.filter(r => r.is_active).length || 0;
    const needed = 10 - (active % 10);
    return { total, active, needed };
  },

  async ensureReferralCode(userId: number): Promise<string> {
    const user = await this.getUser(userId);
    if (user?.referral_code) return user.referral_code;
    const code = crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
    await supabase.from('users').update({ referral_code: code }).eq('telegram_id', userId);
    return code;
  },

  async isPremiumActive(userId: number): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;
    if (user.is_premium && !user.premium_until) return true;
    if (user.premium_until && new Date(user.premium_until) > new Date()) return true;
    if (user.is_premium && user.premium_until && new Date(user.premium_until) <= new Date()) {
      await supabase.from('users').update({ is_premium: 0 }).eq('telegram_id', userId);
    }
    return false;
  },

  // ── KALIT SO'Z FILTRI ────────────────────

  async setKeywords(userId: number, keywords: string) {
    await supabase.from('users').update({ keywords }).eq('telegram_id', userId);
  },

  async getKeywords(userId: number): Promise<string[]> {
    const user = await this.getUser(userId);
    if (!user?.keywords || user.keywords.trim() === '') return [];
    return user.keywords.split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean);
  },

  // ── JADVAL (SCHEDULE) ────────────────────

  async setScheduleTimes(userId: number, times: string) {
    await supabase.from('users').update({ schedule_times: times }).eq('telegram_id', userId);
  },

  // ── KUNLIK DIGEST ────────────────────────

  async setDailyDigest(userId: number, enabled: boolean, time: string) {
    await supabase.from('users').update({ daily_digest: enabled, digest_time: time }).eq('telegram_id', userId);
  },

  async getUsersWithDigest(): Promise<any[]> {
    const { data } = await supabase.from('users').select('*').eq('daily_digest', true).eq('is_approved', 1);
    return data || [];
  },

  async getRecentTitlesForDigest(userId: number, hours: number = 24): Promise<any[]> {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from('processed_news')
      .select('title, url, created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    return data || [];
  },

  // ── TIL ──────────────────────────────────

  async setLanguage(userId: number, lang: 'uz' | 'ru' | 'en') {
    await supabase.from('users').update({ language: lang }).eq('telegram_id', userId);
  },

  // ── ADMIN: PREMIUM & PRICES ────────────────
  async setPremium(telegramId: number, days: number) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    await supabase.from('users').update({ 
      is_premium: 1, 
      premium_until: expiresAt.toISOString() 
    }).eq('telegram_id', telegramId);
  },

  async revokePremium(telegramId: number) {
    await supabase.from('users').update({ 
      is_premium: 0, 
      premium_until: null 
    }).eq('telegram_id', telegramId);
  },
  async setPrice(type: string, price: number) {
    await this.setSetting(`price_${type}`, price.toString());
  },

  async getPrice(type: string): Promise<number> {
    const val = await this.getSetting(`price_${type}`);
    return val ? parseInt(val) : 0;
  },

  // ── SCHEDULED POSTS (Content Calendar) ────
  async addScheduledPost(userId: number, type: 'video' | 'audio' | 'text', content: any, scheduledAt: string) {
    const { error } = await supabase.from('scheduled_posts').insert({
      user_id: userId,
      type: type,
      content: content,
      scheduled_at: scheduledAt,
      status: 'pending'
    });
    if (error) logger.error(`addScheduledPost error: ${error.message}`);
  },

  async getPendingScheduledPosts() {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', now);
    if (error) logger.error(`getPendingScheduledPosts error: ${error.message}`);
    return data || [];
  },

  async getUserScheduledPosts(userId: number) {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('user_id', userId)
      .order('scheduled_at', { ascending: false });
    if (error) logger.error(`getUserScheduledPosts error: ${error.message}`);
    return data || [];
  },

  async markScheduledPostSent(id: number) {
    await supabase.from('scheduled_posts').update({ status: 'sent' }).eq('id', id);
  },

  // ── LIMIT CHECKS (Free vs Premium) ────────
  async checkUserLimit(userId: number, limitType: 'sources' | 'channels' | 'scheduled'): Promise<boolean> {
    const isPremium = await this.isPremiumActive(userId);
    if (isPremium) return true; // Premium has no limits (or very high)

    if (limitType === 'sources') {
      const sources = await this.getUserSources(userId);
      return sources.length < 1; // Free limit: 1 source
    }
    if (limitType === 'channels') {
      const channels = await this.getUserMonitoredChannels(userId);
      return channels.length < 1; // Free limit: 1 channel
    }
    if (limitType === 'scheduled') {
      const { count } = await supabase.from('scheduled_posts').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending');
      return (count || 0) < 3; // Free limit: 3 pending posts
  // --- SUPPORT TICKETS ---
  async createTicket(userId: number, subject: string, message: string) {
    const { data, error } = await supabase.from('support_tickets').insert({ user_id: userId, subject, message }).select().single();
    if (error) logger.error(`createTicket error: ${error.message}`);
    return data;
  },

  async getUserTickets(userId: number) {
    const { data, error } = await supabase.from('support_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) logger.error(`getUserTickets error: ${error.message}`);
    return data || [];
  },

  async getTickets() {
    const { data, error } = await supabase.from('support_tickets').select('*, users(username, first_name)').order('created_at', { ascending: false });
    if (error) logger.error(`getTickets error: ${error.message}`);
    return data || [];
  },

  async updateTicketStatus(ticketId: number, status: string) {
    await supabase.from('support_tickets').update({ status }).eq('id', ticketId);
  },

  // --- ROLE MANAGEMENT ---
  async updateUserRole(telegramId: number, role: string) {
    await supabase.from('users').update({ role }).eq('telegram_id', telegramId);
  },

  async getUsersForAdmin() {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (error) logger.error(`getUsersForAdmin error: ${error.message}`);
    return data || [];
  }
};
