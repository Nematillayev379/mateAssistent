import { getSupabase, isLikelyDuplicate as _isLikelyDuplicate, normalizeUrl as _normalizeUrl, normalizeTitle as _normalizeTitle } from "../repositories/BaseRepository";
import { UserRepository } from "../repositories/UserRepository";
import { NewsRepository } from "../repositories/NewsRepository";
import { SourceRepository } from "../repositories/SourceRepository";
import { StatsRepository } from "../repositories/StatsRepository";
import { ApiKeyRepository } from "../repositories/ApiKeyRepository";
import { PriceRepository, SettingsRepository, ScheduleRepository } from "../repositories/PricingRepository";
import { MonitorRepository, TelegramMessageRepository, TrendsRepository } from "../repositories/MonitorRepository";
import { ReferralRepository } from "../repositories/ReferralRepository";
import { WorkspaceRepository } from "../repositories/WorkspaceRepository";
import { RuleRepository, TicketRepository, DraftRepository } from "../repositories/RuleRepository";
import { WebUserRepository } from "../repositories/WebUserRepository";
import { CryptoPaymentRepository, type CryptoPaymentRecord, type WalletClaimRecord } from "../repositories/CryptoPaymentRepository";
import crypto from 'crypto';
import { logger } from "../utils/logger";

const premiumCache = new Map<number, { active: boolean; expiresAt: number }>();
const recentNewsLocks = new Map<string, number>();
const userSendSlots = new Map<number, number>();

// ── Domain service objects ──────────────────────────────────

const UserService = {
  get: (id: number) => UserRepository.get(id),
  getAll: () => UserRepository.getAll(),
  getActive: () => UserRepository.getActive(),
  upsert: (id: number, o?: number, u?: string, f?: string) => UserRepository.upsert(id, o, u, f),
  update: (id: number, u: Record<string, any>) => UserRepository.update(id, u),
  getByReferralCode: (c: string) => UserRepository.getByReferralCode(c),
  getForAdmin: () => UserRepository.getForAdmin(),
  outputChannels: (u: any) => UserRepository.outputChannels(u),
  getAllUserChannels: (u: any) => UserRepository.getAllChannels(u),
  setExtraChannels: (userId: number, channels: string[]) => UserRepository.update(userId, { extra_channels: channels.filter(Boolean).join(',') }),

  async ensureReferralCode(userId: number): Promise<string> {
    const user = await UserRepository.get(userId);
    if (user?.referral_code) return user.referral_code;
    let code: string;
    let attempts = 0;
    do {
      code = crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
      const existing = await UserRepository.getByReferralCode(code);
      if (!existing) break;
      attempts++;
    } while (attempts < 100);
    if (attempts >= 100) code = `${userId.toString(36).toUpperCase().slice(-4)}${code.slice(-4)}`;
    await getSupabase().from('users').update({ referral_code: code }).eq('telegram_id', userId);
    return code;
  },

  async isPremiumActive(userId: number): Promise<boolean> {
    const cached = premiumCache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.active;
    const user = await UserRepository.get(userId);
    if (!user) return false;
    const isPremiumFlag = Number(user.is_premium) === 1 || user.is_premium === true;
    let active = isPremiumFlag;
    if (user.premium_until) {
      const expiryDate = new Date(user.premium_until);
      if (expiryDate > new Date()) active = true;
      else { if (isPremiumFlag) await getSupabase().from('users').update({ is_premium: 0, premium_until: null }).eq('telegram_id', userId); active = false; }
    }
    premiumCache.set(userId, { active, expiresAt: now + 5 * 60 * 1000 });
    return active;
  },

  async cleanupExpiredPremium() {
    const now = new Date().toISOString();
    const { error } = await getSupabase().from('users').update({ is_premium: 0 }).eq('is_premium', 1).not('premium_until', 'is', null).lte('premium_until', now);
    if (error) logger.error(`cleanupExpiredPremium error: ${error.message}`);
  },

  normalizeTargetChannel(value: string): string {
    let ch = String(value || '').trim();
    if (!ch) return '';
    if (ch.includes('t.me/')) { const parts = ch.split('t.me/'); const h = parts[parts.length - 1].split('/')[0].trim(); if (h) ch = `@${h}`; }
    if (!ch.startsWith('@') && !ch.startsWith('-100') && /^[a-zA-Z0-9_]{5,32}$/.test(ch)) ch = `@${ch}`;
    return ch;
  },
};

