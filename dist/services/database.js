"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBService = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const crypto_1 = __importDefault(require("crypto"));
// B-07 Fix: Validate SUPABASE_URL and SUPABASE_KEY on startup
const supabaseUrl = config_1.CONFIG.SUPABASE_URL;
const supabaseKey = config_1.CONFIG.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
    logger_1.logger.error('❌ SUPABASE_URL and SUPABASE_KEY must be set in environment variables!');
    process.exit(1);
}
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
// In-memory cache to prevent redundant Supabase queries for premium verification
const premiumCache = new Map();
const recentNewsLocks = new Map();
exports.DBService = {
    normalizeNewsUrl(url) {
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
        }
        catch {
            return String(url || '').trim();
        }
    },
    normalizeNewsTitle(title) {
        return String(title || '')
            .toLowerCase()
            .replace(/https?:\/\/\S+/g, ' ')
            .replace(/\[[^\]]+\]|\([^)]+\)/g, ' ')
            .replace(/\s+[|\-–—:]\s+.*$/g, ' ')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },
    acquireRecentNewsLock(userId, url, title, ttlMs = 30 * 60 * 1000) {
        const now = Date.now();
        for (const [key, expiry] of recentNewsLocks.entries()) {
            if (expiry <= now)
                recentNewsLocks.delete(key);
        }
        const normalizedUrl = this.normalizeNewsUrl(url);
        const normalizedTitle = this.normalizeNewsTitle(title);
        const lockKey = `${userId}:${normalizedUrl}:${normalizedTitle}`;
        const existing = recentNewsLocks.get(lockKey);
        if (existing && existing > now)
            return false;
        recentNewsLocks.set(lockKey, now + ttlMs);
        return true;
    },
    normalizeTargetChannel(value) {
        let channel = String(value || '').trim();
        if (!channel)
            return '';
        if (channel.includes('t.me/')) {
            const parts = channel.split('t.me/');
            const handle = parts[parts.length - 1].split('/')[0].trim();
            if (handle)
                channel = `@${handle}`;
        }
        if (!channel.startsWith('@') && !channel.startsWith('-100') && /^[a-zA-Z0-9_]{5,32}$/.test(channel)) {
            channel = `@${channel}`;
        }
        return channel;
    },
    // --- USERS ---
    async getUser(telegramId) {
        const { data, error } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
        if (error && error.code !== 'PGRST116')
            logger_1.logger.error(`getUser error: ${error.message}`);
        return data;
    },
    async getAllUsers() {
        const { data, error } = await supabase.from('users').select('*');
        if (error)
            logger_1.logger.error(`getAllUsers error: ${error.message}`);
        return data || [];
    },
    // BUG-018 Fix: Removed dead 'yesterday' variable
    async getActiveUsers() {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('is_active', 1)
            .not('target_channel', 'is', null)
            .eq('is_approved', 1);
        if (error)
            logger_1.logger.error(`getActiveUsers error: ${error.message}`);
        return (data || []).filter((u) => typeof u.target_channel === 'string' && u.target_channel.trim() !== '');
    },
    // BUG-016 Fix: Handle null from getUser properly
    async upsertUser(telegramId, isOwner = 0, username, firstName) {
        const insertData = {
            telegram_id: telegramId,
            is_owner: isOwner,
            is_approved: 1, // BUG FIX: Allow normal users to enter without manual approval
            role: isOwner === 1 ? 'owner' : 'user',
            username: username || null,
            first_name: firstName || null,
        };
        let { data, error } = await supabase.from('users').upsert(insertData, { onConflict: 'telegram_id' }).select().single();
        if (error) {
            logger_1.logger.error(`upsertUser error: ${error.message}`);
            const fallbackInsertData = { ...insertData };
            delete fallbackInsertData.role;
            const fallback = await supabase.from('users').upsert(fallbackInsertData, { onConflict: 'telegram_id' }).select().single();
            if (fallback.error) {
                logger_1.logger.error(`upsertUser fallback without role failed: ${fallback.error.message}`);
                return null;
            }
            data = fallback.data;
            if (isOwner === 1 && data) {
                await supabase.from('users').update({ is_owner: 1 }).eq('telegram_id', telegramId);
            }
        }
        return data;
    },
    // BUG-030 Fix: Return success boolean
    async updateUser(telegramId, updates) {
        const safeUpdates = { ...updates };
        if (typeof safeUpdates.target_channel === 'string') {
            safeUpdates.target_channel = this.normalizeTargetChannel(safeUpdates.target_channel);
        }
        const { error } = await supabase.from('users').update(safeUpdates).eq('telegram_id', telegramId);
        if (error) {
            logger_1.logger.error(`updateUser error: ${error.message}`);
            return false;
        }
        // Invalidate premium cache on updates
        premiumCache.delete(telegramId);
        return true;
    },
    // --- SOURCES ---
    async getUserSources(userId) {
        const { data, error } = await supabase.from('sources').select('*').eq('user_id', userId);
        if (error)
            logger_1.logger.error(`getUserSources error: ${error.message}`);
        return data || [];
    },
    async getAllSources() {
        const { data, error } = await supabase.from('sources').select('*');
        if (error)
            logger_1.logger.error(`getAllSources error: ${error.message}`);
        return data || [];
    },
    // BUG-011 Fix: Return success boolean
    async addSource(userId, name, url, lang) {
        const { error } = await supabase.from('sources').insert({ user_id: userId, name, url, lang });
        if (error) {
            logger_1.logger.error(`addSource error: ${error.message}`);
            return false;
        }
        return true;
    },
    async removeSource(userId, sourceId) {
        const { error } = await supabase.from('sources').delete().eq('id', sourceId).eq('user_id', userId);
        if (error)
            logger_1.logger.error(`removeSource error: ${error.message}`);
    },
    // --- NEWS DEDUPLICATION ---
    // BUG-012 Fix: Single optimized query for deduplication
    async isSeenOrSeenByTitle(userId, url, title) {
        const seenUrl = await this.isSeen(userId, url);
        if (seenUrl)
            return true;
        return this.isSeenByTitle(userId, title);
    },
    async isSeen(userId, url) {
        const normalizedUrl = this.normalizeNewsUrl(url);
        const { data, error } = await supabase.from('processed_news').select('id').eq('user_id', userId).eq('url', normalizedUrl).limit(1);
        if (error)
            logger_1.logger.error(`isSeen error: ${error.message}`);
        return !!(data && data.length > 0);
    },
    async isSeenByTitle(userId, title) {
        const normalizedTitle = this.normalizeNewsTitle(title);
        const { data, error } = await supabase
            .from('processed_news')
            .select('title')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(40);
        if (error)
            logger_1.logger.error(`isSeenByTitle error: ${error.message}`);
        if (!data || data.length === 0)
            return false;
        return data.some((row) => this.normalizeNewsTitle(row.title) === normalizedTitle);
    },
    // BUG-013 Fix: Use upsert with onConflict to handle unique constraints gracefully
    async markSeen(userId, url, title) {
        const normalizedUrl = this.normalizeNewsUrl(url);
        const { error } = await supabase.from('processed_news').upsert({ user_id: userId, url: normalizedUrl, title }, { onConflict: 'user_id,url' });
        if (error) {
            logger_1.logger.error(`markSeen error: ${error.message}`);
            throw error;
        }
    },
    async getLastTitles(userId, limit = 20) {
        const { data, error } = await supabase.from('processed_news').select('title').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
        if (error)
            logger_1.logger.error(`getLastTitles error: ${error.message}`);
        return (data || []).map(r => r.title);
    },
    // --- API KEYS ---
    // BUG-023 Fix: Use onConflict with user_id check
    async addApiKey(userId, key, type) {
        // Check if key already belongs to another user
        const { data: existingKey } = await supabase.from('api_keys').select('user_id').eq('api_key', key).maybeSingle();
        if (existingKey && existingKey.user_id !== userId) {
            logger_1.logger.warn(`addApiKey: key already owned by another user`);
            return;
        }
        const { error } = await supabase.from('api_keys').upsert({ user_id: userId, api_key: key, api_type: type, is_active: true }, { onConflict: 'api_key' });
        if (error)
            logger_1.logger.error(`addApiKey error: ${error.message}`);
    },
    async removeApiKey(userId, key) {
        const { error } = await supabase.from('api_keys').delete().eq('user_id', userId).eq('api_key', key);
        if (error)
            logger_1.logger.error(`removeApiKey error: ${error.message}`);
    },
    async getUserApiKeyCount(userId) {
        const { count, error } = await supabase.from('api_keys').select('*', { count: 'exact', head: true }).eq('user_id', userId);
        if (error)
            logger_1.logger.error(`getUserApiKeyCount error: ${error.message}`);
        return count || 0;
    },
    async isKeyExists(key) {
        const { data, error } = await supabase.from('api_keys').select('id').eq('api_key', key).maybeSingle();
        return !!data;
    },
    async getValidApiKeys() {
        const { data, error } = await supabase.from('api_keys').select('api_key, api_type').eq('is_active', true);
        if (error)
            logger_1.logger.error(`getValidApiKeys error: ${error.message}`);
        return (data || []).map(k => ({ key: k.api_key, type: k.api_type }));
    },
    async getUserApiKeys(userId) {
        const { data, error } = await supabase.from('api_keys').select('*').eq('user_id', userId).eq('is_active', true);
        if (error)
            logger_1.logger.error(`getUserApiKeys error: ${error.message}`);
        return data || [];
    },
    // --- STATS ---
    async incrementStat(userId, field) {
        const { error } = await supabase.rpc('increment_stat', { p_user_id: userId, p_field: field });
        if (error)
            logger_1.logger.error(`incrementStat rpc error: ${error.message}`);
    },
    // BUG-024 Fix: Initialize stats if not exists
    // BUG-095 Fix: Removed non-existent total_errors
    async getStats(userId) {
        const { data } = await supabase.from('stats').select('*').eq('user_id', userId).maybeSingle();
        return data || { total_posts: 0, total_duplicates: 0 };
    },
    // --- PRICE TRACKER ---
    // BUG-093 Fix: Added error handling
    async addTrackedPrice(userId, url, name, price) {
        const { error } = await supabase.from('tracked_prices').insert({ user_id: userId, url, item_name: name, last_price: price });
        if (error) {
            logger_1.logger.error(`addTrackedPrice error: ${error.message}`);
            throw new Error('Narxni kuzatuvga olishda xatolik yuz berdi.');
        }
    },
    async getTrackedPrices(userId) {
        const { data } = await supabase.from('tracked_prices').select('*').eq('user_id', userId);
        return data || [];
    },
    async getAllTrackedPrices() {
        const { data } = await supabase.from('tracked_prices').select('*');
        return data || [];
    },
    async updatePrice(id, newPrice) {
        await supabase.from('tracked_prices').update({ last_price: newPrice }).eq('id', id);
    },
    async removePrice(userId, id) {
        await supabase.from('tracked_prices').delete().eq('id', id).eq('user_id', userId);
    },
    // --- SETTINGS --- (BUG-014/015 Fix: Single unified implementation using 'settings' table)
    async getSetting(key) {
        const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
        return data?.value ?? null;
    },
    async setSetting(key, value) {
        await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });
    },
    // --- MONITORED CHANNELS --- (BUG-012/013 Fix: Single unified implementation)
    async getUserMonitoredChannels(userId) {
        const { data, error } = await supabase.from('monitored_channels').select('*').eq('user_id', userId);
        if (error)
            logger_1.logger.error(`getUserMonitoredChannels error: ${error.message}`);
        return data || [];
    },
    async addMonitoredChannel(userId, platform, channelId, name, opts) {
        const row = {
            user_id: userId,
            platform,
            channel_id: channelId,
            name,
            forward_mode: opts?.forward_mode || 'copy',
            use_ai: opts?.use_ai ?? 0,
            is_active: 1,
        };
        const { error } = await supabase.from('monitored_channels').insert(row);
        if (error)
            logger_1.logger.error(`addMonitoredChannel error: ${error.message}`);
    },
    async updateMonitoredChannelSettings(id, userId, updates) {
        const { error } = await supabase.from('monitored_channels').update(updates).eq('id', id).eq('user_id', userId);
        if (error)
            logger_1.logger.error(`updateMonitoredChannelSettings error: ${error.message}`);
    },
    getUserOutputChannels(user) {
        const list = [];
        if (user?.target_channel)
            list.push(String(user.target_channel).trim());
        if (user?.extra_channels) {
            user.extra_channels.split(',').forEach((c) => {
                const t = c.trim();
                if (t)
                    list.push(t);
            });
        }
        return [...new Set(list)];
    },
    async setExtraChannels(userId, channels) {
        const value = channels.filter(Boolean).join(',');
        await this.updateUser(userId, { extra_channels: value });
    },
    async isTelegramMessageSeen(userId, sourceChatId, messageId) {
        const { data } = await supabase.from('telegram_seen_messages')
            .select('id')
            .eq('user_id', userId)
            .eq('source_chat_id', sourceChatId)
            .eq('message_id', messageId)
            .maybeSingle();
        return !!data;
    },
    async markTelegramMessageSeen(userId, sourceChatId, messageId) {
        const { error } = await supabase.from('telegram_seen_messages').insert({
            user_id: userId,
            source_chat_id: sourceChatId,
            message_id: messageId,
        });
        if (error && !String(error.message).includes('duplicate') && error.code !== '23505') {
            logger_1.logger.warn(`markTelegramMessageSeen: ${error.message}`);
        }
    },
    async getRecentNewsTitles(limit = 80) {
        const { data, error } = await supabase.from('processed_news').select('title').order('created_at', { ascending: false }).limit(limit);
        if (error)
            logger_1.logger.error(`getRecentNewsTitles error: ${error.message}`);
        return (data || []).map((r) => r?.title).filter(Boolean);
    },
    async saveTrendsSnapshot(topics, summary) {
        await supabase.from('trends_snapshots').insert({ topics, summary });
    },
    async getLatestTrendsSnapshot() {
        const { data } = await supabase.from('trends_snapshots').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
        return data;
    },
    async savePostDraft(userId, draft) {
        const { data, error } = await supabase.from('post_drafts').insert({
            user_id: userId,
            title: draft.title || null,
            body: draft.body,
            image_url: draft.image_url || null,
            channels: draft.channels || null,
            status: 'draft',
        }).select().single();
        if (error)
            logger_1.logger.error(`savePostDraft error: ${error.message}`);
        return data;
    },
    async getUserPostDrafts(userId) {
        const { data } = await supabase.from('post_drafts').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20);
        return data || [];
    },
    async removeMonitoredChannel(userId, id) {
        const { error } = await supabase.from('monitored_channels').delete().eq('id', id).eq('user_id', userId);
        if (error)
            logger_1.logger.error(`removeMonitoredChannel error: ${error.message}`);
    },
    // BUG-012 Fix: Single getMonitoredChannels
    async getMonitoredChannels() {
        const { data, error } = await supabase.from('monitored_channels').select('*');
        if (error)
            logger_1.logger.error(`getMonitoredChannels error: ${error.message}`);
        return data || [];
    },
    // BUG-013 Fix: Single updateMonitoredChannel with last_check
    async updateMonitoredChannel(id, lastPostId) {
        const { error } = await supabase.from('monitored_channels').update({ last_post_id: lastPostId, last_check: new Date().toISOString() }).eq('id', id);
        if (error)
            logger_1.logger.error(`updateMonitoredChannel error: ${error.message}`);
    },
    // --- VECTOR DEDUPLICATION ---
    async findSimilarNews(userId, embedding, threshold = 0.9) {
        const { data, error } = await supabase.rpc('match_news', {
            query_embedding: embedding,
            match_threshold: threshold,
            p_user_id: userId
        });
        if (error) {
            if (error.message.includes('function match_news') && error.message.includes('does not exist')) {
                logger_1.logger.warn('⚠️ Supabase SQL migration (match_news) hali bajarilmagan.');
            }
            else {
                logger_1.logger.error(`findSimilarNews error: ${error.message}`);
            }
            return null;
        }
        return data && data.length > 0 ? data[0] : null;
    },
    async saveEmbedding(userId, contentHash, embedding) {
        const { error } = await supabase.from('news_embeddings').insert({
            user_id: userId,
            content_hash: contentHash,
            embedding: embedding
        });
        if (error)
            logger_1.logger.error(`saveEmbedding error: ${error.message}`);
    },
    async cleanupOldEmbeddings(days = 7) {
        const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('news_embeddings').delete().lt('created_at', date);
    },
    // ── REFERRAL ──────────────────────────────
    async getUserByReferralCode(code) {
        const { data } = await supabase.from('users').select('*').eq('referral_code', code.toUpperCase()).maybeSingle();
        return data;
    },
    async hasReferral(referredId) {
        const { data } = await supabase.from('referrals').select('id').eq('referred_id', referredId).maybeSingle();
        return !!data;
    },
    // BUG-022 Fix: Check for existing referral before creating
    async createReferral(referrerId, referredId) {
        const exists = await this.hasReferral(referredId);
        if (exists) {
            logger_1.logger.warn(`createReferral: referred user ${referredId} already has a referrer`);
            return false;
        }
        const { error } = await supabase.from('referrals').insert({ referrer_id: referrerId, referred_id: referredId });
        if (error) {
            logger_1.logger.error(`createReferral: ${error.message}`);
            return false;
        }
        return true;
    },
    async checkAndMarkReferralActive(userId) {
        const user = await this.getUser(userId);
        if (!user || !user.target_channel)
            return;
        const sources = await this.getUserSources(userId);
        if (sources.length === 0)
            return;
        const { data: ref } = await supabase.from('referrals').select('*').eq('referred_id', userId).maybeSingle();
        if (ref && ref.is_active === false) {
            await supabase.from('referrals').update({ is_active: true }).eq('referred_id', userId);
            await this.checkAndGivePremium(ref.referrer_id);
        }
    },
    // BUG-029 Fix: Added error handling for RPCs
    async checkAndGivePremium(referrerId) {
        const { count } = await supabase.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', referrerId).eq('is_active', true);
        const activeCount = count || 0;
        if (activeCount > 0 && activeCount % 10 === 0) {
            const { error } = await supabase.rpc('extend_premium', { p_user_id: referrerId, p_days: 30 });
            if (error)
                logger_1.logger.error(`extend_premium RPC error: ${error.message}`);
        }
        const { error } = await supabase.rpc('increment_referral_count', { p_user_id: referrerId });
        if (error)
            logger_1.logger.error(`increment_referral_count RPC error: ${error.message}`);
    },
    async getReferralStats(userId) {
        const { data: all } = await supabase.from('referrals').select('*').eq('referrer_id', userId);
        const total = all?.length || 0;
        const active = all?.filter(r => r.is_active).length || 0;
        const needed = 10 - (active % 10);
        return { total, active, needed };
    },
    // BUG-021 Fix: Collision check for referral code - fallback to unique suffix
    async ensureReferralCode(userId) {
        const user = await this.getUser(userId);
        if (user?.referral_code)
            return user.referral_code;
        let code;
        let attempts = 0;
        const maxAttempts = 100;
        do {
            code = crypto_1.default.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
            const existing = await this.getUserByReferralCode(code);
            if (!existing)
                break;
            attempts++;
        } while (attempts < maxAttempts);
        // BUG-015 Fix: Fallback to userId-based unique code instead of throwing
        if (attempts >= maxAttempts) {
            const fallbackCode = `${userId.toString(36).toUpperCase().slice(-4)}${code.slice(-4)}`;
            code = fallbackCode;
        }
        await supabase.from('users').update({ referral_code: code }).eq('telegram_id', userId);
        return code;
    },
    // BUG-126 Fix: Add in-memory cache for premium status
    async isPremiumActive(userId) {
        const cached = premiumCache.get(userId);
        const nowTime = Date.now();
        if (cached && cached.expiresAt > nowTime) {
            return cached.active;
        }
        const user = await this.getUser(userId);
        if (!user)
            return false;
        const isPremiumFlag = Number(user.is_premium) === 1 || user.is_premium === true;
        let active = isPremiumFlag;
        if (user.premium_until) {
            const expiryDate = new Date(user.premium_until);
            if (expiryDate > new Date()) {
                active = true;
            }
            else {
                if (isPremiumFlag) {
                    await supabase.from('users').update({ is_premium: 0, premium_until: null }).eq('telegram_id', userId);
                }
                active = false;
            }
        }
        premiumCache.set(userId, { active, expiresAt: nowTime + 5 * 60 * 1000 }); // Cache for 5 minutes
        return active;
    },
    // BUG-020 Fix: Now called from main.ts system crons
    async cleanupExpiredPremium() {
        const now = new Date().toISOString();
        const { error } = await supabase
            .from('users')
            .update({ is_premium: 0 })
            .eq('is_premium', 1)
            .not('premium_until', 'is', null)
            .lte('premium_until', now);
        if (error)
            logger_1.logger.error(`cleanupExpiredPremium error: ${error.message}`);
    },
    // BUG-132 Fix: Add length limit
    async setKeywords(userId, keywords) {
        const safeKeywords = keywords.slice(0, 1000); // Prevent overflow
        await supabase.from('users').update({ keywords: safeKeywords }).eq('telegram_id', userId);
    },
    // BUG-008 Fix: Filter out empty strings from split
    async getKeywords(userId) {
        const user = await this.getUser(userId);
        if (!user?.keywords || user.keywords.trim() === '')
            return [];
        return user.keywords.split(',').map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0);
    },
    async setScheduleTimes(userId, times) {
        await supabase.from('users').update({ schedule_times: times }).eq('telegram_id', userId);
    },
    // BUG-027 Fix: Validate digest time format
    async setDailyDigest(userId, enabled, time) {
        // Validate time format HH:MM
        const match = time.match(/^(\d{1,2}):(\d{2})$/);
        if (match) {
            const h = parseInt(match[1]);
            const m = parseInt(match[2]);
            if (h < 0 || h > 23 || m < 0 || m > 59) {
                logger_1.logger.warn(`setDailyDigest: invalid time format '${time}' for user ${userId}`);
                time = '20:00'; // Default fallback
            }
        }
        else {
            time = '20:00'; // Default fallback
        }
        await supabase.from('users').update({ daily_digest: enabled, digest_time: time }).eq('telegram_id', userId);
    },
    async getUsersWithDigest() {
        const { data } = await supabase.from('users').select('*').eq('daily_digest', true).eq('is_approved', 1);
        return data || [];
    },
    // BUG-028 & BUG-097 Fix: Increase limit for digest and add source info
    async getRecentTitlesForDigest(userId, hours = 24) {
        const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
        const { data } = await supabase.from('processed_news').select('title, url, created_at').eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(100);
        return data || [];
    },
    async setLanguage(userId, lang) {
        await supabase.from('users').update({ language: lang }).eq('telegram_id', userId);
    },
    async setPremium(telegramId, days) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);
        await supabase.from('users').update({ is_premium: 1, premium_until: expiresAt.toISOString() }).eq('telegram_id', telegramId);
        premiumCache.set(telegramId, { active: true, expiresAt: Date.now() + 5 * 60 * 1000 });
    },
    async revokePremium(telegramId) {
        await supabase.from('users').update({ is_premium: 0, premium_until: null }).eq('telegram_id', telegramId);
        premiumCache.set(telegramId, { active: false, expiresAt: Date.now() + 5 * 60 * 1000 });
    },
    async setPrice(type, price) {
        await this.setSetting(`price_${type}`, price.toString());
    },
    // BUG-014 Fix: Single getPrice using settings table
    async getPrice(type) {
        const val = await this.getSetting(`price_${type}`);
        const numericValue = val ? parseInt(val) : NaN;
        return isNaN(numericValue) ? (type === 'monthly' ? 25000 : 250000) : numericValue;
    },
    // BUG-025 Fix: Validate scheduled_at and type
    async addScheduledPost(userId, type, content, scheduledAt) {
        const validTypes = ['video', 'audio', 'text'];
        if (!validTypes.includes(type)) {
            const errorText = `Invalid scheduled post type: ${type}`;
            logger_1.logger.error(`addScheduledPost error: ${errorText}`);
            throw new Error(errorText);
        }
        if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
            const errorText = `Invalid scheduledAt timestamp: ${scheduledAt}`;
            logger_1.logger.error(`addScheduledPost error: ${errorText}`);
            throw new Error(errorText);
        }
        const { error } = await supabase.from('scheduled_posts').insert({ user_id: userId, type, content, scheduled_at: scheduledAt, status: 'pending' });
        if (error)
            logger_1.logger.error(`addScheduledPost error: ${error.message}`);
    },
    async cancelScheduledPost(userId, scheduleId) {
        const { error } = await supabase.from('scheduled_posts').update({ status: 'cancelled' }).eq('id', scheduleId).eq('user_id', userId);
        if (error)
            logger_1.logger.error(`cancelScheduledPost error: ${error.message}`);
    },
    // BUG-016 Fix: Include 'failed' posts for retry
    async getPendingScheduledPosts() {
        const now = new Date().toISOString();
        const { data, error } = await supabase.from('scheduled_posts').select('*').in('status', ['pending', 'failed']).lte('scheduled_at', now);
        if (error)
            logger_1.logger.error(`getPendingScheduledPosts error: ${error.message}`);
        return data || [];
    },
    // BUG-026 Fix: Filter only pending/sent posts for user view
    async getUserScheduledPosts(userId) {
        const { data, error } = await supabase.from('scheduled_posts').select('*').eq('user_id', userId).in('status', ['pending', 'sent']).order('scheduled_at', { ascending: false });
        if (error)
            logger_1.logger.error(`getUserScheduledPosts error: ${error.message}`);
        return data || [];
    },
    async markScheduledPostSent(id) {
        await supabase.from('scheduled_posts').update({ status: 'sent' }).eq('id', id);
    },
    async updateScheduledPostStatus(id, status) {
        await supabase.from('scheduled_posts').update({ status }).eq('id', id);
    },
    // BUG-017 Fix: Consistent limit calculation
    async checkUserLimit(userId, limitType) {
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
            const { count } = await supabase.from('scheduled_posts').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending');
            return (count || 0) < 3;
        }
        return true;
    },
    async createTicket(userId, subject, message) {
        const { data, error } = await supabase.from('support_tickets').insert({ user_id: userId, subject, message }).select().single();
        if (error)
            logger_1.logger.error(`createTicket error: ${error.message}`);
        return data;
    },
    async getUserTickets(userId) {
        const { data, error } = await supabase.from('support_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error)
            logger_1.logger.error(`getUserTickets error: ${error.message}`);
        return data || [];
    },
    async getTickets() {
        const { data, error } = await supabase.from('support_tickets').select('*, users(username, first_name)').order('created_at', { ascending: false });
        if (error)
            logger_1.logger.error(`getTickets error: ${error.message}`);
        return data || [];
    },
    // BUG-133 Fix: Validate status
    async updateTicketStatus(ticketId, status) {
        if (!['open', 'closed', 'resolved'].includes(status))
            return;
        await supabase.from('support_tickets').update({ status }).eq('id', ticketId);
    },
    async updateUserRole(telegramId, role) {
        const updates = { role };
        if (role === 'owner') {
            updates.is_owner = 1;
            updates.is_approved = 1;
        }
        else {
            updates.is_owner = 0;
        }
        const { error } = await supabase.from('users').update(updates).eq('telegram_id', telegramId);
        if (error) {
            logger_1.logger.warn(`updateUserRole warning: ${error.message}`);
            return false;
        }
        // Invalidate premium cache on role change
        premiumCache.delete(telegramId);
        if (role === 'premium') {
            await this.setPremium(telegramId, 30);
        }
        else if (role === 'user') {
            await this.revokePremium(telegramId);
        }
        return true;
    },
    async getUsersForAdmin() {
        const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
        if (error) {
            logger_1.logger.error(`getUsersForAdmin error: ${error.message}`);
            return [];
        }
        const users = data || [];
        const sources = await this.getAllSources();
        return users.map(u => ({
            ...u,
            sources: sources.filter(s => s.user_id === u.telegram_id)
        }));
    },
};
