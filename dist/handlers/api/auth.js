"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthRoutes = registerAuthRoutes;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../../config/config");
const database_1 = require("../../services/database");
const auth_1 = require("../auth");
const bot_instance_1 = require("../../services/bot_instance");
const logger_1 = require("../../utils/logger");
function hashPassword(password, salt) {
    return crypto_1.default.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}
function generateSalt() {
    return crypto_1.default.randomBytes(16).toString('hex');
}
/** Reserve IDs >= 900000000 for web-only accounts */
const WEB_ID_START = 900_000_000;
function nextWebUserId(users) {
    const existing = users.map(u => u.telegram_id).filter((id) => id >= WEB_ID_START);
    return existing.length > 0 ? Math.max(...existing) + 1 : WEB_ID_START;
}
function registerAuthRoutes(app) {
    const authLimiter = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, max: 10, message: { error: 'Too many attempts. Try again later.' } });
    const masterLimiter = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, max: 5, message: { error: 'Too many attempts. Try again later.' } });
    app.post('/api/auth/telegram', async (req, res) => {
        const { initData } = req.body;
        if (!initData)
            return res.status(400).json({ error: 'Missing initData' });
        const tgUser = (0, auth_1.verifyTelegramWebAppData)(initData);
        if (!tgUser || !tgUser.id)
            return res.status(401).json({ error: 'Invalid Telegram data' });
        let user = await database_1.DBService.getUser(tgUser.id);
        if (!user)
            user = await database_1.DBService.upsertUser(tgUser.id, (0, config_1.isOwnerId)(tgUser.id) ? 1 : 0, tgUser.username, tgUser.first_name);
        if (!user)
            return res.status(500).json({ error: 'User creation failed' });
        if ((0, config_1.isOwnerId)(tgUser.id) && user.role !== 'owner') {
            await database_1.DBService.updateUserRole(tgUser.id, 'owner');
            user.role = 'owner';
        }
        const token = (0, bot_instance_1.generateDashboardToken)(tgUser.id);
        res.json({ token, userId: tgUser.id, role: user.role || 'user' });
    });
    app.post('/api/auth/verify', authLimiter, async (req, res) => {
        const { userId, token } = req.body;
        if (!userId || !token)
            return res.status(400).json({ error: 'Missing userId or token' });
        const uid = parseInt(userId);
        if (isNaN(uid))
            return res.status(400).json({ error: 'Invalid userId' });
        const expectedToken = (0, bot_instance_1.generateDashboardToken)(uid);
        if (token !== expectedToken)
            return res.status(401).json({ error: 'Invalid token' });
        let user = await database_1.DBService.getUser(uid);
        if (!user) {
            user = await database_1.DBService.upsertUser(uid, (0, config_1.isOwnerId)(uid) ? 1 : 0);
        }
        if (!user)
            return res.status(500).json({ error: 'User not found' });
        if ((0, config_1.isOwnerId)(uid) && user.role !== 'owner') {
            await database_1.DBService.updateUserRole(uid, 'owner');
            user.role = 'owner';
        }
        res.json({ success: true, userId: uid, role: user.role || 'user' });
    });
    app.post('/api/auth/master', masterLimiter, async (req, res) => {
        const { token } = req.body;
        if (token && config_1.CONFIG.DASHBOARD_SECRET && (0, auth_1.timingSafeCompare)(token, config_1.CONFIG.DASHBOARD_SECRET)) {
            if (config_1.CONFIG.OWNER_ID == null)
                return res.status(500).json({ error: 'Owner ID not configured' });
            const ownerId = config_1.CONFIG.OWNER_ID;
            let user = await database_1.DBService.getUser(ownerId);
            if (!user)
                user = await database_1.DBService.upsertUser(ownerId, 1, 'Owner', 'Owner');
            if (user && user.role !== 'owner')
                await database_1.DBService.updateUserRole(ownerId, 'owner');
            return res.json({ token, userId: ownerId, role: user?.role || 'owner' });
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
        res.status(401).json({ error: 'Invalid master token' });
    });
    app.get('/api/dashboard-info', auth_1.checkAuth, async (req, res) => {
        const userId = parseInt(req.authenticatedUserId);
        const user = await database_1.DBService.getUser(userId);
        if (!user)
            return res.status(404).json({ error: 'Not found' });
        const effectiveRole = user.role || (user.is_owner ? 'owner' : 'user');
        const isAdmin = effectiveRole === 'owner' || effectiveRole === 'admin';
        const [stats, scheduled, referrals, workspaces, tickets, apiKeyCount] = await Promise.all([
            database_1.DBService.getStats(userId),
            database_1.DBService.getUserScheduledPosts(userId),
            database_1.DBService.getReferralStats(userId),
            database_1.DBService.getUserWorkspaces(userId),
            isAdmin ? database_1.DBService.getTickets() : database_1.DBService.getUserTickets(userId),
            database_1.DBService.getUserApiKeyCount(userId),
        ]);
        res.json({
            user: { id: user.telegram_id, telegram_id: user.telegram_id, username: user.username, first_name: user.first_name, role: effectiveRole, is_owner: !!user.is_owner, is_premium: !!user.is_premium, is_approved: !!user.is_approved, is_active: user.is_active !== 0, target_channel: user.target_channel || null, language: user.language || 'uz', premium_until: user.premium_until || null, referral_code: user.referral_code || null, api_key_count: apiKeyCount },
            stats,
            scheduled,
            referrals,
            workspaces,
            tickets,
        });
    });
    app.get('/api/user/:userId', auth_1.checkAuth, async (req, res) => {
        const u = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
        res.json(u ? { ...u, api_key_count: await database_1.DBService.getUserApiKeyCount(u.telegram_id) } : { error: 'Not found' });
    });
    app.post('/api/auth/web-register', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password || password.length < 6) {
            return res.status(400).json({ error: 'Email and password (6+ chars) required' });
        }
        const normalizedEmail = email.trim().toLowerCase();
        if (await database_1.DBService.getWebUserByEmail(normalizedEmail)) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const telegramId = WEB_ID_START + Date.now();
        const salt = generateSalt();
        const passwordHash = hashPassword(password, salt);
        try {
            await database_1.DBService.upsertUser(telegramId, 0, normalizedEmail.split('@')[0], normalizedEmail.split('@')[0]);
            const entry = await database_1.DBService.createWebUser({
                email: normalizedEmail,
                password_hash: passwordHash,
                salt,
                telegram_id: telegramId,
                approved: true,
            });
            if (!entry) {
                return res.status(500).json({ error: 'Account creation failed' });
            }
            logger_1.logger.info(`Web user created: ${normalizedEmail} -> id ${telegramId}`);
        }
        catch (e) {
            logger_1.logger.error(`Web user DB creation failed for ${normalizedEmail}: ${e?.message || 'unknown'}`);
            return res.status(500).json({ error: 'Account creation failed' });
        }
        res.json({ success: true, message: 'Account created. You can now login.' });
    });
    app.post('/api/auth/web-login', authLimiter, async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email and password required' });
        const normalizedEmail = email.trim().toLowerCase();
        const entry = await database_1.DBService.getWebUserByEmail(normalizedEmail);
        if (!entry) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        if (!entry.approved)
            return res.status(403).json({ error: 'Account pending approval' });
        const hash = hashPassword(password, entry.salt);
        if (hash !== entry.password_hash) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const token = (0, bot_instance_1.generateDashboardToken)(entry.telegram_id);
        const user = await database_1.DBService.getUser(entry.telegram_id);
        res.json({ token, userId: entry.telegram_id, role: user?.role || 'user' });
    });
    app.get('/api/auth/web-users', auth_1.checkAuth, async (req, res) => {
        const userId = parseInt(req.authenticatedUserId);
        const admin = await database_1.DBService.getUser(userId);
        const isAdmin = admin && (admin.role === 'owner' || admin.role === 'admin' || admin.is_owner);
        if (!isAdmin && !(0, config_1.isOwnerId)(userId))
            return res.status(403).json({ error: 'Forbidden' });
        res.json(await database_1.DBService.getWebUsers());
    });
}