const NewsService = {
  isSeen: (id: number, u: string, t: string) => NewsRepository.isSeen(id, u, t),
  isSeenByUrl: (id: number, u: string) => NewsRepository.isSeenByUrl(id, u),
  isSeenByTitle: (id: number, t: string) => NewsRepository.isSeenByTitle(id, t),
  markSeen: (id: number, u: string, t: string) => NewsRepository.markSeen(id, u, t),
  getLastTitles: (id: number, l?: number) => NewsRepository.getLastTitles(id, l),
  getRecentTitles: (l?: number) => NewsRepository.getRecentTitles(l),
  isLikelyDuplicateTitle: (a: string, b: string) => _isLikelyDuplicate(a, b),
  normalizeUrl: _normalizeUrl,
  normalizeTitle: _normalizeTitle,
};

const SourceService = {
  getByUser: (id: number) => SourceRepository.getByUser(id),
  getAll: () => SourceRepository.getAll(),
  add: (id: number, n: string, u: string, l: string) => SourceRepository.add(id, n, u, l),
  remove: (id: number, s: number) => SourceRepository.remove(id, s),
};

const ApiKeyService = {
  add: (id: number, k: string, t: string) => ApiKeyRepository.add(id, k, t),
  remove: (id: number, k: string) => ApiKeyRepository.remove(id, k),
  removeById: (id: number) => ApiKeyRepository.removeById(id),
  count: (id: number) => ApiKeyRepository.count(id),
  exists: (k: string) => ApiKeyRepository.exists(k),
  getValid: () => ApiKeyRepository.getValid(),
  getByUser: (id: number) => ApiKeyRepository.getByUser(id),
};

const StatsService = {
  increment: (id: number, f: 'total_posts' | 'total_duplicates') => StatsRepository.increment(id, f),
  get: (id: number) => StatsRepository.get(id),
};

const PriceService = {
  add: (id: number, u: string, n: string, p: number) => PriceRepository.add(id, u, n, p),
  getByUser: (id: number) => PriceRepository.getByUser(id),
  getAll: () => PriceRepository.getAll(),
  updatePrice: (id: number, p: number) => PriceRepository.updatePrice(id, p),
  remove: (id: number, p: number) => PriceRepository.remove(id, p),
};

const SettingsService = {
  get: (k: string) => SettingsRepository.get(k),
  set: (k: string, v: string) => SettingsRepository.set(k, v),
};

const ScheduleService = {
  add: (id: number, t: 'video'|'audio'|'text', c: any, s: string) => ScheduleRepository.add(id, t, c, s),
  cancel: (id: number, s: number) => ScheduleRepository.cancel(id, s),
  getPending: () => ScheduleRepository.getPending(),
  getByUser: (id: number) => ScheduleRepository.getByUser(id),
  markSent: (id: number) => ScheduleRepository.markSent(id),
  updateStatus: (id: number, s: string) => ScheduleRepository.updateStatus(id, s),
};

const CryptoPaymentService = {
  create: (payment: CryptoPaymentRecord) => CryptoPaymentRepository.create(payment),
  getById: (id: string) => CryptoPaymentRepository.getById(id),
  updateStatus: (id: string, status: CryptoPaymentRecord['status']) => CryptoPaymentRepository.updateStatus(id, status),
  getWalletClaimByTelegramId: (telegramId: number) => CryptoPaymentRepository.getWalletClaimByTelegramId(telegramId),
  getWalletClaimByAddress: (walletAddress: string) => CryptoPaymentRepository.getWalletClaimByAddress(walletAddress),
  createWalletClaim: (record: WalletClaimRecord) => CryptoPaymentRepository.createWalletClaim(record),
  deleteWalletClaim: (telegramId: number) => CryptoPaymentRepository.deleteWalletClaim(telegramId),
};

const MonitorService = {
  getByUser: (id: number) => MonitorRepository.getByUser(id),
  add: (id: number, p: string, c: string, n: string, o?: any) => MonitorRepository.add(id, p, c, n, o),
  updateSettings: (id: number, u: number, up: any) => MonitorRepository.updateSettings(id, u, up),
  remove: (id: number, ch: number) => MonitorRepository.remove(id, ch),
  getAll: () => MonitorRepository.getAll(),
  updateLastPost: (id: number, l: string) => MonitorRepository.updateLastPost(id, l),
};

const TelegramMessageService = {
  isSeen: (id: number, c: string, m: number) => TelegramMessageRepository.isSeen(id, c, m),
  markSeen: (id: number, c: string, m: number) => TelegramMessageRepository.markSeen(id, c, m),
};

