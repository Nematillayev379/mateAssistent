"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDashboardServer = startDashboardServer;
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const logger_1 = require("../utils/logger");
const database_1 = require("./database");
const config_1 = require("../config/config");
const bot_instance_1 = require("./bot_instance");
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const music_1 = require("./music");
const payment_1 = require("./payment");
const ai_1 = require("./ai");
const config_2 = require("../config/config");
const scraper_1 = require("./scraper");
const finance_1 = require("./finance");
const telegram_monitor_1 = require("./telegram_monitor");
const trends_1 = require("./trends");
const ai_2 = require("./ai");
const telegram_1 = require("./telegram");
const child_process_1 = require("child_process");
const util_1 = require("util");
// B-51 Fix: Add proper type for bot parameter
function startDashboardServer(port, _bot) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // B-21 Fix: Add CORS middleware manually
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-bot-token, x-user-id');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    });
    // B-20 Fix: Use process.cwd() instead of __dirname for tsx compatibility
    app.use(express_1.default.static(path_1.default.join(process.cwd(), 'public'), {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        }
    }));
    app.get('/tonconnect-manifest.json', (req, res) => {
        const publicBase = config_1.CONFIG.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
        res.json({
            url: publicBase,
            name: 'mateAssistent',
            iconUrl: `${publicBase}/tonconnect-icon.svg`,
            termsOfUseUrl: `${publicBase}/dashboard`,
            privacyPolicyUrl: `${publicBase}/dashboard`,
        });
    });
    // BUG-154 Fix: Rate limiting on API endpoints
    const apiLimiter = (0, express_rate_limit_1.default)({
        windowMs: 60 * 1000, // 1 minute
        max: 60, // 60 requests per minute
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests, please try again later.' },
        // BUG-102 Fix: Exclude webhook from rate limiting
        skip: (req) => req.path === '/api/bot/webhook'
    });
    app.use('/api/', apiLimiter);
    // Extra rate limit for AI endpoint
    const aiLimiter = (0, express_rate_limit_1.default)({
        windowMs: 60 * 1000,
        max: async (req) => {
            const userId = req.headers['x-user-id'] || req.query.userId || req.query.user || req.body?.userId;
            if (userId) {
                const isPremium = await database_1.DBService.isPremiumActive(parseInt(userId));
                return isPremium ? 30 : 10;
            }
            return 10;
        },
        message: { error: 'AI request limit exceeded.' }
    });
    app.get('/health', (req, res) => res.json({ status: 'ok', bot: 'active', uptime: process.uptime() }));
    app.post('/api/bot/webhook', (0, express_rate_limit_1.default)({ windowMs: 1000, max: 100, keyGenerator: () => 'webhook' }), async (req, res) => {
        const secret = req.headers['x-telegram-bot-api-secret-token'];
        if (secret !== config_1.CONFIG.WEBHOOK_SECRET)
            return res.sendStatus(403);
        if (!req.body)
            return res.sendStatus(400);
        try {
            await bot_instance_1.bot.processUpdate(req.body);
            res.sendStatus(200);
        }
        catch (e) {
            logger_1.logger.warn(`Webhook process error: ${e.message}`);
            res.sendStatus(500);
        }
    });
    // BUG-055/056 Fix: Unified auth with consistent userId extraction
    const extractUserId = (req) => {
        return String(req.headers['x-user-id'] ||
            req.params.userId ||
            req.query.userId ||
            req.query.user ||
            req.body?.userId ||
            '');
    };
    const timingSafeCompare = (str1, str2) => {
        if (!str1 || !str2)
            return false;
        const h1 = crypto_1.default.createHmac('sha256', 'timing-safe-salt').update(str1).digest();
        const h2 = crypto_1.default.createHmac('sha256', 'timing-safe-salt').update(str2).digest();
        return crypto_1.default.timingSafeEqual(h1, h2);
    };
    const checkAuth = (req, res, next) => {
        const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
        if (!token)
            return res.status(401).json({ error: 'Unauthorized' });
        if (token && config_1.CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, config_1.CONFIG.DASHBOARD_SECRET)) {
            if (config_1.CONFIG.OWNER_ID == null) {
                return res.status(500).json({ error: 'Owner ID not configured' });
            }
            req.authenticatedUserId = String(config_1.CONFIG.OWNER_ID);
            return next();
        }
        const userId = extractUserId(req);
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        if (token !== (0, bot_instance_1.generateDashboardToken)(userId)) {
            return res.status(401).json({ error: 'Invalid token for this user' });
        }
        req.authenticatedUserId = userId;
        // Auto-sync owner role for webapp users
        if ((0, config_1.isOwnerId)(parseInt(userId))) {
            database_1.DBService.getUser(parseInt(userId)).then((user) => {
                if (user && user.role !== 'owner') {
                    database_1.DBService.updateUserRole(parseInt(userId), 'owner');
                }
            }).catch((e) => logger_1.logger.warn(`Owner role sync failed: ${e.message}`));
        }
        next();
    };
    // WebApp InitData Verification
    const verifyTelegramWebAppData = (telegramInitData) => {
        try {
            const initData = new URLSearchParams(telegramInitData);
            const hash = initData.get('hash');
            if (!hash) {
                logger_1.logger.warn('Telegram auth failed: hash is missing');
                return null;
            }
            const authDate = initData.get('auth_date');
            if (!authDate) {
                logger_1.logger.warn('Telegram auth failed: auth_date is missing');
                return null;
            }
            const authTs = parseInt(authDate, 10);
            if (isNaN(authTs)) {
                logger_1.logger.warn(`Telegram auth failed: auth_date "${authDate}" is not a number`);
                return null;
            }
            const timeDiff = Math.abs(Date.now() / 1000 - authTs);
            // Relax window to 30 days to handle cached client data and drifted system clocks
            if (timeDiff > 86400 * 30) {
                logger_1.logger.warn(`Telegram auth failed: auth_date age ${timeDiff}s exceeds 30 days limit`);
                return null;
            }
            initData.delete('hash');
            const keys = Array.from(initData.keys()).sort();
            const dataCheckString = keys.map(key => `${key}=${initData.get(key)}`).join('\n');
            const secretKey = crypto_1.default.createHmac('sha256', 'WebAppData').update((config_1.CONFIG.TELEGRAM_TOKEN || '').trim()).digest();
            const calculatedHash = crypto_1.default.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
            if (calculatedHash === hash) {
                const userStr = initData.get('user');
                return userStr ? JSON.parse(userStr) : null;
            }
            else {
                logger_1.logger.warn(`Telegram auth failed: hash mismatch. Calculated: ${calculatedHash}, received: ${hash}`);
                return null;
            }
        }
        catch (e) {
            logger_1.logger.error(`Telegram auth exception: ${e.message}`);
            return null;
        }
    };
    app.post('/api/auth/telegram', async (req, res) => {
        const { initData } = req.body;
        if (!initData)
            return res.status(400).json({ error: 'Missing initData' });
        const tgUser = verifyTelegramWebAppData(initData);
        if (!tgUser || !tgUser.id)
            return res.status(401).json({ error: 'Invalid Telegram data' });
        let user = await database_1.DBService.getUser(tgUser.id);
        if (!user) {
            user = await database_1.DBService.upsertUser(tgUser.id, (0, config_1.isOwnerId)(tgUser.id) ? 1 : 0, tgUser.username, tgUser.first_name);
            if (!user)
                return res.status(500).json({ error: 'User not found and creation failed' });
        }
        // Sync env owner to DB role (same as /start) so WebApp shows admin panel
        if ((0, config_1.isOwnerId)(tgUser.id) && user.role !== 'owner') {
            await database_1.DBService.updateUserRole(tgUser.id, 'owner');
            user.role = 'owner';
        }
        const token = (0, bot_instance_1.generateDashboardToken)(tgUser.id);
        res.json({ token, userId: tgUser.id, role: user.role || 'user' });
    });
    app.post('/api/auth/master', async (req, res) => {
        const { token } = req.body;
        if (token && config_1.CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, config_1.CONFIG.DASHBOARD_SECRET)) {
            if (config_1.CONFIG.OWNER_ID == null) {
                return res.status(500).json({ error: 'Owner ID not configured' });
            }
            const ownerId = config_1.CONFIG.OWNER_ID;
            let user = await database_1.DBService.getUser(ownerId);
            if (!user) {
                user = await database_1.DBService.upsertUser(ownerId, 1, 'Owner', 'Owner');
            }
            if (user && user.role !== 'owner') {
                await database_1.DBService.updateUserRole(ownerId, 'owner');
                user.role = 'owner';
            }
            res.json({ token, userId: ownerId, role: user?.role || 'owner' });
        }
        else {
            // BUG-H4: Add a 1.5s delay to prevent master brute-force attacks
            await new Promise(resolve => setTimeout(resolve, 1500));
            res.status(401).json({ error: 'Invalid master token' });
        }
    });
    // BUG-056 Fix: Same userId extraction order as checkAuth
    const checkAdmin = async (req, res, next) => {
        const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
        const adminId = extractUserId(req);
        if (token && config_1.CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, config_1.CONFIG.DASHBOARD_SECRET)) {
            if (config_1.CONFIG.OWNER_ID == null) {
                return res.status(500).json({ error: 'Owner ID not configured' });
            }
            req.authenticatedUserId = String(config_1.CONFIG.OWNER_ID);
            return next();
        }
        if (!adminId || !token)
            return res.status(401).json({ error: 'Unauthorized' });
        if (token !== (0, bot_instance_1.generateDashboardToken)(adminId))
            return res.status(401).json({ error: 'Invalid admin token' });
        const adminUid = parseInt(adminId);
        const user = await database_1.DBService.getUser(adminUid);
        const isAdmin = user && (user.role === 'owner' || user.role === 'admin' ||
            user.is_owner === 1 || (0, config_1.isOwnerId)(adminUid));
        if (!isAdmin)
            return res.status(403).json({ error: 'Forbidden: Admin access only' });
        req.authenticatedUserId = adminId;
        next();
    };
    // --- API ---
    app.get('/api/dashboard-info', checkAuth, async (req, res) => {
        // BUG-123/BUG-083 Fix: Use authenticatedUserId
        const userId = parseInt(req.authenticatedUserId);
        const user = await database_1.DBService.getUser(userId);
        if (!user)
            return res.status(404).json({ error: 'Not found' });
        const effectiveRole = user.role || (user.is_owner ? 'owner' : 'user');
        res.json({
            user: {
                id: user.telegram_id,
                telegram_id: user.telegram_id,
                username: user.username,
                first_name: user.first_name,
                role: effectiveRole,
                is_owner: !!user.is_owner,
                is_premium: !!user.is_premium,
                is_approved: !!user.is_approved,
                is_active: user.is_active !== 0,
                target_channel: user.target_channel || null,
                language: user.language || 'uz',
                premium_until: user.premium_until || null
            },
            stats: await database_1.DBService.getStats(userId),
            scheduled: await database_1.DBService.getUserScheduledPosts(userId),
            referrals: await database_1.DBService.getReferralStats(userId),
            tickets: (user.role === 'owner' || user.role === 'admin') ? await database_1.DBService.getTickets() : await database_1.DBService.getUserTickets(userId)
        });
    });
    app.get('/api/user/:userId', checkAuth, async (req, res) => {
        // BUG-123/BUG-083 Fix: Use authenticatedUserId to prevent IDOR
        const u = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
        res.json(u ? { ...u, api_key_count: await database_1.DBService.getUserApiKeyCount(u.telegram_id) } : { error: 'Not found' });
    });
    app.get('/api/sources/:userId', checkAuth, async (req, res) => {
        // BUG-124/BUG-084 Fix: Use authenticatedUserId
        res.json(await database_1.DBService.getUserSources(parseInt(req.authenticatedUserId)));
    });
    // BUG-058 Fix: Admin limit calculation included
    app.post('/api/sources/:userId', checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { name, url, lang } = req.body;
        if (!url || typeof url !== 'string' || !url.startsWith('http'))
            return res.status(400).json({ error: 'Invalid URL' });
        if (!(await scraper_1.ScraperService.isPublicExternalUrl(url))) {
            return res.status(400).json({ error: 'Private URLs not allowed' });
        }
        const discovered = await scraper_1.ScraperService.discoverRSS(url);
        // BUG-024 Fix: Better error message for RSS discovery failure
        if (!discovered)
            return res.status(400).json({ error: 'URL yaroqli RSS/Atom formatida emas yoki server bloklagan.' });
        const user = await database_1.DBService.getUser(uid);
        if (!user)
            return res.status(404).json({ error: 'Not found' });
        const sources = await database_1.DBService.getUserSources(uid);
        if (!(await database_1.DBService.checkUserLimit(uid, 'sources')))
            return res.status(403).json({ error: 'Limit reached' });
        await database_1.DBService.addSource(uid, name, discovered, lang || 'uz');
        res.json({ success: true });
    });
    app.delete('/api/sources/:userId/:id', checkAuth, async (req, res) => {
        // BUG-H3: IDOR Prevention Validation
        const sourceId = parseInt(req.params.id);
        if (!sourceId || sourceId <= 0 || isNaN(sourceId)) {
            return res.status(400).json({ error: 'Invalid ID' });
        }
        await database_1.DBService.removeSource(parseInt(req.authenticatedUserId), sourceId);
        res.json({ success: true });
    });
    app.post('/api/settings/:userId/toggle', checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const u = await database_1.DBService.getUser(uid);
        if (!u)
            return res.status(404).json({ error: 'Not found' });
        const next = u.is_active ? 0 : 1;
        await database_1.DBService.updateUser(uid, { is_active: next });
        res.json({ success: true, is_active: next });
    });
    app.get('/api/settings/:userId', checkAuth, async (req, res) => {
        const u = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
        if (!u)
            return res.status(404).json({ error: 'Not found' });
        res.json({
            language: u.language,
            target_channel: u.target_channel,
            is_active: u.is_active,
            is_premium: u.is_premium
        });
    });
    app.post('/api/settings/:userId', checkAuth, async (req, res) => {
        const { language, target_channel } = req.body;
        const userId = parseInt(req.authenticatedUserId);
        if (typeof target_channel === 'string' && target_channel.trim()) {
            const normalized = database_1.DBService.normalizeTargetChannel(target_channel);
            if (!normalized.startsWith('@') && !normalized.startsWith('-100')) {
                return res.status(400).json({ error: 'Invalid target channel format' });
            }
            try {
                const chat = await bot_instance_1.bot.getChat(normalized);
                const me = await bot_instance_1.bot.getMe();
                const member = await bot_instance_1.bot.getChatMember(chat.id, me.id);
                if (member.status !== 'administrator' && member.status !== 'creator') {
                    return res.status(400).json({ error: 'Bot target kanalda admin emas' });
                }
            }
            catch (e) {
                return res.status(400).json({ error: e.message || 'Channel verification failed' });
            }
        }
        const ok = await database_1.DBService.updateUser(userId, { language, target_channel });
        if (!ok)
            return res.status(500).json({ error: 'Settings update failed' });
        res.json({ success: true });
    });
    // --- ADMIN ENDPOINTS ---
    app.get('/api/admin/users', checkAdmin, async (req, res) => {
        const users = await database_1.DBService.getAllUsers();
        // Add additional info like source counts for the dashboard
        for (const u of users) {
            u.sources = await database_1.DBService.getUserSources(u.telegram_id);
        }
        res.json(users);
    });
    app.get('/api/admin/sources', checkAdmin, async (req, res) => {
        res.json(await database_1.DBService.getAllSources());
    });
    app.get('/api/admin/settings', checkAdmin, async (req, res) => {
        const starsPrice = await database_1.DBService.getSetting('premium_stars_price') || '500';
        const monthlyPrice = await database_1.DBService.getPrice('monthly');
        const yearlyPrice = await database_1.DBService.getPrice('yearly');
        res.json({
            premium_stars_price: starsPrice,
            price_monthly: monthlyPrice,
            price_yearly: yearlyPrice
        });
    });
    app.post('/api/admin/settings', checkAdmin, async (req, res) => {
        const { premium_stars_price, price_monthly, price_yearly } = req.body;
        if (premium_stars_price)
            await database_1.DBService.setSetting('premium_stars_price', String(premium_stars_price));
        if (price_monthly)
            await database_1.DBService.setPrice('monthly', Number(price_monthly));
        if (price_yearly)
            await database_1.DBService.setPrice('yearly', Number(price_yearly));
        res.json({ success: true });
    });
    app.post('/api/admin/users/:telegramId/role', checkAdmin, async (req, res) => {
        const role = req.body.role;
        if (!['owner', 'admin', 'user', 'premium'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        const callerId = parseInt(req.authenticatedUserId);
        const callerIsOwner = (0, config_1.isOwnerId)(callerId);
        // Only the real owner can promote someone to admin or owner
        if ((role === 'owner' || role === 'admin') && !callerIsOwner) {
            return res.status(403).json({ error: 'Faqat Owner boshqalarni admin qila oladi' });
        }
        // Never allow assigning 'owner' role via API, it should only be defined via env
        if (role === 'owner') {
            return res.status(403).json({ error: 'Owner rolini API orqali berish taqiqlangan' });
        }
        await database_1.DBService.updateUserRole(parseInt(req.params.telegramId), role);
        res.json({ success: true });
    });
    app.get('/api/admin/prices', checkAdmin, async (req, res) => res.json({
        monthly: await database_1.DBService.getPrice('monthly'),
        yearly: await database_1.DBService.getPrice('yearly'),
        stars: await database_1.DBService.getSetting('premium_stars_price') || '500'
    }));
    app.post('/api/admin/users/:telegramId/premium', checkAdmin, async (req, res) => {
        const days = parseInt(req.body.days);
        if (isNaN(days) || days < 0)
            return res.status(400).json({ error: 'Invalid days' });
        if (days > 0) {
            await database_1.DBService.setPremium(parseInt(req.params.telegramId), days);
        }
        else {
            await database_1.DBService.revokePremium(parseInt(req.params.telegramId));
        }
        res.json({ success: true });
    });
    app.post('/api/admin/users/:telegramId/approve', checkAdmin, async (req, res) => {
        await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 1 });
        res.json({ success: true });
    });
    app.post('/api/admin/users/:telegramId/block', checkAdmin, async (req, res) => {
        await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_active: 0 });
        res.json({ success: true });
    });
    app.post('/api/admin/users/:telegramId/unblock', checkAdmin, async (req, res) => {
        await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_active: 1 });
        res.json({ success: true });
    });
    app.post('/api/admin/users/:telegramId/reject', checkAdmin, async (req, res) => {
        await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 0 });
        res.json({ success: true });
    });
    app.get('/api/payments/methods', checkAuth, async (_req, res) => {
        res.json(payment_1.PaymentService.getAvailableMethods());
    });
    // BUG-059 Fix: Actually ping Redis to check connection
    app.get('/api/admin/system', checkAdmin, async (req, res) => {
        let redisStatus = false;
        try {
            const redis = await (await Promise.resolve().then(() => __importStar(require('../services/redis')))).getRedisConnection();
            if (redis) {
                await redis.ping();
                redisStatus = true;
            }
        }
        catch { }
        const envPool = (0, config_2.buildKeyPoolFromEnv)();
        const active = (0, ai_1.getActiveKeyStats)();
        res.json({
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            redis: redisStatus,
            ownerId: config_1.CONFIG.OWNER_ID,
            nodeVersion: process.version,
            aiKeys: {
                envLoaded: envPool.length,
                activeLoaded: active.total,
                envByProvider: (0, config_2.countKeysByProvider)(envPool),
                activeByProvider: active.byProvider,
                envVarCounts: (0, config_2.getEnvKeySourceReport)(),
            },
        });
    });
    app.post('/api/admin/ai-keys/refresh', checkAdmin, async (_req, res) => {
        await (0, ai_1.refreshKeyPool)();
        res.json({ success: true, ...(0, ai_1.getActiveKeyStats)() });
    });
    // BUG-085 Fix: Admin broadcast rate limit applied via aiLimiter (or custom)
    app.post('/api/admin/broadcast', checkAdmin, aiLimiter, async (req, res) => {
        const { message } = req.body;
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Invalid broadcast message' });
        }
        const users = await database_1.DBService.getAllUsers();
        const queued = users.length;
        setImmediate(async () => {
            let count = 0;
            for (const user of users) {
                try {
                    await bot_instance_1.bot.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' });
                    count++;
                    await new Promise(r => setTimeout(r, 40));
                }
                catch (e) {
                    logger_1.logger.warn(`Broadcast failed for ${user.telegram_id}: ${e.message}`);
                }
            }
            logger_1.logger.info(`Broadcast finished: ${count}/${queued} messages sent.`);
        });
        res.status(202).json({ success: true, queued });
    });
    app.get('/api/music/search', checkAuth, async (req, res) => res.json(await music_1.MusicService.getYouTubeVideoIds(req.query.q, 8)));
    const cleanupTempFile = (filePath) => {
        try {
            if (fs_1.default.existsSync(filePath))
                fs_1.default.unlinkSync(filePath);
        }
        catch { }
    };
    const serveFileDownload = async (res, filePath, filename, opts) => {
        if (opts?.notifyBot && opts.userId) {
            try {
                if (opts.notifyBot === 'video') {
                    await bot_instance_1.bot.sendVideo(opts.userId, filePath, { caption: '📥 WebApp orqali yuklandi' });
                }
                else {
                    await bot_instance_1.bot.sendAudio(opts.userId, filePath, { caption: '🎵 WebApp orqali yuklandi' });
                }
            }
            catch (e) {
                logger_1.logger.warn(`Bot media send skipped for ${opts.userId}: ${e.message}`);
            }
        }
        res.download(filePath, filename, (err) => {
            cleanupTempFile(filePath);
            if (err && !res.headersSent) {
                res.status(500).json({ error: err.message || 'Download failed' });
            }
        });
    };
    app.get('/api/debug/ytdlp', checkAdmin, async (req, res) => {
        try {
            const { resolveYtDlpPath } = await Promise.resolve().then(() => __importStar(require('../utils/ytdlp')));
            const ytdlpPath = await resolveYtDlpPath();
            const fsExists = ytdlpPath ? fs_1.default.existsSync(ytdlpPath) : false;
            const size = fsExists && ytdlpPath ? fs_1.default.statSync(ytdlpPath).size : 0;
            let version = 'not found';
            let execErr = '';
            let pythonVersion = 'not checked';
            try {
                const execPromise = (0, util_1.promisify)(child_process_1.exec);
                const { stdout } = await execPromise('python3 --version', { timeout: 3000 });
                pythonVersion = stdout.trim();
            }
            catch (e) {
                pythonVersion = `error: ${e.message}`;
            }
            if (ytdlpPath) {
                try {
                    const execPromise = (0, util_1.promisify)(child_process_1.exec);
                    const cmd = ytdlpPath.includes(' ') || ytdlpPath.includes('\\') ? `"${ytdlpPath}"` : ytdlpPath;
                    const { stdout, stderr } = await execPromise(`${cmd} --version`, { timeout: 5000 });
                    version = stdout.trim();
                }
                catch (e) {
                    execErr = `${e.message}\nSTDOUT: ${e.stdout || ''}\nSTDERR: ${e.stderr || ''}`;
                }
            }
            res.json({
                ytdlpPath,
                fsExists,
                size,
                version,
                pythonVersion,
                execErr,
                cwd: process.cwd(),
                __dirname,
                candidates: [
                    path_1.default.join(__dirname, '..', '..', 'yt-dlp'),
                    path_1.default.join(__dirname, '..', '..', 'yt-dlp.exe'),
                    path_1.default.join(process.cwd(), 'yt-dlp'),
                    path_1.default.join(process.cwd(), 'yt-dlp.exe'),
                ].map(p => ({ path: p, exists: fs_1.default.existsSync(p) }))
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/music/download/:id', checkAuth, async (req, res) => {
        const videoId = req.params.id;
        if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            return res.status(400).json({ error: 'Invalid video ID' });
        }
        const userId = parseInt(req.authenticatedUserId);
        const webOnly = req.query.web === '1';
        const sendToChannel = req.query.send === '1';
        try {
            const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('../services/youtube')));
            const url = `https://youtube.com/watch?v=${videoId}`;
            const filePath = await downloadYouTube(url, 'audio');
            const extension = path_1.default.extname(filePath) || '.mp3';
            const filename = `music_${videoId}${extension}`;
            if (sendToChannel) {
                const userData = await (await Promise.resolve().then(() => __importStar(require('../services/database')))).DBService.getUser(userId);
                const target = userData?.target_channel;
                if (!target) {
                    return res.status(400).json({ success: false, error: 'Target channel not configured' });
                }
                await bot_instance_1.bot.sendAudio(target, filePath);
                logger_1.logger.info(`Music sent to channel ${target} for user ${userId}`);
                return res.json({ success: true, message: 'Musiqa kanalga yuborildi!' });
            }
            await serveFileDownload(res, filePath, filename, {
                userId,
                notifyBot: webOnly ? undefined : 'audio',
            });
        }
        catch (e) {
            logger_1.logger.warn(`Music download failed for ${videoId}: ${e.message}`);
            res.status(502).json({ error: 'Download failed', details: e.message });
        }
    });
    app.post('/api/media/download', checkAuth, async (req, res) => {
        const { url, type } = req.body; // type: 'video' | 'audio'
        const userId = parseInt(req.authenticatedUserId);
        const webOnly = req.query.web === '1' || req.body?.delivery === 'web';
        if (!['video', 'audio'].includes(type)) {
            return res.status(400).json({ error: 'Invalid media type' });
        }
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        try {
            const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('../services/youtube')));
            const filePath = await downloadYouTube(url, type);
            const ext = path_1.default.extname(filePath) || (type === 'video' ? '.mp4' : '.mp3');
            const filename = `media_${Date.now()}${ext}`;
            await serveFileDownload(res, filePath, filename, {
                userId,
                notifyBot: webOnly ? undefined : (type === 'video' ? 'video' : 'audio'),
            });
        }
        catch (e) {
            logger_1.logger.warn(`Media download failed: ${e.message}`);
            res.status(502).json({ error: 'Download failed', details: e.message });
        }
    });
    app.get('/api/finance/prices', checkAuth, async (req, res) => {
        try {
            const crypto = await finance_1.FinanceService.getCryptoPrices();
            const usd = await finance_1.FinanceService.getUSDRate();
            res.json({ btc: crypto.BTC || 'N/A', usd: usd || 'N/A' });
        }
        catch (e) {
            res.json({ btc: 'N/A', usd: 'N/A' });
        }
    });
    // BUG-060 Fix: Parse withImage as boolean properly
    app.post('/api/ai/smm', checkAuth, aiLimiter, async (req, res) => {
        const { prompt, withImage, language } = req.body;
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            return res.status(400).json({ error: 'Prompt bo\'sh bo\'lishi mumkin emas.' });
        }
        const topic = prompt.trim();
        const wantImage = withImage === true || withImage === 'true';
        try {
            const user = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
            const postLanguage = typeof language === 'string' && language.trim() ? language.trim().slice(0, 8) : user?.language || 'uz';
            const textPromise = (0, ai_1.generateSmmPost)(topic, postLanguage);
            const imagePromise = wantImage ? (0, ai_1.generateSmmImage)(topic) : Promise.resolve(null);
            const [text, img] = await Promise.all([textPromise, imagePromise]);
            let imageUrl = img?.imageUrl || null;
            let imageBase64 = img?.imageBase64 || null;
            res.json({ text, imageUrl, imageBase64 });
        }
        catch (e) {
            logger_1.logger.error(`SMM generate error: ${e.message}`);
            res.status(500).json({ error: e.message || 'AI xatolik' });
        }
    });
    app.post('/api/ai/post-to-channel', checkAuth, async (req, res) => {
        const { text, imageUrl, imageBase64 } = req.body;
        if (!text || typeof text !== 'string')
            return res.status(400).json({ error: 'Invalid text' });
        try {
            const user = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
            if (!user?.target_channel) {
                return res.status(400).json({ error: 'No channel configured' });
            }
            const caption = `AI Voice News\n\n`;
            const remainder = text.length > 1024 ? text.slice(1024) : '';
            if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image')) {
                const base64Data = imageBase64.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                await bot_instance_1.bot.sendPhoto(user.target_channel, buffer, { caption });
            }
            else if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
                await bot_instance_1.bot.sendPhoto(user.target_channel, imageUrl, { caption });
            }
            else {
                await bot_instance_1.bot.sendMessage(user.target_channel, text);
            }
            if (remainder)
                await bot_instance_1.bot.sendMessage(user.target_channel, remainder);
            res.json({ success: true });
        }
        catch (e) {
            logger_1.logger.error(`SMM post-to-channel error: ${e.message}`);
            res.status(500).json({ error: e.message || 'Telegram send failed' });
        }
    });
    app.get('/api/tracker/search', checkAuth, async (req, res) => {
        const q = req.query.q;
        if (!q || typeof q !== 'string' || q.trim() === '') {
            return res.status(400).json({ error: 'Qidiruv so\'rovi kiritilmagan' });
        }
        try {
            const { PriceTrackerService } = await Promise.resolve().then(() => __importStar(require('./pricetracker')));
            const results = await PriceTrackerService.searchProducts(q.trim());
            const sorted = results.sort((a, b) => a.price - b.price);
            res.json(sorted);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/tracker/cheapest', checkAuth, async (req, res) => {
        const q = req.query.q;
        if (!q || typeof q !== 'string' || q.trim() === '') {
            return res.status(400).json({ error: 'Qidiruv so\'rovi kiritilmagan' });
        }
        try {
            const { PriceTrackerService } = await Promise.resolve().then(() => __importStar(require('./pricetracker')));
            let results = await PriceTrackerService.searchProducts(q.trim());
            if (!results.length) {
                try {
                    const scraped = await scraper_1.ScraperService.searchProducts(q.trim());
                    results = (scraped || [])
                        .map((item) => ({
                        title: item.name || item.title || 'Mahsulot',
                        price: Number(item.price) || 0,
                        url: item.url,
                        source: item.store || item.source || 'Marketplace',
                    }))
                        .filter((item) => item.url && Number.isFinite(item.price) && item.price > 0)
                        .sort((a, b) => a.price - b.price);
                }
                catch { }
            }
            const cheapest = results[0] || null;
            const bySource = Array.from(results.reduce((acc, item) => {
                const current = acc.get(item.source);
                if (!current || item.price < current.price)
                    acc.set(item.source, item);
                return acc;
            }, new Map())).map(([, value]) => value).sort((a, b) => a.price - b.price);
            res.json({ cheapest, bySource });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // --- PRICE TRACKER ---
    app.get('/api/prices/:userId', checkAuth, async (req, res) => {
        const prices = await database_1.DBService.getTrackedPrices(parseInt(req.authenticatedUserId));
        res.json(prices);
    });
    app.post('/api/prices/:userId', checkAuth, async (req, res) => {
        const { url, name, price } = req.body;
        const parsedPrice = Number(price);
        if (!url || typeof url !== 'string' || !name || typeof name !== 'string' || Number.isNaN(parsedPrice) || parsedPrice < 0) {
            return res.status(400).json({ error: 'Invalid price tracker payload' });
        }
        try {
            let finalName = name;
            let finalPrice = parsedPrice;
            if (finalName === 'Tovar' || finalPrice === 0) {
                try {
                    const { PriceTrackerService } = await Promise.resolve().then(() => __importStar(require('./pricetracker')));
                    const resolved = await PriceTrackerService.fetchPrice(url);
                    if (resolved) {
                        finalName = resolved.title;
                        finalPrice = resolved.price;
                    }
                }
                catch { }
            }
            await database_1.DBService.addTrackedPrice(parseInt(req.authenticatedUserId), url, finalName, finalPrice);
            res.json({ success: true });
        }
        catch (e) {
            res.status(400).json({ error: e.message });
        }
    });
    app.delete('/api/prices/:userId/:id', checkAuth, async (req, res) => {
        await database_1.DBService.removePrice(parseInt(req.authenticatedUserId), parseInt(req.params.id));
        res.json({ success: true });
    });
    // --- MONITORED CHANNELS ---
    app.get('/api/channels/:userId', checkAuth, async (req, res) => {
        const channels = await database_1.DBService.getUserMonitoredChannels(parseInt(req.authenticatedUserId));
        res.json(channels);
    });
    app.post('/api/channels/:userId', checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { platform, channelId, name, forward_mode, use_ai } = req.body;
        const allowedPlatforms = ['youtube', 'instagram', 'telegram'];
        if (!allowedPlatforms.includes(platform) || !channelId) {
            return res.status(400).json({ error: 'Invalid channel payload' });
        }
        let resolvedId = channelId;
        let resolvedName = name || channelId;
        if (platform === 'telegram') {
            const verify = await telegram_monitor_1.TelegramMonitorService.verifyBotInSourceChannel(channelId);
            if (!verify.ok)
                return res.status(400).json({ error: verify.error || 'Bot manba kanalda admin emas' });
            resolvedId = verify.chatId || (0, telegram_monitor_1.normalizeTelegramChannelId)(channelId);
            resolvedName = verify.title || resolvedName;
        }
        if (!(await database_1.DBService.checkUserLimit(uid, 'channels'))) {
            return res.status(403).json({ error: 'Channel limit reached' });
        }
        await database_1.DBService.addMonitoredChannel(uid, platform, resolvedId, resolvedName, {
            forward_mode: forward_mode || 'copy',
            use_ai: use_ai ? 1 : 0,
        });
        res.json({ success: true, channelId: resolvedId, name: resolvedName });
    });
    app.patch('/api/channels/:userId/:id', checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const id = parseInt(req.params.id);
        const { forward_mode, use_ai, is_active } = req.body;
        const updates = {};
        if (forward_mode)
            updates.forward_mode = forward_mode;
        if (use_ai !== undefined)
            updates.use_ai = use_ai ? 1 : 0;
        if (is_active !== undefined)
            updates.is_active = is_active ? 1 : 0;
        await database_1.DBService.updateMonitoredChannelSettings(id, uid, updates);
        res.json({ success: true });
    });
    app.delete('/api/channels/:userId/:id', checkAuth, async (req, res) => {
        await database_1.DBService.removeMonitoredChannel(parseInt(req.authenticatedUserId), parseInt(req.params.id));
        res.json({ success: true });
    });
    // --- MULTI-CHANNEL OUTPUT ---
    app.get('/api/output-channels/:userId', checkAuth, async (req, res) => {
        const u = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
        if (!u)
            return res.status(404).json({ error: 'Not found' });
        res.json({ primary: u.target_channel, extra: u.extra_channels || '', all: database_1.DBService.getUserOutputChannels(u) });
    });
    app.post('/api/output-channels/:userId', checkAuth, async (req, res) => {
        const { channels } = req.body;
        if (!Array.isArray(channels))
            return res.status(400).json({ error: 'channels array required' });
        await database_1.DBService.setExtraChannels(parseInt(req.authenticatedUserId), channels);
        res.json({ success: true });
    });
    // --- UZ TRENDS RADAR ---
    app.get('/api/trends/uz', checkAuth, async (req, res) => {
        const force = req.query.refresh === '1' || req.query.refresh === 'true';
        try {
            const data = await trends_1.TrendsService.scanUZTrends(force);
            res.json(data);
        }
        catch (e) {
            const cached = await database_1.DBService.getLatestTrendsSnapshot();
            if (cached)
                return res.json({ topics: cached.topics, summary: cached.summary, at: cached.created_at });
            res.status(500).json({ error: e.message });
        }
    });
    // --- AI VOICE NEWS ---
    app.post('/api/ai/voice-news', checkAuth, aiLimiter, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { text, title, sendToChannel } = req.body;
        const user = await database_1.DBService.getUser(uid);
        if (!user)
            return res.status(404).json({ error: 'Not found' });
        const cleanTitle = typeof title === 'string' ? title.trim() : '';
        const cleanText = typeof text === 'string' ? text.trim() : '';
        if (!cleanTitle && !cleanText) {
            return res.status(400).json({ error: 'Sarlavha yoki matn kiriting' });
        }
        const lang = typeof user.language === 'string' && user.language.trim() ? user.language.trim() : 'uz';
        const script = cleanText || await (0, ai_2.generateAudioSummary)(cleanTitle || 'Yangilik', cleanText || cleanTitle || '', lang);
        const audio = await (0, ai_2.generateTTS)(script, lang);
        if (!audio)
            return res.status(500).json({ error: 'Ovoz generatsiyasi muvaffaqiyatsiz' });
        const caption = `AI Voice News: <b>${cleanTitle || 'AI Ovoz Yangilik'}</b>\n\n${script.slice(0, 500)}`;
        const targets = sendToChannel ? database_1.DBService.getUserOutputChannels(user) : [uid];
        let sentCount = 0;
        const failedTargets = [];
        for (const ch of targets) {
            try {
                const chatId = sendToChannel ? ch : uid;
                await bot_instance_1.bot.sendAudio(chatId, audio, { caption, parse_mode: 'HTML' }, { filename: 'voice-news-file.mp3', contentType: 'audio/mpeg' });
                sentCount++;
            }
            catch (e) {
                logger_1.logger.warn(`Voice send failed ${ch}: ${e.message}`);
                failedTargets.push(String(ch));
            }
        }
        if (sentCount === 0) {
            return res.status(502).json({ error: 'Ovoz yuborilmadi. Bot kanalda admin emas yoki kanal ID noto\'g\'ri.' });
        }
        res.json({ success: true, sent: sentCount, failed: failedTargets.length, script: script.slice(0, 800) });
    });
    // --- VISUAL POST COMPOSER (multi-channel) ---
    app.post('/api/posts/publish', checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { text, imageUrl, channels } = req.body;
        if (!text || typeof text !== 'string')
            return res.status(400).json({ error: 'Text required' });
        const user = await database_1.DBService.getUser(uid);
        if (!user)
            return res.status(404).json({ error: 'Not found' });
        const targets = Array.isArray(channels) && channels.length
            ? channels
            : database_1.DBService.getUserOutputChannels(user);
        if (!targets.length)
            return res.status(400).json({ error: 'No output channels configured' });
        await (0, telegram_1.safeSendToChannels)(user, targets, async (target) => {
            if (imageUrl) {
                await bot_instance_1.bot.sendPhoto(target, imageUrl, { caption: text, parse_mode: 'HTML' });
            }
            else {
                await bot_instance_1.bot.sendMessage(target, text, { parse_mode: 'HTML' });
            }
        });
        await database_1.DBService.incrementStat(uid, 'total_posts');
        res.json({ success: true, sentTo: targets.length });
    });
    app.post('/api/posts/draft', checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { title, body, image_url, channels } = req.body;
        if (!body)
            return res.status(400).json({ error: 'Body required' });
        const draft = await database_1.DBService.savePostDraft(uid, { title, body, image_url, channels });
        res.json({ success: true, draft });
    });
    app.get('/api/posts/drafts/:userId', checkAuth, async (req, res) => {
        const drafts = await database_1.DBService.getUserPostDrafts(parseInt(req.authenticatedUserId));
        res.json(drafts);
    });
    // --- SUPPORT TICKETS ---
    // BUG-FIX: /api/tickets/all must be registered BEFORE /api/tickets/:userId
    // otherwise Express matches 'all' as a :userId param and this route is never reached.
    app.get('/api/tickets/all', checkAdmin, async (req, res) => {
        const tickets = await database_1.DBService.getTickets();
        res.json(tickets);
    });
    app.get('/api/tickets/:userId', checkAuth, async (req, res) => {
        const tickets = await database_1.DBService.getUserTickets(parseInt(req.authenticatedUserId));
        res.json(tickets);
    });
    app.post('/api/tickets/:userId', checkAuth, async (req, res) => {
        const { subject, message } = req.body;
        const ticket = await database_1.DBService.createTicket(parseInt(req.authenticatedUserId), subject, message);
        res.json(ticket);
    });
    // --- REFERRAL SYSTEM ---
    app.get('/api/referral/:userId', checkAuth, async (req, res) => {
        const code = await database_1.DBService.ensureReferralCode(parseInt(req.authenticatedUserId));
        const stats = await database_1.DBService.getReferralStats(parseInt(req.authenticatedUserId));
        const botMe = await bot_instance_1.bot.getMe();
        const refLink = `https://t.me/${botMe.username}?start=ref_${code}`;
        res.json({ code, stats, refLink });
    });
    // --- SCHEDULED POSTS ---
    app.get('/api/scheduled/:userId', checkAuth, async (req, res) => {
        const posts = await database_1.DBService.getUserScheduledPosts(parseInt(req.authenticatedUserId));
        res.json(posts);
    });
    app.post('/api/scheduled/:userId', checkAuth, async (req, res) => {
        const { type, content, scheduledAt } = req.body;
        if (!['video', 'audio', 'text'].includes(type) || !content || !scheduledAt || isNaN(Date.parse(scheduledAt))) {
            return res.status(400).json({ error: 'Invalid scheduled post payload' });
        }
        try {
            await database_1.DBService.addScheduledPost(parseInt(req.authenticatedUserId), type, content, scheduledAt);
            res.json({ success: true });
        }
        catch (e) {
            res.status(400).json({ error: e.message || 'Invalid scheduled post' });
        }
    });
    app.delete('/api/scheduled/:userId/:id', checkAuth, async (req, res) => {
        await database_1.DBService.cancelScheduledPost(parseInt(req.authenticatedUserId), parseInt(req.params.id));
        res.json({ success: true });
    });
    // --- API KEYS ---
    app.get('/api/keys/:userId', checkAuth, async (req, res) => {
        const keys = await database_1.DBService.getUserApiKeys(parseInt(req.authenticatedUserId));
        res.json(keys);
    });
    app.post('/api/keys', checkAdmin, async (req, res) => {
        const userIdForKey = Number(req.body?.userId || req.authenticatedUserId);
        const { key, type } = req.body;
        if (!userIdForKey || !key || !type || typeof key !== 'string' || typeof type !== 'string') {
            return res.status(400).json({ error: 'Invalid api key payload' });
        }
        const validTypes = config_1.CONFIG.API_KEY_SOURCES;
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: 'Unsupported API key type' });
        }
        const isValid = await (0, ai_1.validateKey)(type, key);
        if (!isValid)
            return res.status(400).json({ error: 'API key validation failed' });
        const { ApiKeyService } = await Promise.resolve().then(() => __importStar(require('./apiKeys')));
        await ApiKeyService.addKey(userIdForKey, type, key);
        res.json({ success: true });
    });
    app.post('/api/keys/:userId', checkAdmin, async (req, res) => {
        const { key, type } = req.body;
        if (!key || !type || typeof key !== 'string' || typeof type !== 'string') {
            return res.status(400).json({ error: 'Invalid api key payload' });
        }
        const validTypes = config_1.CONFIG.API_KEY_SOURCES;
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: 'Unsupported API key type' });
        }
        const isValid = await (0, ai_1.validateKey)(type, key);
        if (!isValid)
            return res.status(400).json({ error: 'API key validation failed' });
        await database_1.DBService.addApiKey(parseInt(req.authenticatedUserId), key, type);
        res.json({ success: true });
    });
    // --- USER SETTINGS EXTENDED ---
    app.get('/api/settings/:userId/extended', checkAuth, async (req, res) => {
        const u = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
        if (!u)
            return res.status(404).json({ error: 'Not found' });
        const keywords = await database_1.DBService.getKeywords(parseInt(req.authenticatedUserId));
        res.json({
            language: u.language,
            target_channel: u.target_channel,
            is_active: u.is_active,
            is_premium: u.is_premium,
            keywords: keywords.join(', '),
            daily_digest: u.daily_digest,
            digest_time: u.digest_time,
            schedule_times: u.schedule_times,
            interval_minutes: Math.max(Number(u.interval_minutes) || 15, 1)
        });
    });
    app.post('/api/settings/:userId/extended', checkAuth, async (req, res) => {
        const { language, target_channel, keywords, daily_digest, digest_time, schedule_times, interval_minutes } = req.body;
        const userId = parseInt(req.authenticatedUserId);
        const safeInterval = Math.max(Math.min(Number(interval_minutes) || 15, 1440), 1);
        if (typeof target_channel === 'string' && target_channel.trim()) {
            const normalized = database_1.DBService.normalizeTargetChannel(target_channel);
            if (!normalized.startsWith('@') && !normalized.startsWith('-100')) {
                return res.status(400).json({ error: 'Invalid target channel format' });
            }
            try {
                const chat = await bot_instance_1.bot.getChat(normalized);
                const me = await bot_instance_1.bot.getMe();
                const member = await bot_instance_1.bot.getChatMember(chat.id, me.id);
                if (member.status !== 'administrator' && member.status !== 'creator') {
                    return res.status(400).json({ error: 'Bot target kanalda admin emas' });
                }
            }
            catch (e) {
                return res.status(400).json({ error: e.message || 'Channel verification failed' });
            }
        }
        const updates = {};
        if (language !== undefined)
            updates.language = language;
        if (target_channel !== undefined)
            updates.target_channel = target_channel;
        if (daily_digest !== undefined)
            updates.daily_digest = daily_digest;
        if (digest_time !== undefined)
            updates.digest_time = digest_time;
        if (schedule_times !== undefined)
            updates.schedule_times = schedule_times;
        if (interval_minutes !== undefined)
            updates.interval_minutes = safeInterval;
        const ok = Object.keys(updates).length ? await database_1.DBService.updateUser(userId, updates) : true;
        if (!ok)
            return res.status(500).json({ error: 'Settings update failed' });
        if (keywords !== undefined)
            await database_1.DBService.setKeywords(parseInt(req.authenticatedUserId), keywords);
        res.json({ success: true });
    });
    // BUG-061 Fix: Use DB prices instead of hardcoded
    app.get('/api/premium-info', checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const priceMonthly = await database_1.DBService.getPrice('monthly');
        const priceYearly = await database_1.DBService.getPrice('yearly');
        const isActive = await database_1.DBService.isPremiumActive(uid);
        let expiresAt = null;
        if (isActive) {
            const user = await database_1.DBService.getUser(uid);
            expiresAt = user?.premium_until;
        }
        const benefits = [
            '10 ta RSS manba',
            'Cheksiz kanal monitoring',
            'Cheksiz schedule post',
            'AI prioritet (30/min)',
            'Kunlik digest',
            'Premium badge va oltin tema'
        ];
        const starsPrice = parseInt(await database_1.DBService.getSetting('premium_stars_price') || '500');
        const starsYearlyPrice = starsPrice * 10;
        res.json({
            monthlyPrice: priceMonthly,
            yearlyPrice: priceYearly,
            starsPrice,
            starsYearlyPrice,
            isActive,
            expiresAt,
            benefits
        });
    });
    app.post('/api/premium/buy', checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { method, plan } = req.body;
        const isYearly = plan === 'yearly';
        if (method === 'stars') {
            const starsPrice = parseInt(await database_1.DBService.getSetting('premium_stars_price') || '500');
            const price = isYearly ? starsPrice * 10 : starsPrice;
            const title = isYearly ? 'mateAssistent Premium (1 Year)' : 'mateAssistent Premium (1 Month)';
            const invoice = await bot_instance_1.bot.createInvoiceLink(title, 'Premium access for news automation', `premium_sub_${uid}${isYearly ? '_yearly' : ''}`, '', 'XTR', [{ label: 'Premium', amount: price }]);
            return res.json({ success: true, url: invoice, method: 'stars' });
        }
        if (method === 'payme') {
            const amount = isYearly ? await database_1.DBService.getPrice('yearly') : await database_1.DBService.getPrice('monthly');
            const link = await payment_1.PaymentService.generatePaymeLink(uid, amount, isYearly ? 'yearly' : 'monthly');
            if (!link)
                return res.status(503).json({ error: 'Payme sozlanmagan (PAYME_MERCHANT_ID)' });
            return res.json({ success: true, url: link, method: 'payme' });
        }
        if (method === 'click') {
            const amount = isYearly ? await database_1.DBService.getPrice('yearly') : await database_1.DBService.getPrice('monthly');
            const link = await payment_1.PaymentService.generateClickLink(uid, amount, isYearly ? 'yearly' : 'monthly');
            if (!link)
                return res.status(503).json({ error: 'Click sozlanmagan (CLICK_SERVICE_ID)' });
            return res.json({ success: true, url: link, method: 'click' });
        }
        res.status(400).json({ error: 'Unsupported method' });
    });
    app.delete('/api/keys/:id', checkAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id))
            return res.status(400).json({ error: 'API key id required' });
        const { ApiKeyService } = await Promise.resolve().then(() => __importStar(require('./apiKeys')));
        await ApiKeyService.removeKey(id);
        res.json({ success: true });
    });
    // BUG-062 Fix: Require PAYME_KEY for webhook processing
    app.post('/api/payments/payme', async (req, res) => {
        try {
            if (!process.env.PAYME_KEY) {
                logger_1.logger.warn('🚫 Payme webhook rejected: PAYME_KEY not configured');
                // BUG-087 Fix: Return 200 to prevent Payme from sending spam retries
                return res.status(200).json({ error: { code: -32504, message: 'Payment not configured' } });
            }
            res.json(await payment_1.PaymentService.handlePaymeWebhook(req.body, req.headers));
        }
        catch (e) {
            logger_1.logger.error(`Payme webhook failed: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/payments/click', async (req, res) => {
        try {
            const result = await payment_1.PaymentService.handleClickWebhook(req.body || {});
            return res.status(200).json(result);
        }
        catch (e) {
            logger_1.logger.error(`Click webhook failed: ${e.message}`);
            return res.status(200).json({
                error: -9,
                error_note: 'Internal server error',
                click_trans_id: req.body?.click_trans_id || 0,
                merchant_trans_id: req.body?.merchant_trans_id || ''
            });
        }
    });
    // BUG-065 Fix: Error handling for sendFile
    app.use('/dashboard', (req, res) => {
        const filePath = path_1.default.join(process.cwd(), 'public', 'index.html');
        res.sendFile(filePath, (err) => {
            // BUG-101 Fix: Check headersSent to avoid exception
            if (err && !res.headersSent)
                res.status(404).json({ error: 'Dashboard not found' });
        });
    });
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/'))
            return res.status(404).json({ error: 'Not found' });
        const filePath = path_1.default.join(process.cwd(), 'public', 'index.html');
        res.sendFile(filePath, (err) => {
            if (err && !res.headersSent)
                res.status(404).json({ error: 'Page not found' });
        });
    });
    // BUG-064 Fix: app.listen is called here
    app.listen(port, () => logger_1.logger.info(`🖥 Dashboard on ${port}`));
    return app;
}
