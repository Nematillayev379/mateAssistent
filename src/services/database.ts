import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import { encrypt, decrypt, hashKey } from "../utils/crypto";
import crypto from 'crypto';

let supabase: SupabaseClient;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = CONFIG.SUPABASE_URL;
    const key = CONFIG.SUPABASE_KEY;
    if (!url || !key) {
      console.error('❌ SUPABASE_URL and SUPABASE_KEY must be set in environment variables!');
      process.exit(1);
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

// In-memory cache to prevent redundant Supabase queries for premium verification
const premiumCache = new Map<number, { active: boolean; expiresAt: number }>();
const recentNewsLocks = new Map<string, number>();
const userSendSlots = new Map<number, number>();

export const DBService = {
  isLikelyDuplicateTitle(titleA: string, titleB: string): boolean {
    const a = this.normalizeNewsTitle(titleA);
    const b = this.normalizeNewsTitle(titleB);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length > 24 && b.includes(a)) return true;
    if (b.length > 24 && a.includes(b)) return true;

    const tokensA = [...new Set(a.split(' ').filter((token) => token.length > 2))];
    const tokensB = new Set(b.split(' ').filter((token) => token.length > 2));
    if (tokensA.length < 4 || tokensB.size < 4) return false;

    const common = tokensA.filter((token) => tokensB.has(token)).length;
    const overlap = common / Math.min(tokensA.length, tokensB.size);
    return overlap >= 0.8;
  },

  tryReserveUserSendSlot(userId: number, intervalMinutes: number): boolean {
    const now = Date.now();
    const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
    const lockedUntil = userSendSlots.get(userId) || 0;
    if (lockedUntil > now) return false;
    userSendSlots.set(userId, now + intervalMs);
    return true;
  },

  releaseUserSendSlot(userId: number) {
    userSendSlots.delete(userId);
  },

  normalizeNewsUrl(url: string): string {
    try {
      const parsed = new URL(String(url || '').trim());
      [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'igshid', 'feature'
      ].forEach((param) => parsed.searchParams.delete(param));
      parsed.hash = '';
      parsed.hostname = parsed.hostname.toLowerCase();
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      return parsed.toString();
    } catch {
      return String(url || '').trim();
    }
  },

  normalizeNewsTitle(title: string): string {
    return String(title || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\[[^\]]+\]|\([^)]+\)/g, ' ')
      .replace(/\s+[|\-–—:]\s+.*$/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  acquireRecentNewsLock(userId: number, url: string, title: string, ttlMs = 30 * 60 * 1000): boolean {
    const now = Date.now();
    for (const [key, expiry] of recentNewsLocks.entries()) {
      if (expiry <= now) recentNewsLocks.delete(key);
    }
    const normalizedUrl = this.normalizeNewsUrl(url);
    const normalizedTitle = this.normalizeNewsTitle(title);
    const lockKey = `${userId}:${normalizedUrl}:${normalizedTitle}`;
    const existing = recentNewsLocks.get(lockKey);
    if (existing && existing > now) return false;
    recentNewsLocks.set(lockKey, now + ttlMs);
    return true;
  },

  normalizeTargetChannel(value: string): string {
    let channel = String(value || '').trim();
    if (!channel) return '';
    if (channel.includes('t.me/')) {
      const parts = channel.split('t.me/');
      const handle = parts[parts.length - 1].split('/')[0].trim();
      if (handle) channel = `@${handle}`;
    }
    if (!channel.startsWith('@') && !channel.startsWith('-100') && /^[a-zA-Z0-9_]{5,32}$/.test(channel)) {
      channel = `@${channel}`;
    }
    return channel;
  },

  // --- USERS ---
  async getUser(telegramId: number) {
    const { data, error } = await getSupabase().from('users').select('*').eq('telegram_id', telegramId).single();
    if (error && error.code !== 'PGRST116') logger.error(`getUser error: ${error.message}`);
    return data;
  },
  
  async getAllUsers() {
    const { data, error } = await getSupabase().from('users').select('*');
    if (error) logger.error(`getAllUsers error: ${error.message}`);
    return data || [];
  },
  async getActiveUsers() {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .or('is_active.eq.1,is_active.is.null')
      .not('target_channel', 'is', null)
      .eq('is_approved', 1);

    if (error) logger.error(`getActiveUsers error: ${error.message}`);
    return (data || []).filter((u) => typeof u.target_channel === 'string' && u.target_channel.trim() !== '');
  },
  async upsertUser(telegramId: number, isOwner = 0, username?: string, firstName?: string) {
    const insertData: Record<string, any> = {
      telegram_id: telegramId,
      is_owner: isOwner,
      is_active: 1,
      is_approved: 1, // BUG FIX: Allow normal users to enter without manual approval
      role: isOwner === 1 ? 'owner' : 'user',
      interval_minutes: 15,
      language: 'uz',
      username: username || null,
      first_name: firstName || null,
    };

    let { data, error } = await getSupabase().from('users').upsert(insertData, { onConflict: 'telegram_id' }).select().single();
    if (error) {
      logger.error(`upsertUser error: ${error.message}`);
      const fallbackInsertData = { ...insertData };
      delete fallbackInsertData.role;
      const fallback = await getSupabase().from('users').upsert(fallbackInsertData, { onConflict: 'telegram_id' }).select().single();
      if (fallback.error) {
        logger.error(`upsertUser fallback without role failed: ${fallback.error.message}`);
        return null;
      }
      data = fallback.data;
      if (isOwner === 1 && data) {
        await getSupabase().from('users').update({ is_owner: 1 }).eq('telegram_id', telegramId);
      }
    }

    return data;
  },
  async updateUser(telegramId: number, updates: Record<string, any>): Promise<boolean> {
    const safeUpdates = { ...updates };
    if (typeof safeUpdates.target_channel === 'string') {
      safeUpdates.target_channel = this.normalizeTargetChannel(safeUpdates.target_channel);
    }
    const { error } = await getSupabase().from('users').update(safeUpdates).eq('telegram_id', telegramId);
    if (error) {
      logger.error(`updateUser error: ${error.message}`);
      return false;
    }
    // Invalidate premium cache on updates
    premiumCache.delete(telegramId);
    return true;
  },

  // --- SOURCES ---
  async getUserSources(userId: number) {
    const { data, error } = await getSupabase().from('sources').select('*').eq('user_id', userId);
    if (error) logger.error(`getUserSources error: ${error.message}`);
    return data || [];
  },

  async getAllSources() {
    const { data, error } = await getSupabase().from('sources').select('*');
    if (error) logger.error(`getAllSources error: ${error.message}`);
    return data || [];
  },
  async addSource(userId: number, name: string, url: string, lang: string): Promise<boolean> {
    const { error } = await getSupabase().from('sources').insert({ user_id: userId, name, url, lang });
    if (error) {
      logger.error(`addSource error: ${error.message}`);
      return false;
    }
    return true;
  },

  async removeSource(userId: number, sourceId: number) {
    const { error } = await getSupabase().from('sources').delete().eq('id', sourceId).eq('user_id', userId);
    if (error) logger.error(`removeSource error: ${error.message}`);
  },

  // --- NEWS DEDUPLICATION ---
  async isSeenOrSeenByTitle(userId: number, url: string, title: string): Promise<boolean> {
    const seenUrl = await this.isSeen(userId, url);
    if (seenUrl) return true;
    return this.isSeenByTitle(userId, title);
  },

  async isSeen(userId: number, url: string): Promise<boolean> {
    const normalizedUrl = this.normalizeNewsUrl(url);
    const { data, error } = await getSupabase().from('processed_news').select('id').eq('user_id', userId).eq('url', normalizedUrl).limit(1);
    if (error) logger.error(`isSeen error: ${error.message}`);
    return !!(data && data.length > 0);
  },

  async isSeenByTitle(userId: number, title: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('processed_news')
      .select('title')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) logger.error(`isSeenByTitle error: ${error.message}`);
    if (!data || data.length === 0) return false;
    return data.some((row: any) => this.isLikelyDuplicateTitle(row.title, title));
  },
  async markSeen(userId: number, url: string, title: string) {
    const normalizedUrl = this.normalizeNewsUrl(url);
    const { error } = await getSupabase().from('processed_news').upsert(
      { user_id: userId, url: normalizedUrl, title },
      { onConflict: 'user_id,url' }
    );
    if (error) {
      logger.error(`markSeen error: ${error.message}`);
      throw error;
    }
  },

  async getLastTitles(userId: number, limit: number = 20): Promise<string[]> {
    const { data, error } = await getSupabase().from('processed_news').select('title').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (error) logger.error(`getLastTitles error: ${error.message}`);
    return (data || []).map(r => r.title);
  },

  // --- API KEYS (encrypted at rest) ---
  async addApiKey(userId: number, key: string, type: string) {
    const hashed = hashKey(key);
    const { data: existingKey } = await getSupabase().from('api_keys').select('user_id').eq('api_key_hash', hashed).maybeSingle();
    if (existingKey && existingKey.user_id !== userId) {
      logger.warn(`addApiKey: key already owned by another user`);
      return;
    }
    const encryptedKey = encrypt(key);
    const { error } = await getSupabase().from('api_keys').upsert({
      user_id: userId, api_key: encryptedKey, api_key_hash: hashed, api_type: type, is_active: true
    }, { onConflict: 'api_key_hash' });
    if (error) logger.error(`addApiKey error: ${error.message}`);
  },

  async removeApiKey(userId: number, key: string) {
    const hashed = hashKey(key);
    const { error } = await getSupabase().from('api_keys').delete().eq('user_id', userId).eq('api_key_hash', hashed);
    if (error) logger.error(`removeApiKey error: ${error.message}`);
  },

  async removeApiKeyById(id: number) {
    const { error } = await getSupabase().from('api_keys').delete().eq('id', id);
    if (error) logger.error(`removeApiKeyById error: ${error.message}`);
  },

  async getUserApiKeyCount(userId: number): Promise<number> {
    const { count, error } = await getSupabase().from('api_keys').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (error) logger.error(`getUserApiKeyCount error: ${error.message}`);
    return count || 0;
  },

  async isKeyExists(key: string): Promise<boolean> {
    const hashed = hashKey(key);
    const { data, error } = await getSupabase().from('api_keys').select('id').eq('api_key_hash', hashed).maybeSingle();
    return !!data;
  },

  async getValidApiKeys() {
    const { data, error } = await getSupabase().from('api_keys').select('api_key, api_type').eq('is_active', true);
    if (error) { logger.error(`getValidApiKeys error: ${error.message}`); return []; }
    return (data || []).map(k => {
      try { return { key: decrypt(k.api_key), type: k.api_type }; }
      catch { return { key: k.api_key, type: k.api_type }; }
    });
  },

  async getUserApiKeys(userId: number) {
    const { data, error } = await getSupabase().from('api_keys').select('*').eq('user_id', userId).eq('is_active', true);
    if (error) { logger.error(`getUserApiKeys error: ${error.message}`); return []; }
    return (data || []).map(k => {
      try { return { ...k, api_key: decrypt(k.api_key) }; }
      catch { return k; }
    });
  },

  // --- STATS ---
  async incrementStat(userId: number, field: 'total_posts' | 'total_duplicates') {
    const { error } = await getSupabase().rpc('increment_stat', { p_user_id: userId, p_field: field });
    if (error) logger.error(`incrementStat rpc error: ${error.message}`);
  },
  async getStats(userId: number) {
    const { data } = await getSupabase().from('stats').select('*').eq('user_id', userId).maybeSingle();
    return data || { total_posts: 0, total_duplicates: 0 };
  },

  // --- PRICE TRACKER ---
  async addTrackedPrice(userId: number, url: string, name: string, price: number) {
    const { error } = await getSupabase().from('tracked_prices').insert({ user_id: userId, url, item_name: name, last_price: price });
    if (error) {
      logger.error(`addTrackedPrice error: ${error.message}`);
      throw new Error('Narxni kuzatuvga olishda xatolik yuz berdi.');
    }
  },

  async getTrackedPrices(userId: number) {
    const { data } = await getSupabase().from('tracked_prices').select('*').eq('user_id', userId);
    return data || [];
  },

  async getAllTrackedPrices() {
    const { data } = await getSupabase().from('tracked_prices').select('*');
    return data || [];
  },

  async updatePrice(id: number, newPrice: number) {
    await getSupabase().from('tracked_prices').update({ last_price: newPrice }).eq('id', id);
  },

  async removePrice(userId: number, id: number) {
    await getSupabase().from('tracked_prices').delete().eq('id', id).eq('user_id', userId);
  },

  // --- SETTINGS --- (BUG-014/015 Fix: Single unified implementation using 'settings' table)
  async getSetting(key: string): Promise<string | null> {
    const { data } = await getSupabase().from('settings').select('value').eq('key', key).maybeSingle();
    return data?.value ?? null;
  },

  async setSetting(key: string, value: string) {
    await getSupabase().from('settings').upsert({ key, value }, { onConflict: 'key' });
  },

  // --- MONITORED CHANNELS --- (BUG-012/013 Fix: Single unified implementation)
  async getUserMonitoredChannels(userId: number) {
    const { data, error } = await getSupabase().from('monitored_channels').select('*').eq('user_id', userId);
    if (error) logger.error(`getUserMonitoredChannels error: ${error.message}`);
    return data || [];
  },

  async addMonitoredChannel(
    userId: number,
    platform: string,
    channelId: string,
    name: string,
    opts?: { forward_mode?: string; use_ai?: number }
  ) {
    const row: Record<string, any> = {
      user_id: userId,
      platform,
      channel_id: channelId,
      name,
      forward_mode: opts?.forward_mode || 'copy',
      use_ai: opts?.use_ai ?? 0,
      is_active: 1,
    };
    const { error } = await getSupabase().from('monitored_channels').insert(row);
    if (error) logger.error(`addMonitoredChannel error: ${error.message}`);
  },

  async updateMonitoredChannelSettings(id: number, userId: number, updates: Record<string, any>) {
    const { error } = await getSupabase().from('monitored_channels').update(updates).eq('id', id).eq('user_id', userId);
    if (error) logger.error(`updateMonitoredChannelSettings error: ${error.message}`);
  },

  getUserOutputChannels(user: any): string[] {
    const list: string[] = [];
    if (user?.target_channel) list.push(String(user.target_channel).trim());
    if (user?.extra_channels) {
      user.extra_channels.split(',').forEach((c: string) => {
        const t = c.trim();
        if (t) list.push(t);
      });
    }
    return [...new Set(list)];
  },

  async setExtraChannels(userId: number, channels: string[]) {
    const value = channels.filter(Boolean).join(',');
    await this.updateUser(userId, { extra_channels: value });
  },

  async isTelegramMessageSeen(userId: number, sourceChatId: string, messageId: number): Promise<boolean> {
    const { data } = await getSupabase().from('telegram_seen_messages')
      .select('id')
      .eq('user_id', userId)
      .eq('source_chat_id', sourceChatId)
      .eq('message_id', messageId)
      .maybeSingle();
    return !!data;
  },

  async markTelegramMessageSeen(userId: number, sourceChatId: string, messageId: number) {
    const { error } = await getSupabase().from('telegram_seen_messages').insert({
      user_id: userId,
      source_chat_id: sourceChatId,
      message_id: messageId,
    });
    if (error && !String(error.message).includes('duplicate') && error.code !== '23505') {
      logger.warn(`markTelegramMessageSeen: ${error.message}`);
    }
  },