const TrendsService = {
  saveSnapshot: (t: any[], s: string) => TrendsRepository.saveSnapshot(t, s),
  getLatest: () => TrendsRepository.getLatest(),
};

const ReferralService = {
  has: (id: number) => ReferralRepository.has(id),
  create: (r: number, d: number) => ReferralRepository.create(r, d),
  getStats: (id: number) => ReferralRepository.getStats(id),
  checkAndMarkActive: (id: number) => ReferralRepository.checkAndMarkActive(id),
  givePremium: (id: number) => ReferralRepository.givePremium(id),
};

const WorkspaceService = {
  getByUser: (id: number) => WorkspaceRepository.getByUser(id),
  create: (id: number, n: string) => WorkspaceRepository.create(id, n),
  getChannels: (id: number) => WorkspaceRepository.getChannels(id),
  addChannel: (w: number, c: string, n: string) => WorkspaceRepository.addChannel(w, c, n),
  removeChannel: (c: string, w: number) => WorkspaceRepository.removeChannel(c, w),
  getMembers: (w: number) => WorkspaceRepository.getMembers(w),
  addMember: (w: number, u: number, r: string) => WorkspaceRepository.addMember(w, u, r),
  removeMember: (w: number, u: number) => WorkspaceRepository.removeMember(w, u),
  updateMemberRole: (w: number, u: number, r: string) => WorkspaceRepository.updateMemberRole(w, u, r),
};

const RuleService = {
  getByUser: (id: number) => RuleRepository.getByUser(id),
  add: (id: number, tr: string, co: string, ac: string, av: string) => RuleRepository.add(id, tr, co, ac, av),
  toggle: (id: number, a: boolean) => RuleRepository.toggle(id, a),
  delete: (id: number) => RuleRepository.delete(id),
};

const TicketService = {
  create: (id: number, s: string, m: string) => TicketRepository.create(id, s, m),
  getByUser: (id: number) => TicketRepository.getByUser(id),
  getAll: () => TicketRepository.getAll(),
  updateStatus: (id: number, s: string) => TicketRepository.updateStatus(id, s),
};

const DraftService = {
  save: (id: number, d: any) => DraftRepository.save(id, d),
  getByUser: (id: number) => DraftRepository.getByUser(id),
};

const WebUserService = {
  getByEmail: (email: string) => WebUserRepository.getByEmail(email),
  list: () => WebUserRepository.list(),
  create: (record: { telegram_id: number; email: string; password_hash: string; salt: string; approved: boolean }) => WebUserRepository.create(record),
};

// ── Public API ──────────────────────────────────────────────

