"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBService = void 0;
const BaseRepository_1 = require("../repositories/BaseRepository");
const UserRepository_1 = require("../repositories/UserRepository");
const NewsRepository_1 = require("../repositories/NewsRepository");
const SourceRepository_1 = require("../repositories/SourceRepository");
const StatsRepository_1 = require("../repositories/StatsRepository");
const ApiKeyRepository_1 = require("../repositories/ApiKeyRepository");
const PricingRepository_1 = require("../repositories/PricingRepository");
const MonitorRepository_1 = require("../repositories/MonitorRepository");
const ReferralRepository_1 = require("../repositories/ReferralRepository");
const WorkspaceRepository_1 = require("../repositories/WorkspaceRepository");
const RuleRepository_1 = require("../repositories/RuleRepository");
const WebUserRepository_1 = require("../repositories/WebUserRepository");
const CryptoPaymentRepository_1 = require("../repositories/CryptoPaymentRepository");
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../utils/logger");
const premiumCache = new Map();
const recentNewsLocks = new Map();
const userSendSlots = new Map();
let lastLocksCleanup = 0;
const LOCKS_CLEANUP_INTERVAL = 60_000;
const MAX_LOCKS_SIZE = 50_000;
// ── Domain service objects ──────────────────────────────────
const UserService = {
    get: (id) => UserRepository_1.UserRepository.get(id),
    getAll: () => UserRepository_1.UserRepository.getAll(),
    getActive: () => UserRepository_1.UserRepository.getActive(),
    upsert: (id, o, u, f) => UserRepository_1.UserRepository.upsert(id, o, u, f),
    update: (id, u) => UserRepository_1.UserRepository.update(id, u),
    getByReferralCode: (c) => UserRepository_1.UserRepository.getByReferralCode(c),
    getForAdmin: () => UserRepository_1.UserRepository.getForAdmin(),
    outputChannels: (u) => UserRepository_1.UserRepository.outputChannels(u),
    getAllUserChannels: (u) => UserRepository_1.UserRepository.getAllChannels(u),
    setExtraChannels: (userId, channels) => UserRepository_1.UserRepository.update(userId, { extra_channels: channels.filter(Boolean).join(',') }),
    async ensureReferralCode(userId) {
        const user = await UserRepository_1.UserRepository.get(userId);
        if (user?.referral_code)
            return user.referral_code;
        let code;
        let attempts = 0;
        do {
            code = crypto_1.default.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
            const existing = await UserRepository_1.UserRepository.getByReferralCode(code);
            if (!existing)
                break;
            attempts++;
        } while (attempts < 100);
        if (attempts >= 100)
            code = `${userId.toString(36).toUpperCase().slice(-4)}${code.slice(-4)}`;
        await (0, BaseRepository_1.getSupabase)().from('users').update({ referral_code: code }).eq('telegram_id', userId);
        return code;
    },
    async isPremiumActive(userId) {
        const cached = premiumCache.get(userId);
        const now = Date.now();
        if (cached && cached.expiresAt > now)
            return cached.active;
        const user = await UserRepository_1.UserRepository.get(userId);
        if (!user)
            return false;
        const isPremiumFlag = Number(user.is_premium) === 1 || user.is_premium === true;
        let active = isPremiumFlag;
        if (user.premium_until) {
            const expiryDate = new Date(user.premium_until);
            if (expiryDate > new Date())
                active = true;
            else {
                if (isPremiumFlag)
                    await (0, BaseRepository_1.getSupabase)().from('users').update({ is_premium: 0, premium_until: null }).eq('telegram_id', userId);
                active = false;
            }
        }
        premiumCache.set(userId, { active, expiresAt: now + 5 * 60 * 1000 });
        return active;
    },
    async cleanupExpiredPremium() {
        const now = new Date().toISOString();
        const { error } = await (0, BaseRepository_1.getSupabase)().from('users').update({ is_premium: 0 }).eq('is_premium', 1).not('premium_until', 'is', null).lte('premium_until', now);
        if (error)
            logger_1.logger.error(`cleanupExpiredPremium error: ${error.message}`);
    },
    normalizeTargetChannel(value) {
        let ch = String(value || '').trim();
        if (!ch)
            return '';
        if (ch.includes('t.me/')) {
            const parts = ch.split('t.me/');
            const h = parts[parts.length - 1].split('/')[0].trim();
            if (h)
                ch = `@${h}`;
        }
        if (!ch.startsWith('@') && !ch.startsWith('-100') && /^[a-zA-Z0-9_]{5,32}$/.test(ch))
            ch = `@${ch}`;
        return ch;
    },
};
const NewsService = {
    isSeen: (id, u, t) => NewsRepository_1.NewsRepository.isSeen(id, u, t),
    isSeenByUrl: (id, u) => NewsRepository_1.NewsRepository.isSeenByUrl(id, u),
    isSeenByTitle: (id, t) => NewsRepository_1.NewsRepository.isSeenByTitle(id, t),
    markSeen: (id, u, t) => NewsRepository_1.NewsRepository.markSeen(id, u, t),
    getLastTitles: (id, l) => NewsRepository_1.NewsRepository.getLastTitles(id, l),
    getRecentTitles: (l) => NewsRepository_1.NewsRepository.getRecentTitles(l),
    isLikelyDuplicateTitle: (a, b) => (0, BaseRepository_1.isLikelyDuplicate)(a, b),
    normalizeUrl: BaseRepository_1.normalizeUrl,
    normalizeTitle: BaseRepository_1.normalizeTitle,
};
const SourceService = {
    getByUser: (id) => SourceRepository_1.SourceRepository.getByUser(id),
    getAll: () => SourceRepository_1.SourceRepository.getAll(),
    add: (id, n, u, l) => SourceRepository_1.SourceRepository.add(id, n, u, l),
    remove: (id, s) => SourceRepository_1.SourceRepository.remove(id, s),
};
const ApiKeyService = {
    add: (id, k, t) => ApiKeyRepository_1.ApiKeyRepository.add(id, k, t),
    remove: (id, k) => ApiKeyRepository_1.ApiKeyRepository.remove(id, k),
    removeById: (id) => ApiKeyRepository_1.ApiKeyRepository.removeById(id),
    count: (id) => ApiKeyRepository_1.ApiKeyRepository.count(id),
    exists: (k) => ApiKeyRepository_1.ApiKeyRepository.exists(k),
    getValid: () => ApiKeyRepository_1.ApiKeyRepository.getValid(),
    getByUser: (id) => ApiKeyRepository_1.ApiKeyRepository.getByUser(id),
};
const StatsService = {
    increment: (id, f) => StatsRepository_1.StatsRepository.increment(id, f),
    get: (id) => StatsRepository_1.StatsRepository.get(id),
};
const PriceService = {
    add: (id, u, n, p) => PricingRepository_1.PriceRepository.add(id, u, n, p),
    getByUser: (id) => PricingRepository_1.PriceRepository.getByUser(id),
    getAll: () => PricingRepository_1.PriceRepository.getAll(),
    updatePrice: (id, p) => PricingRepository_1.PriceRepository.updatePrice(id, p),
    remove: (id, p) => PricingRepository_1.PriceRepository.remove(id, p),
};
const SettingsService = {
    get: (k) => PricingRepository_1.SettingsRepository.get(k),
    set: (k, v) => PricingRepository_1.SettingsRepository.set(k, v),
};
const ScheduleService = {
    add: (id, t, c, s) => PricingRepository_1.ScheduleRepository.add(id, t, c, s),
    cancel: (id, s) => PricingRepository_1.ScheduleRepository.cancel(id, s),
    getPending: () => PricingRepository_1.ScheduleRepository.getPending(),
    getByUser: (id) => PricingRepository_1.ScheduleRepository.getByUser(id),
    markSent: (id) => PricingRepository_1.ScheduleRepository.markSent(id),
    updateStatus: (id, s) => PricingRepository_1.ScheduleRepository.updateStatus(id, s),
};
const CryptoPaymentService = {
    create: (payment) => CryptoPaymentRepository_1.CryptoPaymentRepository.create(payment),
    getById: (id) => CryptoPaymentRepository_1.CryptoPaymentRepository.getById(id),
    updateStatus: (id, status) => CryptoPaymentRepository_1.CryptoPaymentRepository.updateStatus(id, status),
    getWalletClaimByTelegramId: (telegramId) => CryptoPaymentRepository_1.CryptoPaymentRepository.getWalletClaimByTelegramId(telegramId),
    getWalletClaimByAddress: (walletAddress) => CryptoPaymentRepository_1.CryptoPaymentRepository.getWalletClaimByAddress(walletAddress),
    createWalletClaim: (record) => CryptoPaymentRepository_1.CryptoPaymentRepository.createWalletClaim(record),
    deleteWalletClaim: (telegramId) => CryptoPaymentRepository_1.CryptoPaymentRepository.deleteWalletClaim(telegramId),
};
const MonitorService = {
    getByUser: (id) => MonitorRepository_1.MonitorRepository.getByUser(id),
    add: (id, p, c, n, o) => MonitorRepository_1.MonitorRepository.add(id, p, c, n, o),
    updateSettings: (id, u, up) => MonitorRepository_1.MonitorRepository.updateSettings(id, u, up),
    remove: (id, ch) => MonitorRepository_1.MonitorRepository.remove(id, ch),
    getAll: () => MonitorRepository_1.MonitorRepository.getAll(),
    updateLastPost: (id, l) => MonitorRepository_1.MonitorRepository.updateLastPost(id, l),
};
const TelegramMessageService = {
    isSeen: (id, c, m) => MonitorRepository_1.TelegramMessageRepository.isSeen(id, c, m),
    markSeen: (id, c, m) => MonitorRepository_1.TelegramMessageRepository.markSeen(id, c, m),
};
const TrendsService = {
    saveSnapshot: (t, s) => MonitorRepository_1.TrendsRepository.saveSnapshot(t, s),
    getLatest: () => MonitorRepository_1.TrendsRepository.getLatest(),
};
const ReferralService = {
    has: (id) => ReferralRepository_1.ReferralRepository.has(id),
    create: (r, d) => ReferralRepository_1.ReferralRepository.create(r, d),
    getStats: (id) => ReferralRepository_1.ReferralRepository.getStats(id),
    checkAndMarkActive: (id) => ReferralRepository_1.ReferralRepository.checkAndMarkActive(id),
    givePremium: (id) => ReferralRepository_1.ReferralRepository.givePremium(id),
};
const WorkspaceService = {
    getByUser: (id) => WorkspaceRepository_1.WorkspaceRepository.getByUser(id),
    create: (id, n) => WorkspaceRepository_1.WorkspaceRepository.create(id, n),
    getChannels: (id) => WorkspaceRepository_1.WorkspaceRepository.getChannels(id),
    addChannel: (w, c, n) => WorkspaceRepository_1.WorkspaceRepository.addChannel(w, c, n),
    removeChannel: (c, w) => WorkspaceRepository_1.WorkspaceRepository.removeChannel(c, w),
    getMembers: (w) => WorkspaceRepository_1.WorkspaceRepository.getMembers(w),
    addMember: (w, u, r) => WorkspaceRepository_1.WorkspaceRepository.addMember(w, u, r),
    removeMember: (w, u) => WorkspaceRepository_1.WorkspaceRepository.removeMember(w, u),
    updateMemberRole: (w, u, r) => WorkspaceRepository_1.WorkspaceRepository.updateMemberRole(w, u, r),
};
const RuleService = {
    getByUser: (id) => RuleRepository_1.RuleRepository.getByUser(id),
    add: (id, tr, co, ac, av) => RuleRepository_1.RuleRepository.add(id, tr, co, ac, av),
    toggle: (id, a) => RuleRepository_1.RuleRepository.toggle(id, a),
    delete: (id) => RuleRepository_1.RuleRepository.delete(id),
};
const TicketService = {
    create: (id, s, m) => RuleRepository_1.TicketRepository.create(id, s, m),
    getByUser: (id) => RuleRepository_1.TicketRepository.getByUser(id),
    getAll: () => RuleRepository_1.TicketRepository.getAll(),
    updateStatus: (id, s) => RuleRepository_1.TicketRepository.updateStatus(id, s),
};
const DraftService = {
    save: (id, d) => RuleRepository_1.DraftRepository.save(id, d),
    getByUser: (id) => RuleRepository_1.DraftRepository.getByUser(id),
};
const WebUserService = {
    getByEmail: (email) => WebUserRepository_1.WebUserRepository.getByEmail(email),
    list: () => WebUserRepository_1.WebUserRepository.list(),
    create: (record) => WebUserRepository_1.WebUserRepository.create(record),
};
// ── Public API ──────────────────────────────────────────────
exports.DBService = {
    // Domain-specific service objects
    User: UserService,
    News: NewsService,
    Source: SourceService,
    ApiKey: ApiKeyService,
    Stats: StatsService,
    Price: PriceService,
    Settings: SettingsService,
    Schedule: ScheduleService,
    CryptoPayment: CryptoPaymentService,
    Monitor: MonitorService,
    TelegramMessage: TelegramMessageService,
    Trends: TrendsService,
    Referral: ReferralService,
    Workspace: WorkspaceService,
    Rule: RuleService,
    Ticket: TicketService,
    Draft: DraftService,
    WebUser: WebUserService,
    // ── Base (keep at top level) ──
    getSupabase: BaseRepository_1.getSupabase,
    isLikelyDuplicateTitle: (a, b) => NewsService.isLikelyDuplicateTitle(a, b),
    normalizeNewsUrl: (u) => NewsService.normalizeUrl(u),
    normalizeNewsTitle: (t) => NewsService.normalizeTitle(t),
    // ── User (legacy flat methods) ──
    getUser: (id) => UserService.get(id),
    getAllUsers: () => UserService.getAll(),
    getActiveUsers: () => UserService.getActive(),
    upsertUser: (id, o, u, f) => UserService.upsert(id, o, u, f),
    updateUser: (id, u) => UserService.update(id, u),
    getUserByReferralCode: (c) => UserService.getByReferralCode(c),
    getUsersForAdmin: () => UserService.getForAdmin(),
    getUserOutputChannels: (u) => UserService.outputChannels(u),
    getAllUserChannels: (u) => UserService.getAllUserChannels(u),
    getWebUserByEmail: (email) => WebUserService.getByEmail(email),
    getWebUsers: () => WebUserService.list(),
    createWebUser: (record) => WebUserService.create(record),
    setExtraChannels: (userId, channels) => UserService.setExtraChannels(userId, channels),
    ensureReferralCode: (userId) => UserService.ensureReferralCode(userId),
    isPremiumActive: (userId) => UserService.isPremiumActive(userId),
    cleanupExpiredPremium: () => UserService.cleanupExpiredPremium(),
    normalizeTargetChannel: (value) => UserService.normalizeTargetChannel(value),
    // ── Source (legacy flat methods) ──
    getUserSources: (id) => SourceService.getByUser(id),
    getAllSources: () => SourceService.getAll(),
    addSource: (id, n, u, l) => SourceService.add(id, n, u, l),
    removeSource: (id, s) => SourceService.remove(id, s),
    // ── News (legacy flat methods) ──
    isSeenOrSeenByTitle: (id, u, t) => NewsService.isSeen(id, u, t),
    isSeen: (id, u) => NewsService.isSeenByUrl(id, u),
    isSeenByTitle: (id, t) => NewsService.isSeenByTitle(id, t),
    markSeen: (id, u, t) => NewsService.markSeen(id, u, t),
    getLastTitles: (id, l) => NewsService.getLastTitles(id, l),
    getRecentNewsTitles: (l) => NewsService.getRecentTitles(l),
    // ── API Keys (legacy flat methods) ──
    addApiKey: (id, k, t) => ApiKeyService.add(id, k, t),
    removeApiKey: (id, k) => ApiKeyService.remove(id, k),
    removeApiKeyById: (id) => ApiKeyService.removeById(id),
    getUserApiKeyCount: (id) => ApiKeyService.count(id),
    isKeyExists: (k) => ApiKeyService.exists(k),
    getValidApiKeys: () => ApiKeyService.getValid(),
    getUserApiKeys: (id) => ApiKeyService.getByUser(id),
    // ── Stats (legacy flat methods) ──
    incrementStat: (id, f) => StatsService.increment(id, f),
    getStats: (id) => StatsService.get(id),
    // ── Price Tracker (legacy flat methods) ──
    addTrackedPrice: (id, u, n, p) => PriceService.add(id, u, n, p),
    getTrackedPrices: (id) => PriceService.getByUser(id),
    getAllTrackedPrices: () => PriceService.getAll(),
    updatePrice: (id, p) => PriceService.updatePrice(id, p),
    removePrice: (id, p) => PriceService.remove(id, p),
    // ── Settings (legacy flat methods) ──
    getSetting: (k) => SettingsService.get(k),
    setSetting: (k, v) => SettingsService.set(k, v),
    // ── Scheduled Posts (legacy flat methods) ──
    addScheduledPost: (id, t, c, s) => ScheduleService.add(id, t, c, s),
    cancelScheduledPost: (id, s) => ScheduleService.cancel(id, s),
    getPendingScheduledPosts: () => ScheduleService.getPending(),
    getUserScheduledPosts: (id) => ScheduleService.getByUser(id),
    markScheduledPostSent: (id) => ScheduleService.markSent(id),
    updateScheduledPostStatus: (id, s) => ScheduleService.updateStatus(id, s),
    createCryptoPayment: (payment) => CryptoPaymentService.create(payment),
    getCryptoPayment: (id) => CryptoPaymentService.getById(id),
    updateCryptoPaymentStatus: (id, status) => CryptoPaymentService.updateStatus(id, status),
    getWalletClaimByTelegramId: (telegramId) => CryptoPaymentService.getWalletClaimByTelegramId(telegramId),
    getWalletClaimByAddress: (walletAddress) => CryptoPaymentService.getWalletClaimByAddress(walletAddress),
    createWalletClaim: (record) => CryptoPaymentService.createWalletClaim(record),
    deleteWalletClaim: (telegramId) => CryptoPaymentService.deleteWalletClaim(telegramId),
    // ── Monitored Channels (legacy flat methods) ──
    getUserMonitoredChannels: (id) => MonitorService.getByUser(id),
    addMonitoredChannel: (id, p, c, n, o) => MonitorService.add(id, p, c, n, o),
    updateMonitoredChannelSettings: (id, u, up) => MonitorService.updateSettings(id, u, up),
    removeMonitoredChannel: (id, ch) => MonitorService.remove(id, ch),
    getMonitoredChannels: () => MonitorService.getAll(),
    updateMonitoredChannel: (id, l) => MonitorService.updateLastPost(id, l),
    // ── Telegram Messages (legacy flat methods) ──
    isTelegramMessageSeen: (id, c, m) => TelegramMessageService.isSeen(id, c, m),
    markTelegramMessageSeen: (id, c, m) => TelegramMessageService.markSeen(id, c, m),
    // ── Trends (legacy flat methods) ──
    saveTrendsSnapshot: (t, s) => TrendsService.saveSnapshot(t, s),
    getLatestTrendsSnapshot: () => TrendsService.getLatest(),
    // ── Referrals (legacy flat methods) ──
    hasReferral: (id) => ReferralService.has(id),
    createReferral: (r, d) => ReferralService.create(r, d),
    getReferralStats: (id) => ReferralService.getStats(id),
    checkAndMarkReferralActive: (id) => ReferralService.checkAndMarkActive(id),
    checkAndGivePremium: (id) => ReferralService.givePremium(id),
    // ── Workspaces (legacy flat methods) ──
    getUserWorkspaces: (id) => WorkspaceService.getByUser(id),
    createWorkspace: (id, n) => WorkspaceService.create(id, n),
    getWorkspaceChannels: (id) => WorkspaceService.getChannels(id),
    addWorkspaceChannel: (w, c, n) => WorkspaceService.addChannel(w, c, n),
    removeWorkspaceChannel: (c, w) => WorkspaceService.removeChannel(c, w),
    getWorkspaceMembers: (w) => WorkspaceService.getMembers(w),
    addWorkspaceMember: (w, u, r) => WorkspaceService.addMember(w, u, r),
    removeWorkspaceMember: (w, u) => WorkspaceService.removeMember(w, u),
    updateWorkspaceMemberRole: (w, u, r) => WorkspaceService.updateMemberRole(w, u, r),
    // ── Rules (legacy flat methods) ──
    getUserRules: (id) => RuleService.getByUser(id),
    addRule: (id, tr, co, ac, av) => RuleService.add(id, tr, co, ac, av),
    toggleRule: (id, a) => RuleService.toggle(id, a),
    deleteRule: (id) => RuleService.delete(id),
    // ── Tickets (legacy flat methods) ──
    createTicket: (id, s, m) => TicketService.create(id, s, m),
    getUserTickets: (id) => TicketService.getByUser(id),
    getTickets: () => TicketService.getAll(),
    updateTicketStatus: (id, s) => TicketService.updateStatus(id, s),
    // ── Drafts (legacy flat methods) ──
    savePostDraft: (id, d) => DraftService.save(id, d),
    getUserPostDrafts: (id) => DraftService.getByUser(id),
    // ── Embeddings ──
    async findSimilarNews(userId, embedding, threshold = 0.9) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().rpc('match_news', { query_embedding: embedding, match_threshold: threshold, p_user_id: userId });
        if (error) {
            if (error.message.includes('function match_news') && error.message.includes('does not exist')) {
                logger_1.logger.warn('Supabase SQL migration (match_news) hali bajarilmagan.');
            }
            else
                logger_1.logger.error(`findSimilarNews error: ${error.message}`);
            return null;
        }
        return data && data.length > 0 ? data[0] : null;
    },
    async saveEmbedding(userId, contentHash, embedding) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('news_embeddings').insert({ user_id: userId, content_hash: contentHash, embedding });
        if (error)
            logger_1.logger.error(`saveEmbedding error: ${error.message}`);
    },
    async cleanupOldEmbeddings(days = 7) {
        const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        await (0, BaseRepository_1.getSupabase)().from('news_embeddings').delete().lt('created_at', date);
    },
    // ── In-Memory helpers ──
    tryReserveUserSendSlot(userId, intervalMinutes) {
        const now = Date.now();
        const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
        const lockedUntil = userSendSlots.get(userId) || 0;
        if (lockedUntil > now)
            return false;
        userSendSlots.set(userId, now + intervalMs);
        return true;
    },
    releaseUserSendSlot(userId) { userSendSlots.delete(userId); },
    acquireRecentNewsLock(userId, url, title, ttlMs = 12 * 60 * 60 * 1000) {
        const now = Date.now();
        if (now - lastLocksCleanup > LOCKS_CLEANUP_INTERVAL) {
            lastLocksCleanup = now;
            for (const [key, expiry] of recentNewsLocks.entries()) {
                if (expiry <= now)
                    recentNewsLocks.delete(key);
            }
            if (recentNewsLocks.size > MAX_LOCKS_SIZE) {
                const iter = recentNewsLocks.keys();
                let deleted = 0;
                while (deleted < MAX_LOCKS_SIZE / 2) {
                    const k = iter.next().value;
                    if (k === undefined)
                        break;
                    recentNewsLocks.delete(k);
                    deleted++;
                }
            }
        }
        const normalizedUrl = NewsService.normalizeUrl(url);
        const normalizedTitle = NewsService.normalizeTitle(title);
        const urlKey = `${userId}:url:${normalizedUrl}`;
        const titleKey = normalizedTitle ? `${userId}:title:${normalizedTitle}` : '';
        const urlExisting = recentNewsLocks.get(urlKey);
        if (urlExisting && urlExisting > now)
            return false;
        if (titleKey) {
            const titleExisting = recentNewsLocks.get(titleKey);
            if (titleExisting && titleExisting > now)
                return false;
            recentNewsLocks.set(titleKey, now + ttlMs);
        }
        recentNewsLocks.set(urlKey, now + ttlMs);
        return true;
    },
    // ── User composite helpers ──
    async setKeywords(userId, keywords) {
        await (0, BaseRepository_1.getSupabase)().from('users').update({ keywords: keywords.slice(0, 1000) }).eq('telegram_id', userId);
    },
    async getKeywords(userId) {
        const user = await UserRepository_1.UserRepository.get(userId);
        if (!user?.keywords || user.keywords.trim() === '')
            return [];
        return user.keywords.split(',').map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0);
    },
    async setScheduleTimes(userId, times) {
        await (0, BaseRepository_1.getSupabase)().from('users').update({ schedule_times: times }).eq('telegram_id', userId);
    },
    async setDailyDigest(userId, enabled, time) {
        const match = time.match(/^(\d{1,2}):(\d{2})$/);
        if (match) {
            const h = parseInt(match[1]);
            const m = parseInt(match[2]);
            if (h < 0 || h > 23 || m < 0 || m > 59)
                time = '20:00';
        }
        else
            time = '20:00';
        await (0, BaseRepository_1.getSupabase)().from('users').update({ daily_digest: enabled, digest_time: time }).eq('telegram_id', userId);
    },
    async getUsersWithDigest() {
        const { data } = await (0, BaseRepository_1.getSupabase)().from('users').select('*').eq('daily_digest', true).eq('is_approved', 1);
        return data || [];
    },
    async getRecentTitlesForDigest(userId, hours = 24) {
        const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
        const { data } = await (0, BaseRepository_1.getSupabase)().from('processed_news').select('title, url, created_at').eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(100);
        return data || [];
    },
    async setLanguage(userId, lang) {
        await (0, BaseRepository_1.getSupabase)().from('users').update({ language: lang }).eq('telegram_id', userId);
    },
    async setPremium(telegramId, days) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);
        await (0, BaseRepository_1.getSupabase)().from('users').update({ is_premium: 1, premium_until: expiresAt.toISOString() }).eq('telegram_id', telegramId);
        premiumCache.set(telegramId, { active: true, expiresAt: Date.now() + 5 * 60 * 1000 });
    },
    async revokePremium(telegramId) {
        await (0, BaseRepository_1.getSupabase)().from('users').update({ is_premium: 0, premium_until: null }).eq('telegram_id', telegramId);
        premiumCache.set(telegramId, { active: false, expiresAt: Date.now() + 5 * 60 * 1000 });
    },
    async setPrice(type, price) { await PricingRepository_1.SettingsRepository.set(`price_${type}`, price.toString()); },
    async getPrice(type) {
        const val = await PricingRepository_1.SettingsRepository.get(`price_${type}`);
        const numeric = val ? parseInt(val) : NaN;
        return isNaN(numeric) ? (type === 'monthly' ? 25000 : 250000) : numeric;
    },
    async checkUserLimit(userId, limitType) {
        const user = await UserRepository_1.UserRepository.get(userId);
        if (user && (user.role === 'owner' || user.role === 'admin' || user.is_owner === 1))
            return true;
        const isPremium = await this.isPremiumActive(userId);
        if (isPremium) {
            if (limitType === 'sources') {
                const s = await SourceRepository_1.SourceRepository.getByUser(userId);
                return s.length < 10;
            }
            return true;
        }
        if (limitType === 'sources') {
            const s = await SourceRepository_1.SourceRepository.getByUser(userId);
            const apiKeyCount = await ApiKeyRepository_1.ApiKeyRepository.count(userId);
            return s.length < 1 + Math.min(apiKeyCount, 3);
        }
        if (limitType === 'channels') {
            const ch = await MonitorRepository_1.MonitorRepository.getByUser(userId);
            return ch.length < 3;
        }
        if (limitType === 'scheduled') {
            const { count } = await (0, BaseRepository_1.getSupabase)().from('scheduled_posts').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending');
            return (count || 0) < 3;
        }
        return true;
    },
    async updateUserRole(telegramId, role) {
        const updates = { role };
        if (role === 'owner') {
            updates.is_owner = 1;
            updates.is_approved = 1;
        }
        else
            updates.is_owner = 0;
        const { error } = await (0, BaseRepository_1.getSupabase)().from('users').update(updates).eq('telegram_id', telegramId);
        if (error) {
            logger_1.logger.warn(`updateUserRole warning: ${error.message}`);
            return false;
        }
        premiumCache.delete(telegramId);
        if (role === 'premium')
            await this.setPremium(telegramId, 30);
        else if (role === 'user')
            await this.revokePremium(telegramId);
        return true;
    },
    async getRecentTitlesForChannel(channelId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('processed_news').select('title').eq('target_channel', channelId).order('created_at', { ascending: false }).limit(10);
        if (error)
            return [];
        return data || [];
    },
};
