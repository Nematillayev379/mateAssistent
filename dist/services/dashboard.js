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
const scraper_1 = require("./scraper");
const finance_1 = require("./finance");
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
    app.use(express_1.default.static(path_1.default.join(process.cwd(), 'public')));
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
        max: 10,
        message: { error: 'AI request limit exceeded.' }
    });
    app.get('/health', (req, res) => res.json({ status: 'ok', bot: 'active' }));
    app.post('/api/bot/webhook', async (req, res) => {
        try {
            await bot_instance_1.bot.processUpdate(req.body);
            res.sendStatus(200);
        }
        catch (e) {
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
    const checkAuth = (req, res, next) => {
        const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
        if (!token)
            return res.status(401).json({ error: 'Unauthorized' });
        if (token && config_1.CONFIG.DASHBOARD_SECRET && token === config_1.CONFIG.DASHBOARD_SECRET) {
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
        next();
    };
    // WebApp InitData Verification
    const verifyTelegramWebAppData = (telegramInitData) => {
        try {
            const initData = new URLSearchParams(telegramInitData);
            const hash = initData.get('hash');
            if (!hash)
                return null;
            const authDate = initData.get('auth_date');
            if (!authDate)
                return null;
            const authTs = parseInt(authDate, 10);
            if (isNaN(authTs) || Math.abs(Date.now() / 1000 - authTs) > 3600)
                return null;
            initData.delete('hash');
            const keys = Array.from(initData.keys()).sort();
            const dataCheckString = keys.map(key => `${key}=${initData.get(key)}`).join('\n');
            const secretKey = crypto_1.default.createHmac('sha256', 'WebAppData').update((config_1.CONFIG.TELEGRAM_TOKEN || '').trim()).digest();
            const calculatedHash = crypto_1.default.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
            if (calculatedHash === hash) {
                const userStr = initData.get('user');
                return userStr ? JSON.parse(userStr) : null;
            }
            return null;
        }
        catch (e) {
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
            // Auto-upsert if not found
            user = await database_1.DBService.upsertUser(tgUser.id, (0, config_1.isOwnerId)(tgUser.id) ? 1 : 0, tgUser.username, tgUser.first_name);
            if (!user)
                return res.status(500).json({ error: 'User not found and creation failed' });
        }
        // Generate our standard dashboard token to use as a session token
        const token = (0, bot_instance_1.generateDashboardToken)(tgUser.id);
        res.json({ token, userId: tgUser.id, role: user.role });
    });
    app.post('/api/auth/master', async (req, res) => {
        const { token } = req.body;
        if (token && config_1.CONFIG.DASHBOARD_SECRET && token === config_1.CONFIG.DASHBOARD_SECRET) {
            const ownerId = config_1.CONFIG.OWNER_ID;
            let user = await database_1.DBService.getUser(ownerId);
            if (!user) {
                user = await database_1.DBService.upsertUser(ownerId, 1, 'Owner', 'Owner');
            }
            res.json({ token, userId: ownerId, role: user?.role || 'owner' });
        }
        else {
            res.status(401).json({ error: 'Invalid master token' });
        }
    });
    // BUG-056 Fix: Same userId extraction order as checkAuth
    const checkAdmin = async (req, res, next) => {
        const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
        const adminId = extractUserId(req);
        if (token && config_1.CONFIG.DASHBOARD_SECRET && token === config_1.CONFIG.DASHBOARD_SECRET) {
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
        const user = await database_1.DBService.getUser(parseInt(adminId));
        if (!user || (user.role !== 'owner' && user.role !== 'admin'))
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
        res.json({
            user: { id: user.telegram_id, username: user.username, role: user.role, is_premium: user.is_premium },
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
        const discovered = await scraper_1.ScraperService.discoverRSS(url);
        // BUG-024 Fix: Better error message for RSS discovery failure
        if (!discovered)
            return res.status(400).json({ error: 'URL yaroqli RSS/Atom formatida emas yoki server bloklagan.' });
        const user = await database_1.DBService.getUser(uid);
        if (!user)
            return res.status(404).json({ error: 'Not found' });
        const sources = await database_1.DBService.getUserSources(uid);
        // BUG-058 Fix: Include admin role in limit calculation
        const limit = (user.role === 'owner' || user.role === 'admin') ? 999 : (user.is_premium ? 3 : 1) + Math.min(await database_1.DBService.getUserApiKeyCount(uid), 3);
        if (sources.length >= limit)
            return res.status(403).json({ error: 'Limit reached' });
        await database_1.DBService.addSource(uid, name, discovered, lang || 'uz');
        res.json({ success: true });
    });
    app.delete('/api/sources/:userId/:id', checkAuth, async (req, res) => {
        await database_1.DBService.removeSource(parseInt(req.authenticatedUserId), parseInt(req.params.id));
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
        await database_1.DBService.updateUser(parseInt(req.authenticatedUserId), { language, target_channel });
        res.json({ success: true });
    });
    // --- ADMIN ENDPOINTS ---
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
    // BUG-059 Fix: Actually ping Redis to check connection
    app.get('/api/admin/system', checkAdmin, async (req, res) => {
        let redisStatus = false;
        try {
            const redis = (await Promise.resolve().then(() => __importStar(require('../services/redis')))).getRedisConnection();
            if (redis) {
                await redis.ping();
                redisStatus = true;
            }
        }
        catch { }
        res.json({
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            redis: redisStatus,
            ownerId: config_1.CONFIG.OWNER_ID,
            nodeVersion: process.version
        });
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
    app.get('/api/music/download/:id', checkAuth, async (req, res) => {
        const videoId = req.params.id;
        const userId = parseInt(req.authenticatedUserId);
        try {
            const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('../services/youtube')));
            const url = `https://youtube.com/watch?v=${videoId}`;
            const filePath = await downloadYouTube(url, 'audio');
            // Option 1: Send to bot chat (Seamless for Telegram)
            await bot_instance_1.bot.sendAudio(userId, filePath, { caption: "Downloaded via Dashboard" });
            // Option 2: Serve for browser download
            res.download(filePath, (err) => {
                if (fs_1.default.existsSync(filePath))
                    fs_1.default.unlinkSync(filePath);
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/media/download', checkAuth, async (req, res) => {
        const { url, type } = req.body; // type: 'video' | 'audio'
        const userId = parseInt(req.authenticatedUserId);
        if (!['video', 'audio'].includes(type)) {
            return res.status(400).json({ error: 'Invalid media type' });
        }
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        try {
            const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('../services/youtube')));
            const filePath = await downloadYouTube(url, type);
            if (type === 'video')
                await bot_instance_1.bot.sendVideo(userId, filePath);
            else
                await bot_instance_1.bot.sendAudio(userId, filePath);
            res.download(filePath, (err) => {
                if (fs_1.default.existsSync(filePath))
                    fs_1.default.unlinkSync(filePath);
                if (err && !res.headersSent) {
                    res.status(500).json({ error: err.message || 'Download failed' });
                }
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
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
        const { prompt, withImage } = req.body;
        // BUG-022 Fix: Reject empty prompt
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            return res.status(400).json({ error: 'Prompt bo\'sh bo\'lishi mumkin emas.' });
        }
        const text = await (0, ai_1.getSmartAIResponse)("Write a viral telegram post in Uzbek with emojis.", prompt);
        // BUG-060 Fix: Properly parse boolean from JSON body
        const wantImage = withImage === true || withImage === 'true';
        const imageUrl = wantImage ? `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=720` : null;
        res.json({ text, imageUrl });
    });
    app.post('/api/ai/post-to-channel', checkAuth, async (req, res) => {
        const { text } = req.body;
        if (!text || typeof text !== 'string')
            return res.status(400).json({ error: 'Invalid text' });
        const user = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
        if (!user?.target_channel) {
            return res.status(400).json({ error: 'No channel configured' });
        }
        await bot_instance_1.bot.sendMessage(user.target_channel, text, { parse_mode: 'HTML' });
        res.json({ success: true });
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
            await database_1.DBService.addTrackedPrice(parseInt(req.authenticatedUserId), url, name, parsedPrice);
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
        const { platform, channelId, name } = req.body;
        const allowedPlatforms = ['youtube', 'instagram'];
        if (!allowedPlatforms.includes(platform) || !channelId || !name) {
            return res.status(400).json({ error: 'Invalid channel payload' });
        }
        await database_1.DBService.addMonitoredChannel(parseInt(req.authenticatedUserId), platform, channelId, name);
        res.json({ success: true });
    });
    app.delete('/api/channels/:userId/:id', checkAuth, async (req, res) => {
        await database_1.DBService.removeMonitoredChannel(parseInt(req.authenticatedUserId), parseInt(req.params.id));
        res.json({ success: true });
    });
    // --- SUPPORT TICKETS ---
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
    app.post('/api/keys/:userId', checkAuth, async (req, res) => {
        const { key, type } = req.body;
        if (!key || !type || typeof key !== 'string' || typeof type !== 'string') {
            return res.status(400).json({ error: 'Invalid api key payload' });
        }
        const validTypes = ['groq', 'cerebras', 'openrouter', 'gemini', 'openai', 'google'];
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
            schedule_times: u.schedule_times
        });
    });
    app.post('/api/settings/:userId/extended', checkAuth, async (req, res) => {
        const { language, target_channel, keywords, daily_digest, digest_time, schedule_times } = req.body;
        await database_1.DBService.updateUser(parseInt(req.authenticatedUserId), { language, target_channel, daily_digest, digest_time, schedule_times });
        if (keywords)
            await database_1.DBService.setKeywords(parseInt(req.authenticatedUserId), keywords);
        res.json({ success: true });
    });
    // --- ADMIN USER MANAGEMENT ---
    app.get('/api/admin/users', checkAdmin, async (req, res) => {
        const users = await database_1.DBService.getUsersForAdmin();
        res.json(users);
    });
    app.post('/api/admin/users/:telegramId/role', checkAdmin, async (req, res) => {
        const { role } = req.body;
        await database_1.DBService.updateUserRole(parseInt(req.params.telegramId), role);
        res.json({ success: true });
    });
    app.get('/api/tickets/all', checkAdmin, async (req, res) => {
        const tickets = await database_1.DBService.getTickets();
        res.json(tickets);
    });
    app.get('/api/admin/sources', checkAdmin, async (req, res) => {
        const sources = await database_1.DBService.getAllSources();
        res.json(sources);
    });
    app.post('/api/admin/settings', checkAdmin, async (req, res) => {
        const { premium_stars_price } = req.body;
        if (premium_stars_price) {
            await database_1.DBService.setSetting('premium_stars_price', premium_stars_price);
        }
        res.json({ success: true });
    });
    // BUG-061 Fix: Use DB prices instead of hardcoded
    app.post('/api/premium/buy', checkAuth, async (req, res) => {
        const { userId, method, plan } = req.body;
        const uid = parseInt(userId);
        if (method === 'stars') {
            const starsPrice = parseInt(await database_1.DBService.getSetting('premium_stars_price') || '500');
            const price = plan === 'yearly' ? starsPrice * 10 : starsPrice;
            const title = plan === 'yearly' ? 'Elite Premium (1 Year)' : 'Elite Premium (1 Month)';
            const invoice = await bot_instance_1.bot.createInvoiceLink(title, 'Premium access for news automation', `premium_sub_${uid}${plan === 'yearly' ? '_yearly' : ''}`, '', 'XTR', [{ label: 'Premium', amount: price }]);
            return res.json({ success: true, url: invoice });
        }
        res.status(400).json({ error: 'Unsupported method' });
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