export const DBService = {
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
  getSupabase,
  isLikelyDuplicateTitle: (a: string, b: string) => NewsService.isLikelyDuplicateTitle(a, b),
  normalizeNewsUrl: (u: string) => NewsService.normalizeUrl(u),
  normalizeNewsTitle: (t: string) => NewsService.normalizeTitle(t),

  // ── User (legacy flat methods) ──
  getUser: (id: number) => UserService.get(id),
  getAllUsers: () => UserService.getAll(),
  getActiveUsers: () => UserService.getActive(),
  upsertUser: (id: number, o?: number, u?: string, f?: string) => UserService.upsert(id, o, u, f),
  updateUser: (id: number, u: Record<string, any>) => UserService.update(id, u),
  getUserByReferralCode: (c: string) => UserService.getByReferralCode(c),
  getUsersForAdmin: () => UserService.getForAdmin(),
  getUserOutputChannels: (u: any) => UserService.outputChannels(u),
  getAllUserChannels: (u: any) => UserService.getAllUserChannels(u),
  getWebUserByEmail: (email: string) => WebUserService.getByEmail(email),
  getWebUsers: () => WebUserService.list(),
  createWebUser: (record: { telegram_id: number; email: string; password_hash: string; salt: string; approved: boolean }) => WebUserService.create(record),
  setExtraChannels: (userId: number, channels: string[]) => UserService.setExtraChannels(userId, channels),
  ensureReferralCode: (userId: number) => UserService.ensureReferralCode(userId),
  isPremiumActive: (userId: number) => UserService.isPremiumActive(userId),
  cleanupExpiredPremium: () => UserService.cleanupExpiredPremium(),
  normalizeTargetChannel: (value: string) => UserService.normalizeTargetChannel(value),

  // ── Source (legacy flat methods) ──
  getUserSources: (id: number) => SourceService.getByUser(id),
  getAllSources: () => SourceService.getAll(),
  addSource: (id: number, n: string, u: string, l: string) => SourceService.add(id, n, u, l),
  removeSource: (id: number, s: number) => SourceService.remove(id, s),

  // ── News (legacy flat methods) ──
  isSeenOrSeenByTitle: (id: number, u: string, t: string) => NewsService.isSeen(id, u, t),
  isSeen: (id: number, u: string) => NewsService.isSeenByUrl(id, u),
  isSeenByTitle: (id: number, t: string) => NewsService.isSeenByTitle(id, t),
  markSeen: (id: number, u: string, t: string) => NewsService.markSeen(id, u, t),
  getLastTitles: (id: number, l?: number) => NewsService.getLastTitles(id, l),
  getRecentNewsTitles: (l?: number) => NewsService.getRecentTitles(l),

  // ── API Keys (legacy flat methods) ──
  addApiKey: (id: number, k: string, t: string) => ApiKeyService.add(id, k, t),
  removeApiKey: (id: number, k: string) => ApiKeyService.remove(id, k),
  removeApiKeyById: (id: number) => ApiKeyService.removeById(id),
  getUserApiKeyCount: (id: number) => ApiKeyService.count(id),
  isKeyExists: (k: string) => ApiKeyService.exists(k),
  getValidApiKeys: () => ApiKeyService.getValid(),
  getUserApiKeys: (id: number) => ApiKeyService.getByUser(id),

  // ── Stats (legacy flat methods) ──
  incrementStat: (id: number, f: 'total_posts' | 'total_duplicates') => StatsService.increment(id, f),
  getStats: (id: number) => StatsService.get(id),

  // ── Price Tracker (legacy flat methods) ──
  addTrackedPrice: (id: number, u: string, n: string, p: number) => PriceService.add(id, u, n, p),
  getTrackedPrices: (id: number) => PriceService.getByUser(id),
  getAllTrackedPrices: () => PriceService.getAll(),
  updatePrice: (id: number, p: number) => PriceService.updatePrice(id, p),
  removePrice: (id: number, p: number) => PriceService.remove(id, p),

  // ── Settings (legacy flat methods) ──
  getSetting: (k: string) => SettingsService.get(k),
  setSetting: (k: string, v: string) => SettingsService.set(k, v),

  // ── Scheduled Posts (legacy flat methods) ──
  addScheduledPost: (id: number, t: 'video'|'audio'|'text', c: any, s: string) => ScheduleService.add(id, t, c, s),
  cancelScheduledPost: (id: number, s: number) => ScheduleService.cancel(id, s),
  getPendingScheduledPosts: () => ScheduleService.getPending(),
  getUserScheduledPosts: (id: number) => ScheduleService.getByUser(id),
  markScheduledPostSent: (id: number) => ScheduleService.markSent(id),
  updateScheduledPostStatus: (id: number, s: string) => ScheduleService.updateStatus(id, s),
  createCryptoPayment: (payment: CryptoPaymentRecord) => CryptoPaymentService.create(payment),
  getCryptoPayment: (id: string) => CryptoPaymentService.getById(id),
  updateCryptoPaymentStatus: (id: string, status: CryptoPaymentRecord['status']) => CryptoPaymentService.updateStatus(id, status),
  getWalletClaimByTelegramId: (telegramId: number) => CryptoPaymentService.getWalletClaimByTelegramId(telegramId),
  getWalletClaimByAddress: (walletAddress: string) => CryptoPaymentService.getWalletClaimByAddress(walletAddress),
  createWalletClaim: (record: WalletClaimRecord) => CryptoPaymentService.createWalletClaim(record),
  deleteWalletClaim: (telegramId: number) => CryptoPaymentService.deleteWalletClaim(telegramId),

  // ── Monitored Channels (legacy flat methods) ──
  getUserMonitoredChannels: (id: number) => MonitorService.getByUser(id),
  addMonitoredChannel: (id: number, p: string, c: string, n: string, o?: any) => MonitorService.add(id, p, c, n, o),
  updateMonitoredChannelSettings: (id: number, u: number, up: any) => MonitorService.updateSettings(id, u, up),
  removeMonitoredChannel: (id: number, ch: number) => MonitorService.remove(id, ch),
  getMonitoredChannels: () => MonitorService.getAll(),
  updateMonitoredChannel: (id: number, l: string) => MonitorService.updateLastPost(id, l),

  // ── Telegram Messages (legacy flat methods) ──
  isTelegramMessageSeen: (id: number, c: string, m: number) => TelegramMessageService.isSeen(id, c, m),
  markTelegramMessageSeen: (id: number, c: string, m: number) => TelegramMessageService.markSeen(id, c, m),

  // ── Trends (legacy flat methods) ──
  saveTrendsSnapshot: (t: any[], s: string) => TrendsService.saveSnapshot(t, s),
  getLatestTrendsSnapshot: () => TrendsService.getLatest(),

  // ── Referrals (legacy flat methods) ──
  hasReferral: (id: number) => ReferralService.has(id),
  createReferral: (r: number, d: number) => ReferralService.create(r, d),
  getReferralStats: (id: number) => ReferralService.getStats(id),
  checkAndMarkReferralActive: (id: number) => ReferralService.checkAndMarkActive(id),
  checkAndGivePremium: (id: number) => ReferralService.givePremium(id),

  // ── Workspaces (legacy flat methods) ──
  getUserWorkspaces: (id: number) => WorkspaceService.getByUser(id),
  createWorkspace: (id: number, n: string) => WorkspaceService.create(id, n),
  getWorkspaceChannels: (id: number) => WorkspaceService.getChannels(id),
  addWorkspaceChannel: (w: number, c: string, n: string) => WorkspaceService.addChannel(w, c, n),
  removeWorkspaceChannel: (c: string, w: number) => WorkspaceService.removeChannel(c, w),
  getWorkspaceMembers: (w: number) => WorkspaceService.getMembers(w),
  addWorkspaceMember: (w: number, u: number, r: string) => WorkspaceService.addMember(w, u, r),
  removeWorkspaceMember: (w: number, u: number) => WorkspaceService.removeMember(w, u),
  updateWorkspaceMemberRole: (w: number, u: number, r: string) => WorkspaceService.updateMemberRole(w, u, r),

  // ── Rules (legacy flat methods) ──
  getUserRules: (id: number) => RuleService.getByUser(id),
  addRule: (id: number, tr: string, co: string, ac: string, av: string) => RuleService.add(id, tr, co, ac, av),
  toggleRule: (id: number, a: boolean) => RuleService.toggle(id, a),
  deleteRule: (id: number) => RuleService.delete(id),

  // ── Tickets (legacy flat methods) ──
  createTicket: (id: number, s: string, m: string) => TicketService.create(id, s, m),
  getUserTickets: (id: number) => TicketService.getByUser(id),
  getTickets: () => TicketService.getAll(),
  updateTicketStatus: (id: number, s: string) => TicketService.updateStatus(id, s),

  // ── Drafts (legacy flat methods) ──
  savePostDraft: (id: number, d: any) => DraftService.save(id, d),
  getUserPostDrafts: (id: number) => DraftService.getByUser(id),

  // ── Embeddings ──
  async findSimilarNews(userId: number, embedding: number[], threshold: number = 0.9) {
    const { data, error } = await getSupabase().rpc('match_news', { query_embedding: embedding, match_threshold: threshold, p_user_id: userId });
    if (error) {
      if (error.message.includes('function match_news') && error.message.includes('does not exist')) {
        logger.warn('Supabase SQL migration (match_news) hali bajarilmagan.');
      } else logger.error(`findSimilarNews error: ${error.message}`);
      return null;
    }
    return data && data.length > 0 ? data[0] : null;
  },

  async saveEmbedding(userId: number, contentHash: string, embedding: number[]) {
    const { error } = await getSupabase().from('news_embeddings').insert({ user_id: userId, content_hash: contentHash, embedding });
    if (error) logger.error(`saveEmbedding error: ${error.message}`);
  },

  async cleanupOldEmbeddings(days: number = 7) {
    const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    await getSupabase().from('news_embeddings').delete().lt('created_at', date);
  },

  // ── In-Memory helpers ──
  tryReserveUserSendSlot(userId: number, intervalMinutes: number): boolean {
    const now = Date.now();
    const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
    const lockedUntil = userSendSlots.get(userId) || 0;
    if (lockedUntil > now) return false;
    userSendSlots.set(userId, now + intervalMs);
    return true;
  },

  releaseUserSendSlot(userId: number) { userSendSlots.delete(userId); },

  acquireRecentNewsLock(userId: number, url: string, title: string, ttlMs = 12 * 60 * 60 * 1000): boolean {
    const now = Date.now();
    for (const [key, expiry] of recentNewsLocks.entries()) { if (expiry <= now) recentNewsLocks.delete(key); }
    const normalizedUrl = NewsService.normalizeUrl(url);
    const normalizedTitle = NewsService.normalizeTitle(title);
    const urlKey = `${userId}:url:${normalizedUrl}`;
    const titleKey = normalizedTitle ? `${userId}:title:${normalizedTitle}` : '';
    const urlExisting = recentNewsLocks.get(urlKey);
    if (urlExisting && urlExisting > now) return false;
    if (titleKey) {
      const titleExisting = recentNewsLocks.get(titleKey);
      if (titleExisting && titleExisting > now) return false;
      recentNewsLocks.set(titleKey, now + ttlMs);
    }
    recentNewsLocks.set(urlKey, now + ttlMs);
    return true;
  },

  // ── User composite helpers ──
  async setKeywords(userId: number, keywords: string) {
    await getSupabase().from('users').update({ keywords: keywords.slice(0, 1000) }).eq('telegram_id', userId);
  },

  async getKeywords(userId: number): Promise<string[]> {
    const user = await UserRepository.get(userId);
    if (!user?.keywords || user.keywords.trim() === '') return [];
    return user.keywords.split(',').map((k: string) => k.trim().toLowerCase()).filter((k: string) => k.length > 0);
  },

  async setScheduleTimes(userId: number, times: string) {
    await getSupabase().from('users').update({ schedule_times: times }).eq('telegram_id', userId);
  },

  async setDailyDigest(userId: number, enabled: boolean, time: string) {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (match) { const h = parseInt(match[1]); const m = parseInt(match[2]); if (h < 0 || h > 23 || m < 0 || m > 59) time = '20:00'; }
    else time = '20:00';
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
    const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + days);
    await getSupabase().from('users').update({ is_premium: 1, premium_until: expiresAt.toISOString() }).eq('telegram_id', telegramId);
    premiumCache.set(telegramId, { active: true, expiresAt: Date.now() + 5 * 60 * 1000 });
  },

  async revokePremium(telegramId: number) {
    await getSupabase().from('users').update({ is_premium: 0, premium_until: null }).eq('telegram_id', telegramId);
    premiumCache.set(telegramId, { active: false, expiresAt: Date.now() + 5 * 60 * 1000 });
  },

  async setPrice(type: string, price: number) { await SettingsRepository.set(`price_${type}`, price.toString()); },

  async getPrice(type: string): Promise<number> {
    const val = await SettingsRepository.get(`price_${type}`);
    const numeric = val ? parseInt(val) : NaN;
    return isNaN(numeric) ? (type === 'monthly' ? 25000 : 250000) : numeric;
  },

  async checkUserLimit(userId: number, limitType: 'sources' | 'channels' | 'scheduled'): Promise<boolean> {
    const user = await UserRepository.get(userId);
    if (user && (user.role === 'owner' || user.role === 'admin' || user.is_owner === 1)) return true;
    const isPremium = await this.isPremiumActive(userId);
    if (isPremium) {
      if (limitType === 'sources') { const s = await SourceRepository.getByUser(userId); return s.length < 10; }
      return true;
    }
    if (limitType === 'sources') {
      const s = await SourceRepository.getByUser(userId);
      const apiKeyCount = await ApiKeyRepository.count(userId);
      return s.length < 1 + Math.min(apiKeyCount, 3);
    }
    if (limitType === 'channels') {
      const ch = await MonitorRepository.getByUser(userId);
      return ch.length < 3;
    }
    if (limitType === 'scheduled') {
      const { count } = await getSupabase().from('scheduled_posts').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending');
      return (count || 0) < 3;
    }
    return true;
  },

  async updateUserRole(telegramId: number, role: string) {
    const updates: Record<string, any> = { role };
    if (role === 'owner') { updates.is_owner = 1; updates.is_approved = 1; }
    else updates.is_owner = 0;
    const { error } = await getSupabase().from('users').update(updates).eq('telegram_id', telegramId);
    if (error) { logger.warn(`updateUserRole warning: ${error.message}`); return false; }
    premiumCache.delete(telegramId);
    if (role === 'premium') await this.setPremium(telegramId, 30);
    else if (role === 'user') await this.revokePremium(telegramId);
    return true;
  },

  async getRecentTitlesForChannel(channelId: string): Promise<any[]> {
    const { data, error } = await getSupabase().from('processed_news').select('title').eq('target_channel', channelId).order('created_at', { ascending: false }).limit(10);
    if (error) return [];
    return data || [];
  },
};