async getRecentNewsTitles(limit = 80): Promise<string[]> {
     const { data, error } = await getSupabase().from('processed_news').select('title').order('created_at', { ascending: false }).limit(limit);
     if (error) logger.error(`getRecentNewsTitles error: ${error.message}`);
     return (data || []).map((r: any) => r?.title).filter(Boolean) as string[];
   },

  async saveTrendsSnapshot(topics: any[], summary: string) {
    await getSupabase().from('trends_snapshots').insert({ topics, summary });
  },

  async getLatestTrendsSnapshot() {
    const { data } = await getSupabase().from('trends_snapshots').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data;
  },

  async savePostDraft(userId: number, draft: { title?: string; body: string; image_url?: string; channels?: string[] }) {
    const { data, error } = await getSupabase().from('post_drafts').insert({
      user_id: userId,
      title: draft.title || null,
      body: draft.body,
      image_url: draft.image_url || null,
      channels: draft.channels || null,
      status: 'draft',
    }).select().single();
    if (error) logger.error(`savePostDraft error: ${error.message}`);
    return data;
  },

  async getUserPostDrafts(userId: number) {
    const { data } = await getSupabase().from('post_drafts').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20);
    return data || [];
  },

  async removeMonitoredChannel(userId: number, id: number) {
    const { error } = await getSupabase().from('monitored_channels').delete().eq('id', id).eq('user_id', userId);
    if (error) logger.error(`removeMonitoredChannel error: ${error.message}`);
  },
  async getMonitoredChannels() {
    const { data, error } = await getSupabase().from('monitored_channels').select('*');
    if (error) logger.error(`getMonitoredChannels error: ${error.message}`);
    return data || [];
  },
  async updateMonitoredChannel(id: number, lastPostId: string) {
    const { error } = await getSupabase().from('monitored_channels').update({ last_post_id: lastPostId, last_check: new Date().toISOString() }).eq('id', id);
    if (error) logger.error(`updateMonitoredChannel error: ${error.message}`);
  },

  // --- VECTOR DEDUPLICATION ---
  async findSimilarNews(userId: number, embedding: number[], threshold: number = 0.9) {
    const { data, error } = await getSupabase().rpc('match_news', {
      query_embedding: embedding,
      match_threshold: threshold,
      p_user_id: userId
    });
    
    if (error) {
      if (error.message.includes('function match_news') && error.message.includes('does not exist')) {
         logger.warn('⚠️ Supabase SQL migration (match_news) hali bajarilmagan.');
      } else {
         logger.error(`findSimilarNews error: ${error.message}`);
      }
      return null;
    }
    return data && data.length > 0 ? data[0] : null;
  },

  async saveEmbedding(userId: number, contentHash: string, embedding: number[]) {
    const { error } = await getSupabase().from('news_embeddings').insert({
      user_id: userId,
      content_hash: contentHash,
      embedding: embedding
    });
    if (error) logger.error(`saveEmbedding error: ${error.message}`);
  },

  async cleanupOldEmbeddings(days: number = 7) {
     const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
     await getSupabase().from('news_embeddings').delete().lt('created_at', date);
  },

  // ── REFERRAL ──────────────────────────────

  async getUserByReferralCode(code: string) {
    const { data } = await getSupabase().from('users').select('*').eq('referral_code', code.toUpperCase()).maybeSingle();
    return data;
  },

  async hasReferral(referredId: number): Promise<boolean> {
    const { data } = await getSupabase().from('referrals').select('id').eq('referred_id', referredId).maybeSingle();
    return !!data;
  },
  async createReferral(referrerId: number, referredId: number): Promise<boolean> {
    const exists = await this.hasReferral(referredId);
    if (exists) {
      logger.warn(`createReferral: referred user ${referredId} already has a referrer`);
      return false;
    }
    const { error } = await getSupabase().from('referrals').insert({ referrer_id: referrerId, referred_id: referredId });
    if (error) { logger.error(`createReferral: ${error.message}`); return false; }
    return true;
  },

  async checkAndMarkReferralActive(userId: number) {
    const user = await this.getUser(userId);
    if (!user || !user.target_channel) return;
    
    const sources = await this.getUserSources(userId);
    if (sources.length === 0) return;

    const { data: ref } = await getSupabase().from('referrals').select('*').eq('referred_id', userId).maybeSingle();
    if (ref && ref.is_active === false) {
       await getSupabase().from('referrals').update({ is_active: true }).eq('referred_id', userId);
       await this.checkAndGivePremium(ref.referrer_id);
    }
  },
  async checkAndGivePremium(referrerId: number) {
    const { count } = await getSupabase().from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', referrerId).eq('is_active', true);
    const activeCount = count || 0;
    if (activeCount > 0 && activeCount % 10 === 0) {
      const { error } = await getSupabase().rpc('extend_premium', { p_user_id: referrerId, p_days: 30 });
      if (error) logger.error(`extend_premium RPC error: ${error.message}`);
    }
    const { error } = await getSupabase().rpc('increment_referral_count', { p_user_id: referrerId });
    if (error) logger.error(`increment_referral_count RPC error: ${error.message}`);
  },

  async getReferralStats(userId: number) {
    const { data: all } = await getSupabase().from('referrals').select('*').eq('referrer_id', userId);
    const total = all?.length || 0;
    const active = all?.filter(r => r.is_active).length || 0;
    const needed = 10 - (active % 10);
    return { total, active, needed };
  },
   async ensureReferralCode(userId: number): Promise<string> {
     const user = await this.getUser(userId);
     if (user?.referral_code) return user.referral_code;

     let code: string;
     let attempts = 0;
     const maxAttempts = 100;
     do {
       code = crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
       const existing = await this.getUserByReferralCode(code);
       if (!existing) break;
       attempts++;
     } while (attempts < maxAttempts);
     if (attempts >= maxAttempts) {
       const fallbackCode = `${userId.toString(36).toUpperCase().slice(-4)}${code.slice(-4)}`;
       code = fallbackCode;
     }

     await getSupabase().from('users').update({ referral_code: code }).eq('telegram_id', userId);
     return code;
   },
  async isPremiumActive(userId: number): Promise<boolean> {
    const cached = premiumCache.get(userId);
    const nowTime = Date.now();
    if (cached && cached.expiresAt > nowTime) {
      return cached.active;
    }

    const user = await this.getUser(userId);
    if (!user) return false;

    const isPremiumFlag = Number(user.is_premium) === 1 || user.is_premium === true;
    let active = isPremiumFlag;

    if (user.premium_until) {
      const expiryDate = new Date(user.premium_until);
      if (expiryDate > new Date()) {
        active = true;
      } else {
        if (isPremiumFlag) {
          await getSupabase().from('users').update({ is_premium: 0, premium_until: null }).eq('telegram_id', userId);
        }
        active = false;
      }
    }

    premiumCache.set(userId, { active, expiresAt: nowTime + 5 * 60 * 1000 }); // Cache for 5 minutes
    return active;
  },
  async cleanupExpiredPremium() {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('users')
      .update({ is_premium: 0 })
      .eq('is_premium', 1)
      .not('premium_until', 'is', null)
      .lte('premium_until', now);
    if (error) logger.error(`cleanupExpiredPremium error: ${error.message}`);
  },
  async setKeywords(userId: number, keywords: string) {
    const safeKeywords = keywords.slice(0, 1000); // Prevent overflow
    await getSupabase().from('users').update({ keywords: safeKeywords }).eq('telegram_id', userId);
  },
  async getKeywords(userId: number): Promise<string[]> {
    const user = await this.getUser(userId);
    if (!user?.keywords || user.keywords.trim() === '') return [];
    return user.keywords.split(',').map((k: string) => k.trim().toLowerCase()).filter((k: string) => k.length > 0);
  },

  async setScheduleTimes(userId: number, times: string) {
    await getSupabase().from('users').update({ schedule_times: times }).eq('telegram_id', userId);
  },
  async setDailyDigest(userId: number, enabled: boolean, time: string) {
    // Validate time format HH:MM
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const h = parseInt(match[1]);
      const m = parseInt(match[2]);
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        logger.warn(`setDailyDigest: invalid time format '${time}' for user ${userId}`);
        time = '20:00'; // Default fallback
      }
    } else {
      time = '20:00'; // Default fallback
    }
    await getSupabase().from('users').update({ daily_digest: enabled, digest_time: time }).eq('telegram_id', userId);
  },

  async getUsersWithDigest(): Promise<any[]> {
    const { data } = await getSupabase().from('users').select('*').eq('daily_digest', true).eq('is_approved', 1);
    return data || [];
  },
  async getRecentTitlesForDigest(userId: number, hours: number = 24): Promise<any[]> {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data } = await getSupabase().from('processed_news').select('title, url, created_at').eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(100);
    return data || [];
  },

  async setLanguage(userId: number, lang: string) {
    await getSupabase().from('users').update({ language: lang }).eq('telegram_id', userId);
  },

  async setPremium(telegramId: number, days: number) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    await getSupabase().from('users').update({ is_premium: 1, premium_until: expiresAt.toISOString() }).eq('telegram_id', telegramId);
    premiumCache.set(telegramId, { active: true, expiresAt: Date.now() + 5 * 60 * 1000 });
  },

  async revokePremium(telegramId: number) {
    await getSupabase().from('users').update({ is_premium: 0, premium_until: null }).eq('telegram_id', telegramId);
    premiumCache.set(telegramId, { active: false, expiresAt: Date.now() + 5 * 60 * 1000 });
  },

  async setPrice(type: string, price: number) {
    await this.setSetting(`price_${type}`, price.toString());
  },
  async getPrice(type: string): Promise<number> {
    const val = await this.getSetting(`price_${type}`);
    const numericValue = val ? parseInt(val) : NaN;
    return isNaN(numericValue) ? (type === 'monthly' ? 25000 : 250000) : numericValue;
  },
  async addScheduledPost(userId: number, type: 'video' | 'audio' | 'text', content: any, scheduledAt: string) {
    const validTypes = ['video', 'audio', 'text'];
    if (!validTypes.includes(type)) {
      const errorText = `Invalid scheduled post type: ${type}`;
      logger.error(`addScheduledPost error: ${errorText}`);
      throw new Error(errorText);
    }
    if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
      const errorText = `Invalid scheduledAt timestamp: ${scheduledAt}`;
      logger.error(`addScheduledPost error: ${errorText}`);
      throw new Error(errorText);
    }

    const { error } = await getSupabase().from('scheduled_posts').insert({ user_id: userId, type, content, scheduled_at: scheduledAt, status: 'pending' });
    if (error) logger.error(`addScheduledPost error: ${error.message}`);
  },

  async cancelScheduledPost(userId: number, scheduleId: number) {
    const { error } = await getSupabase().from('scheduled_posts').update({ status: 'cancelled' }).eq('id', scheduleId).eq('user_id', userId);
    if (error) logger.error(`cancelScheduledPost error: ${error.message}`);
  },
  async getPendingScheduledPosts() {
    const now = new Date().toISOString();
    const { data, error } = await getSupabase().from('scheduled_posts').select('*').in('status', ['pending', 'failed']).lte('scheduled_at', now);
    if (error) logger.error(`getPendingScheduledPosts error: ${error.message}`);
    return data || [];
  },
  async getUserScheduledPosts(userId: number) {
    const { data, error } = await getSupabase().from('scheduled_posts').select('*').eq('user_id', userId).in('status', ['pending', 'sent']).order('scheduled_at', { ascending: false });
    if (error) logger.error(`getUserScheduledPosts error: ${error.message}`);
    return data || [];
  },

  async markScheduledPostSent(id: number) {
    await getSupabase().from('scheduled_posts').update({ status: 'sent' }).eq('id', id);
  },

  async updateScheduledPostStatus(id: number, status: string) {
    await getSupabase().from('scheduled_posts').update({ status }).eq('id', id);
  },
  async checkUserLimit(userId: number, limitType: 'sources' | 'channels' | 'scheduled'): Promise<boolean> {
    const user = await this.getUser(userId);
    if (user && (user.role === 'owner' || user.role === 'admin' || user.is_owner === 1)) {
      return true;
    }
    const isPremium = await this.isPremiumActive(userId);
    if (isPremium) {
       if (limitType === 'sources') {
         const sources = await this.getUserSources(userId);
         return sources.length < 10;
       }
       if (limitType === 'channels') {
         return true; // unlimited for premium
       }
       if (limitType === 'scheduled') {
         return true; // unlimited for premium
       }
    }

    if (limitType === 'sources') {
      const sources = await this.getUserSources(userId);
      const apiKeyCount = await this.getUserApiKeyCount(userId);
      const limit = 1 + Math.min(apiKeyCount, 3);
      return sources.length < limit;
    }
    if (limitType === 'channels') {
      const channels = await this.getUserMonitoredChannels(userId);
      const limit = 3;
      return channels.length < limit;
    }
    if (limitType === 'scheduled') {
      const { count } = await getSupabase().from('scheduled_posts').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending');
      return (count || 0) < 3;
    }
    return true;
  },

  async createTicket(userId: number, subject: string, message: string) {
    const { data, error } = await getSupabase().from('support_tickets').insert({ user_id: userId, subject, message }).select().single();
    if (error) logger.error(`createTicket error: ${error.message}`);
    return data;
  },

  async getUserTickets(userId: number) {
    const { data, error } = await getSupabase().from('support_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) logger.error(`getUserTickets error: ${error.message}`);
    return data || [];
  },

  async getTickets() {
    const { data, error } = await getSupabase().from('support_tickets').select('*, users(username, first_name)').order('created_at', { ascending: false });
    if (error) logger.error(`getTickets error: ${error.message}`);
    return data || [];
  },
  async updateTicketStatus(ticketId: number, status: string) {
    if (!['open', 'closed', 'resolved'].includes(status)) return;
    await getSupabase().from('support_tickets').update({ status }).eq('id', ticketId);
  },

  async updateUserRole(telegramId: number, role: string) {
    const updates: Record<string, any> = { role };
    if (role === 'owner') {
      updates.is_owner = 1;
      updates.is_approved = 1;
    } else {
      updates.is_owner = 0;
    }

    const { error } = await getSupabase().from('users').update(updates).eq('telegram_id', telegramId);
    if (error) {
      logger.warn(`updateUserRole warning: ${error.message}`);
      return false;
    }
    // Invalidate premium cache on role change
    premiumCache.delete(telegramId);

    if (role === 'premium') {
      await this.setPremium(telegramId, 30);
    } else if (role === 'user') {
      await this.revokePremium(telegramId);
    }
    return true;
  },

  async getUsersForAdmin() {
    const { data, error } = await getSupabase().from('users').select('*').order('created_at', { ascending: false });
    if (error) {
      logger.error(`getUsersForAdmin error: ${error.message}`);
      return [];
    }
    const users = data || [];
    const sources = await this.getAllSources();
    return users.map(u => ({
      ...u,
      sources: sources.filter(s => s.user_id === u.telegram_id)
    }));
  },

  // --- RULES (Automation) ---
  async getUserRules(userId: number): Promise<any[]> {
    const { data, error } = await getSupabase().from('automation_rules').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) { logger.error(`getUserRules error: ${error.message}`); return []; }
    return data || [];
  },

  async addRule(userId: number, trigger: string, condition: string, action: string, actionValue: string): Promise<boolean> {
    const { error } = await getSupabase().from('automation_rules').insert({ user_id: userId, trigger, condition, action, action_value: actionValue });
    if (error) { logger.error(`addRule error: ${error.message}`); return false; }
    return true;
  },

  async toggleRule(ruleId: number, isActive: boolean): Promise<boolean> {
    const { error } = await getSupabase().from('automation_rules').update({ is_active: isActive }).eq('id', ruleId);
    if (error) { logger.error(`toggleRule error: ${error.message}`); return false; }
    return true;
  },

  async deleteRule(ruleId: number): Promise<boolean> {
    const { error } = await getSupabase().from('automation_rules').delete().eq('id', ruleId);
    if (error) { logger.error(`deleteRule error: ${error.message}`); return false; }
    return true;
  },

  // --- WORKSPACES (Multi-Channel) ---
  async getUserWorkspaces(userId: number): Promise<any[]> {
    const { data, error } = await getSupabase().from('workspaces').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) { logger.error(`getUserWorkspaces error: ${error.message}`); return []; }
    return data || [];
  },

  async createWorkspace(userId: number, name: string): Promise<any> {
    const { data, error } = await getSupabase().from('workspaces').insert({ user_id: userId, name }).select().single();
    if (error) { logger.error(`createWorkspace error: ${error.message}`); return null; }
    return data;
  },

  async getWorkspaceChannels(workspaceId: number): Promise<any[]> {
    const { data, error } = await getSupabase().from('workspace_channels').select('*').eq('workspace_id', workspaceId);
    if (error) { logger.error(`getWorkspaceChannels error: ${error.message}`); return []; }
    return data || [];
  },

  async addWorkspaceChannel(workspaceId: number, channelId: string, name: string): Promise<boolean> {
    const { error } = await getSupabase().from('workspace_channels').insert({ workspace_id: workspaceId, channel_id: channelId, name });
    if (error) { logger.error(`addWorkspaceChannel error: ${error.message}`); return false; }
    return true;
  },

  async removeWorkspaceChannel(channelId: string, workspaceId: number): Promise<boolean> {
    const { error } = await getSupabase().from('workspace_channels').delete().eq('channel_id', channelId).eq('workspace_id', workspaceId);
    if (error) { logger.error(`removeWorkspaceChannel error: ${error.message}`); return false; }
    return true;
  },

  async getRecentTitlesForChannel(channelId: string): Promise<any[]> {
    const { data, error } = await getSupabase().from('processed_news').select('title').eq('target_channel', channelId).order('created_at', { ascending: false }).limit(10);
    if (error) return [];
    return data || [];
  },
};
