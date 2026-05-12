"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDashboardServer = startDashboardServer;
const express_1 = __importDefault(require("express"));
const logger_1 = require("../utils/logger");
const database_1 = require("./database");
const config_1 = require("../config/config");
const bot_instance_1 = require("./bot_instance");
const path_1 = __importDefault(require("path"));
const pricetracker_1 = require("./pricetracker");
const ai_1 = require("./ai");
const music_1 = require("./music");
const payment_1 = require("./payment");
function startDashboardServer(port, _bot) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use(express_1.default.static(path_1.default.join(__dirname, '../../public')));
    app.get('/health', (req, res) => res.json({ status: 'ok', bot: 'active', mode: config_1.CONFIG.PUBLIC_URL ? 'webhook' : 'polling' }));
    app.get('/', (req, res) => res.sendFile(path_1.default.join(__dirname, '../../public/index.html')));
    // ── BOT WEBHOOK ──────────────────────────────────────────────
    app.post('/api/bot/webhook', async (req, res) => {
        try {
            bot_instance_1.bot.processUpdate(req.body);
            res.sendStatus(200);
        }
        catch (e) {
            logger_1.logger.error(`Webhook error: ${e.message}`);
            res.sendStatus(500);
        }
    });
    const DASHBOARD_SECRET = config_1.CONFIG.DASHBOARD_SECRET;
    const checkAuth = (req, res, next) => {
        const token = req.headers['x-bot-token'] || req.query.token;
        if (token !== DASHBOARD_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    };
    const checkAdmin = async (req, res, next) => {
        const token = req.headers['x-bot-token'] || req.query.token;
        if (token !== DASHBOARD_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const rawId = req.body?.userId || req.query?.userId || req.params?.userId || req.params?.telegramId;
        if (!rawId)
            return res.status(403).json({ error: 'Forbidden: userId required' });
        const user = await database_1.DBService.getUser(parseInt(rawId)).catch(() => null);
        if (!user?.is_owner) {
            return res.status(403).json({ error: 'Forbidden: admin only' });
        }
        next();
    };
    // ── USER ────────────────────────────────────────────────────────
    app.get('/api/user/:userId', checkAuth, async (req, res) => {
        try {
            const user = await database_1.DBService.getUser(parseInt(req.params.userId));
            if (!user)
                return res.status(404).json({ error: 'User not found' });
            const keyCount = await database_1.DBService.getUserApiKeyCount(parseInt(req.params.userId));
            res.json({ ...user, api_key_count: keyCount });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/users', checkAdmin, async (req, res) => {
        try {
            const users = await database_1.DBService.getAllUsers();
            res.json(users);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── STATS ─────────────────────────────────────────────────────
    app.get('/api/stats/:userId', checkAuth, async (req, res) => {
        try {
            const stats = await database_1.DBService.getStats(parseInt(req.params.userId));
            res.json(stats || { total_posts: 0, total_duplicates: 0 });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── SOURCES ───────────────────────────────────────────────────
    app.get('/api/sources/:userId', checkAuth, async (req, res) => {
        try {
            const sources = await database_1.DBService.getUserSources(parseInt(req.params.userId));
            res.json(sources);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/sources/:userId', checkAuth, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const { name, url, lang } = req.body;
            if (!name || !url) {
                return res.status(400).json({ error: 'Nom va URL kiritilishi shart' });
            }
            // Source limit logic
            const user = await database_1.DBService.getUser(userId);
            if (!user)
                return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
            const sources = await database_1.DBService.getUserSources(userId);
            const keyCount = await database_1.DBService.getUserApiKeyCount(userId);
            // Calculate limit:  base + bonus keys (max 3 bonus)
            let baseLimit = 1;
            if (user.is_premium || user.is_owner)
                baseLimit = 3;
            const bonusFromKeys = Math.min(keyCount, 3);
            const totalLimit = baseLimit + bonusFromKeys;
            if (!user.is_owner && sources.length >= totalLimit) {
                const msg = user.is_premium
                    ? `Premium limitga yetdingiz (${totalLimit} ta). Qo'shimcha manba uchun API kalit qo'shing.`
                    : `Asosiy limit ${baseLimit} ta. Ko'proq manba qo'shish uchun API kalit ulang (har kalit = +1 manba, max +3).`;
                return res.status(403).json({ error: msg, limit: totalLimit, current: sources.length });
            }
            await database_1.DBService.addSource(userId, name, url, lang || 'uz');
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.delete('/api/sources/:userId/:sourceId', checkAuth, async (req, res) => {
        try {
            await database_1.DBService.removeSource(parseInt(req.params.userId), parseInt(req.params.sourceId));
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── SOURCE LIMIT INFO ─────────────────────────────────────────
    app.get('/api/sources/:userId/limit', checkAuth, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const user = await database_1.DBService.getUser(userId);
            if (!user)
                return res.status(404).json({ error: 'Not found' });
            const sources = await database_1.DBService.getUserSources(userId);
            const keyCount = await database_1.DBService.getUserApiKeyCount(userId);
            let baseLimit = 1;
            if (user.is_premium || user.is_owner)
                baseLimit = 3;
            const bonusFromKeys = Math.min(keyCount, 3);
            const totalLimit = user.is_owner ? 999 : baseLimit + bonusFromKeys;
            res.json({
                current: sources.length,
                total: totalLimit,
                base: baseLimit,
                bonus: bonusFromKeys,
                is_owner: !!user.is_owner,
                is_premium: !!(user.is_premium),
                api_key_count: keyCount
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── SETTINGS ─────────────────────────────────────────────────
    app.post('/api/settings/:userId', checkAuth, async (req, res) => {
        try {
            const { channel, interval, keywords } = req.body;
            const updates = {};
            if (channel !== undefined)
                updates.target_channel = channel || null;
            if (interval !== undefined)
                updates.interval_minutes = parseInt(interval) || 15;
            if (keywords !== undefined)
                updates.keywords = keywords || '';
            await database_1.DBService.updateUser(parseInt(req.params.userId), updates);
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/settings/:userId/language', checkAuth, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const { language } = req.body;
            const validLangs = ['uz', 'ru', 'en'];
            if (!validLangs.includes(language))
                return res.status(400).json({ error: "Noto'g'ri til kodi" });
            await database_1.DBService.setLanguage(userId, language);
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/settings/:userId/schedule', checkAuth, async (req, res) => {
        try {
            const { schedule } = req.body;
            await database_1.DBService.setScheduleTimes(parseInt(req.params.userId), schedule || '');
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/settings/:userId/digest', checkAuth, async (req, res) => {
        try {
            const { enabled, time } = req.body;
            await database_1.DBService.setDailyDigest(parseInt(req.params.userId), !!enabled, time || '20:00');
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/settings/:userId/toggle', checkAuth, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const user = await database_1.DBService.getUser(userId);
            if (!user)
                return res.status(404).json({ error: 'User not found' });
            await database_1.DBService.updateUser(userId, { is_active: user.is_active ? 0 : 1 });
            res.json({ success: true, is_active: !user.is_active });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── REFERRAL ─────────────────────────────────────────────────
    app.get('/api/referral/:userId', checkAuth, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const stats = await database_1.DBService.getReferralStats(userId);
            const code = await database_1.DBService.ensureReferralCode(userId);
            const botUsername = config_1.CONFIG.TELEGRAM_TOKEN
                ? await bot_instance_1.bot.getMe().then((me) => me.username).catch(() => 'YourBot')
                : 'YourBot';
            const link = `https://t.me/${botUsername}?start=ref_${code}`;
            res.json({ ...stats, code, link });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── PREMIUM ───────────────────────────────────────────────────
    app.get('/api/admin/prices', checkAuth, async (req, res) => {
        try {
            const prices = {
                monthly: await database_1.DBService.getPrice('monthly'),
                yearly: await database_1.DBService.getPrice('yearly'),
                stars: await database_1.DBService.getSetting('premium_stars_price') || '500',
                ton: await database_1.DBService.getSetting('premium_ton_price') || '2.5',
                uzs: await database_1.DBService.getSetting('premium_uzs_price') || '120,000'
            };
            res.json(prices);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/admin/prices', checkAdmin, async (req, res) => {
        try {
            const { monthly, yearly, stars, ton, uzs } = req.body;
            if (monthly !== undefined)
                await database_1.DBService.setPrice('monthly', monthly);
            if (yearly !== undefined)
                await database_1.DBService.setPrice('yearly', yearly);
            if (stars !== undefined)
                await database_1.DBService.setSetting('premium_stars_price', stars.toString());
            if (ton !== undefined)
                await database_1.DBService.setSetting('premium_ton_price', ton.toString());
            if (uzs !== undefined)
                await database_1.DBService.setSetting('premium_uzs_price', uzs.toString());
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/premium/buy', checkAuth, async (req, res) => {
        try {
            const { userId, method } = req.body;
            const amount = method === 'yearly' ? await database_1.DBService.getPrice('yearly') : await database_1.DBService.getPrice('monthly');
            if (method === 'stars') {
                const starsPrice = parseInt(await database_1.DBService.getSetting('premium_stars_price') || '500');
                if (bot_instance_1.bot && typeof bot_instance_1.bot.createInvoiceLink === 'function') {
                    const invoice = await bot_instance_1.bot.createInvoiceLink('Premium Obuna', 'Cheksiz manbalar va barcha premium imkoniyatlar', 'premium_sub_' + userId, '', 'XTR', [{ label: 'Premium', amount: starsPrice }]);
                    res.json({ invoice_url: invoice });
                }
                else {
                    res.status(503).json({ error: 'Invoice generation unavailable' });
                }
            }
            else if (method === 'payme') {
                const url = await payment_1.PaymentService.generatePaymeLink(userId, amount);
                res.json({ url });
            }
            else if (method === 'click') {
                const url = await payment_1.PaymentService.generateClickLink(userId, amount);
                res.json({ url });
            }
            else if (method === 'stripe') {
                const session = await payment_1.PaymentService.createStripeSession(userId, amount);
                res.json({ url: session.url });
            }
            else if (method === 'ton') {
                const tonPrice = await database_1.DBService.getSetting('premium_ton_price') || '2.5';
                const tonWallet = await database_1.DBService.getSetting('premium_ton_wallet') || '';
                const admin = await database_1.DBService.getSetting('admin_username') || '@admin';
                res.json({ details: `💎 TON:\n${tonPrice} TON → ${tonWallet}\n\nTo'lovdan keyin adminga yozing: ${admin}` });
            }
            else if (method === 'uzs') {
                const uzsPrice = await database_1.DBService.getSetting('premium_uzs_price') || '120,000';
                const uzsDetails = await database_1.DBService.getSetting('premium_uzs_details') || '';
                const admin = await database_1.DBService.getSetting('admin_username') || '@admin';
                res.json({ details: `💳 UZS:\n${uzsPrice} UZS → ${uzsDetails}\n\nTo'lovdan keyin adminga yozing: ${admin}` });
            }
            else {
                res.status(400).json({ error: 'Invalid method' });
            }
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── PAYMENT WEBHOOKS ─────────────────────────────────────────
    app.post('/api/payments/payme', async (req, res) => {
        const result = await payment_1.PaymentService.handlePaymeWebhook(req.body);
        res.json(result);
    });
    // ── API KEYS ─────────────────────────────────────────────────
    app.get('/api/api-keys/:userId', checkAuth, async (req, res) => {
        try {
            const keys = await database_1.DBService.getUserApiKeys(parseInt(req.params.userId));
            // Don't expose full key, mask it
            const masked = (keys || []).map((k) => ({
                ...k,
                api_key: k.api_key.slice(0, 8) + '****' + k.api_key.slice(-4)
            }));
            res.json(masked);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/api-keys', checkAuth, async (req, res) => {
        try {
            const { userId, key, type } = req.body;
            if (!key || key.length < 10) {
                return res.status(400).json({ error: "API kaliti juda qisqa yoki bo'sh" });
            }
            const validTypes = ['groq', 'gemini', 'cerebras', 'openrouter', 'openai'];
            if (!validTypes.includes(type)) {
                return res.status(400).json({ error: `Noto'g'ri tur. Mumkin: ${validTypes.join(', ')}` });
            }
            const isDuplicate = await database_1.DBService.isKeyExists(key.trim());
            if (isDuplicate) {
                return res.status(400).json({ error: 'Bu API kalit allaqachon tizimda mavjud' });
            }
            const isValid = await validateApiKey(key, type);
            if (!isValid) {
                return res.status(400).json({ error: 'API kalit ishlamaydi yoki noto\'g\'ri kiritildi' });
            }
            const uid = parseInt(userId);
            const currentKeyCount = await database_1.DBService.getUserApiKeyCount(uid);
            await database_1.DBService.addApiKey(uid, key.trim(), type);
            await (0, ai_1.refreshKeyPool)();
            // Source bonus is computed dynamically from getUserApiKeyCount() - no extra_sources update needed
            const newKeyCount = await database_1.DBService.getUserApiKeyCount(uid);
            res.json({
                success: true,
                message: currentKeyCount < 3
                    ? `API kalit qo'shildi! Sizga +1 manba qo'shish huquqi berildi.`
                    : 'API kalit tizimga qo\'shildi (maksimal bonus olindi).',
                api_key_count: newKeyCount
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    async function validateApiKey(key, type) {
        try {
            return await (0, ai_1.validateKey)(type, key);
        }
        catch {
            return false;
        }
    }
    // ── BOT INFO ─────────────────────────────────────────────────
    app.get('/api/bot-info', checkAuth, async (req, res) => {
        try {
            if (!bot_instance_1.bot || typeof bot_instance_1.bot.getMe !== 'function') {
                return res.status(503).json({ error: 'Bot not available' });
            }
            const me = await bot_instance_1.bot.getMe();
            res.json({ username: me.username, first_name: me.first_name });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── AI ────────────────────────────────────────────────────────
    app.post('/api/ai/smm', checkAuth, async (req, res) => {
        try {
            const { prompt, withImage = false, userId } = req.body;
            if (!prompt || prompt.trim().length < 3) {
                return res.status(400).json({ error: 'Mavzu kiritilishi shart (min 3 belgi)' });
            }
            const systemPrompt = `Siz professional SMM menejeri va kopiraytersiz. Berilgan mavzu bo'yicha Telegram uchun jalb qiluvchi, emojilar bilan boyitilgan, o'zbek tilida post yozing. Post qisqa (maks 200 so'z), aniq va ta'sirli bo'lsin. Faqat tayyor postni yozing, boshqa hech narsa qo'shmang.`;
            const result = await (0, ai_1.getSmartAIResponse)(systemPrompt, prompt);
            let imageUrl = null;
            if (withImage) {
                imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ', professional, high quality, 4k')}?width=1280&height=720&seed=${Date.now()}&nologo=true`;
            }
            res.json({ text: result, imageUrl });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/ai/post-to-channel', checkAuth, async (req, res) => {
        try {
            const { userId, text } = req.body;
            const user = await database_1.DBService.getUser(parseInt(userId));
            if (!user?.target_channel)
                return res.status(400).json({ error: 'Kanal sozlanmagan. Avval kanal ID ni kiriting.' });
            if (bot_instance_1.bot && typeof bot_instance_1.bot.sendMessage === 'function') {
                await bot_instance_1.bot.sendMessage(user.target_channel, text, { parse_mode: 'HTML' });
                res.json({ success: true });
            }
            else {
                res.status(503).json({ error: 'Bot xizmati mavjud emas' });
            }
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/ai/generate-media', checkAuth, async (req, res) => {
        try {
            const { prompt } = req.body;
            const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true&seed=${Date.now()}`;
            res.json({ url: imageUrl, type: 'image' });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── SERVICES ─────────────────────────────────────────────────
    // Music search (returns YouTube results list, no download via web)
    app.get('/api/music/search', checkAuth, async (req, res) => {
        try {
            const { q } = req.query;
            if (!q)
                return res.status(400).json({ error: 'Qidiruv so\'zi kiritilishi shart' });
            const results = await music_1.MusicService.getYouTubeVideoIds(q, 8);
            res.json(results);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/music/download/:id', async (req, res) => {
        try {
            const id = req.params.id;
            const url = `https://youtube.com/watch?v=${id}`;
            // In a real implementation, we would stream from ytdl-core
            // For now, we'll return the URL or a redirect
            res.redirect(url);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // Price search
    app.get('/api/price/search', checkAuth, async (req, res) => {
        try {
            const { q } = req.query;
            if (!q)
                return res.status(400).json({ error: 'Qidiruv so\'zi kiritilishi shart' });
            const results = await pricetracker_1.PriceTrackerService.searchProducts(q);
            res.json(results);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // Tracked prices
    app.get('/api/prices/:userId', checkAuth, async (req, res) => {
        try {
            const prices = await database_1.DBService.getTrackedPrices(parseInt(req.params.userId));
            res.json(prices);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // YouTube: redirect user to bot for download (can't do file transfer via web)
    app.post('/api/youtube/info', checkAuth, async (req, res) => {
        try {
            const { url } = req.body;
            if (!url || !url.includes('youtu')) {
                return res.status(400).json({ error: "To'g'ri YouTube havolasi kiriting" });
            }
            res.json({
                success: true,
                message: 'Botga havola yuboring: yuklash bot orqali amalga oshiriladi.',
                url
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── MONITORING ───────────────────────────────────────────────
    app.post('/api/monitor/add', checkAuth, async (req, res) => {
        try {
            const { userId, platform, channelId, name } = req.body;
            if (!userId || !platform || !channelId) {
                return res.status(400).json({ error: 'userId, platform va channelId kiritilishi shart' });
            }
            await database_1.DBService.addMonitoredChannel(parseInt(userId), platform, channelId, name || channelId);
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/monitor/:userId', checkAuth, async (req, res) => {
        try {
            const results = await database_1.DBService.getUserMonitoredChannels(parseInt(req.params.userId));
            res.json(results);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.delete('/api/monitor/:userId/:id', checkAuth, async (req, res) => {
        try {
            await database_1.DBService.removeMonitoredChannel(parseInt(req.params.userId), parseInt(req.params.id));
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── ADMIN ─────────────────────────────────────────────────────
    app.post('/api/admin/users/:telegramId/premium', checkAdmin, async (req, res) => {
        try {
            const { telegramId } = req.params;
            const { days } = req.body;
            if (days > 0) {
                await database_1.DBService.setPremium(parseInt(telegramId), days);
            }
            else {
                await database_1.DBService.revokePremium(parseInt(telegramId));
            }
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/admin/users/:telegramId/approve', checkAdmin, async (req, res) => {
        try {
            await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 1 });
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/admin/users/:telegramId/block', checkAdmin, async (req, res) => {
        try {
            await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 0, is_active: 0 });
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/admin/broadcast', checkAdmin, async (req, res) => {
        try {
            const { message } = req.body;
            const users = await database_1.DBService.getAllUsers();
            let count = 0;
            for (const user of users) {
                try {
                    if (bot_instance_1.bot && typeof bot_instance_1.bot.sendMessage === 'function') {
                        await bot_instance_1.bot.sendMessage(user.telegram_id, `📢 <b>ADMIN XABARI:</b>\n\n${message}`, { parse_mode: 'HTML' });
                        count++;
                        await new Promise(r => setTimeout(r, 80));
                    }
                }
                catch { }
            }
            res.json({ success: true, count });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/admin/system', checkAuth, async (req, res) => {
        try {
            const mem = process.memoryUsage();
            res.json({
                uptime: Math.floor(process.uptime()),
                ram: Math.round(mem.heapUsed / 1024 / 1024),
                platform: process.platform,
                nodeVersion: process.version
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/services/post-to-group', checkAuth, async (req, res) => {
        try {
            const { userId, service, message } = req.body;
            const requestingUser = await database_1.DBService.getUser(parseInt(userId));
            if (!requestingUser)
                return res.status(404).json({ error: 'User not found' });
            const ownerUsers = (await database_1.DBService.getAllUsers()).filter((u) => u.is_owner);
            if (ownerUsers.length > 0) {
                for (const owner of ownerUsers) {
                    try {
                        await (0, bot_instance_1.notify)(owner.telegram_id, `🔔 Xizmat so'rovi: ${service}\nUser: ${requestingUser.telegram_id}\n${message}`);
                    }
                    catch { }
                }
                res.json({ success: true });
            }
            else {
                res.status(503).json({ error: 'Admin topilmadi' });
            }
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ── SPA fallback ─────────────────────────────────────────────
    app.get('/dashboard', (req, res) => {
        res.sendFile(path_1.default.join(__dirname, '../../public/index.html'));
    });
    app.use((req, res) => {
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({ error: 'Not found' });
        }
        res.sendFile(path_1.default.join(__dirname, '../../public/index.html'));
    });
    app.listen(port, () => {
        logger_1.logger.info(`🖥 Dashboard server started on port ${port}`);
    });
    return app;
}
