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
exports.registerAdminRoutes = registerAdminRoutes;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("../../config/config");
const database_1 = require("../../services/database");
const bot_instance_1 = require("../../services/bot_instance");
const logger_1 = require("../../utils/logger");
const ai_1 = require("../../services/ai");
const auth_1 = require("../auth");
function registerAdminRoutes(app) {
    const adminAiLimiter = (0, express_rate_limit_1.default)({
        windowMs: 60 * 1000, max: 30, message: { error: 'Admin AI request limit exceeded.' }
    });
    app.get('/api/admin/users', auth_1.checkAdmin, async (req, res) => {
        const users = await database_1.DBService.getAllUsers();
        for (const u of users)
            u.sources = await database_1.DBService.getUserSources(u.telegram_id);
        res.json(users);
    });
    app.get('/api/admin/settings', auth_1.checkAdmin, async (req, res) => {
        res.json({
            premium_stars_price: await database_1.DBService.getSetting('premium_stars_price') || '500',
            price_monthly: await database_1.DBService.getPrice('monthly'),
            price_yearly: await database_1.DBService.getPrice('yearly'),
            require_approval: (await database_1.DBService.getSetting('require_approval')) !== '0',
        });
    });
    app.post('/api/admin/settings', auth_1.checkAdmin, async (req, res) => {
        const { premium_stars_price, price_monthly, price_yearly, require_approval } = req.body;
        if (premium_stars_price)
            await database_1.DBService.setSetting('premium_stars_price', String(premium_stars_price));
        if (price_monthly)
            await database_1.DBService.setPrice('monthly', Number(price_monthly));
        if (price_yearly)
            await database_1.DBService.setPrice('yearly', Number(price_yearly));
        if (require_approval !== undefined)
            await database_1.DBService.setSetting('require_approval', require_approval ? '1' : '0');
        res.json({ success: true });
    });
    app.post('/api/admin/users/:telegramId/role', auth_1.checkAdmin, async (req, res) => {
        const role = req.body.role;
        if (!['owner', 'admin', 'user', 'premium'].includes(role))
            return res.status(400).json({ error: 'Invalid role' });
        const callerId = parseInt(req.authenticatedUserId);
        if ((role === 'owner' || role === 'admin') && !(0, config_1.isOwnerId)(callerId))
            return res.status(403).json({ error: 'Faqat Owner boshqalarni admin qila oladi' });
        if (role === 'owner')
            return res.status(403).json({ error: 'Owner rolini API orqali berish taqiqlangan' });
        await database_1.DBService.updateUserRole(parseInt(req.params.telegramId), role);
        res.json({ success: true });
    });
    app.get('/api/admin/prices', auth_1.checkAdmin, async (req, res) => res.json({ monthly: await database_1.DBService.getPrice('monthly'), yearly: await database_1.DBService.getPrice('yearly'), stars: await database_1.DBService.getSetting('premium_stars_price') || '500' }));
    app.post('/api/admin/users/:telegramId/premium', auth_1.checkAdmin, async (req, res) => {
        const days = parseInt(req.body.days);
        if (isNaN(days) || days < 0)
            return res.status(400).json({ error: 'Invalid days' });
        if (days > 0)
            await database_1.DBService.setPremium(parseInt(req.params.telegramId), days);
        else
            await database_1.DBService.revokePremium(parseInt(req.params.telegramId));
        res.json({ success: true });
    });
    app.post('/api/admin/users/:telegramId/approve', auth_1.checkAdmin, async (req, res) => { await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 1 }); res.json({ success: true }); });
    app.post('/api/admin/users/:telegramId/block', auth_1.checkAdmin, async (req, res) => { await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_active: 0 }); res.json({ success: true }); });
    app.post('/api/admin/users/:telegramId/unblock', auth_1.checkAdmin, async (req, res) => { await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_active: 1 }); res.json({ success: true }); });
    app.post('/api/admin/users/:telegramId/reject', auth_1.checkAdmin, async (req, res) => { await database_1.DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 0 }); res.json({ success: true }); });
    app.post('/api/admin/users/:telegramId/revoke', auth_1.checkAdmin, async (req, res) => { await database_1.DBService.revokePremium(parseInt(req.params.telegramId)); res.json({ success: true }); });
    app.post('/api/admin/users/approve-all', auth_1.checkAdmin, async (req, res) => {
        try {
            const users = await database_1.DBService.getAllUsers();
            const pending = users.filter((u) => !u.is_approved && u.is_active !== false);
            for (const u of pending) {
                await database_1.DBService.updateUser(u.telegram_id, { is_approved: 1 });
            }
            res.json({ success: true, approved: pending.length });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/admin/sources', auth_1.checkAdmin, async (req, res) => res.json(await database_1.DBService.getAllSources()));
    app.get('/api/admin/system', auth_1.checkAdmin, async (req, res) => {
        const { getRedisPool } = await Promise.resolve().then(() => __importStar(require('../../services/redis')));
        const pool = getRedisPool();
        let redisStatus = false;
        let poolInfo = null;
        if (pool) {
            try {
                await pool.active.ping();
                redisStatus = true;
            }
            catch (e) {
                logger_1.logger.warn(`Redis ping failed: ${e?.message || 'unknown error'}`);
            }
            poolInfo = { active: pool.exhaustedCount + 1, total: pool.totalCount, exhausted: pool.exhaustedCount, url: pool.activeUrl.replace(/:\/\/.*@/, '://***@') };
        }
        const envPool = (0, config_1.buildKeyPoolFromEnv)();
        const active = (0, ai_1.getActiveKeyStats)();
        const mem = process.memoryUsage();
        const memPct = Math.min(99, Math.round((mem.heapUsed / mem.heapTotal) * 100));
        let userCount = 0, sourceCount = 0, postCount = 0, pendingUsers = 0, premiumUsers = 0, freeUsers = 0;
        try {
            const allUsers = await database_1.DBService.getAllUsers();
            userCount = allUsers.length;
            pendingUsers = allUsers.filter((u) => !u.is_approved && u.is_active !== false).length;
            premiumUsers = allUsers.filter((u) => u.is_premium).length;
            freeUsers = userCount - premiumUsers;
        }
        catch (e) {
            logger_1.logger.warn('getAllUsers failed: ' + e?.message);
        }
        try {
            const allSources = await database_1.DBService.getAllSources();
            sourceCount = allSources.length;
        }
        catch (e) {
            logger_1.logger.warn('getAllSources failed: ' + e?.message);
        }
        res.json({
            uptime: process.uptime(),
            memory: mem,
            memory_usage: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
            memory_pct: memPct,
            redis: redisStatus,
            redisPool: poolInfo,
            nodeVersion: process.version,
            version: process.env.npm_package_version || '1.0.0',
            user_count: userCount,
            source_count: sourceCount,
            post_count: postCount,
            pending_users: pendingUsers,
            premium_users: premiumUsers,
            free_users: freeUsers,
            uptime_pct: '99.8',
            aiKeys: { envLoaded: envPool.length, activeLoaded: active.total, envByProvider: (0, config_1.countKeysByProvider)(envPool), activeByProvider: active.byProvider, envVarCounts: (0, config_1.getEnvKeySourceReport)() }
        });
    });
    app.get('/api/admin/stats', auth_1.checkAdmin, async (req, res) => {
        try {
            const allUsers = await database_1.DBService.getAllUsers();
            const total_users = allUsers.length;
            const premium_users = allUsers.filter((u) => u.is_premium).length;
            const free_users = total_users - premium_users;
            const pending_users = allUsers.filter((u) => !u.is_approved && u.is_active !== false).length;
            const source_count = (await database_1.DBService.getAllSources().catch(() => [])).length;
            res.json({
                total_users, premium_users, free_users, pending_users,
                source_count,
                posts_today: 0,
                revenue_month: (premium_users * 25000).toLocaleString() + ' UZS',
                uptime_pct: '99.8'
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/admin/ai-keys/refresh', auth_1.checkAdmin, async (_req, res) => { await (0, ai_1.refreshKeyPool)(); res.json({ success: true, ...(0, ai_1.getActiveKeyStats)() }); });
    app.get('/api/admin/ai-keys', auth_1.checkAdmin, async (_req, res) => {
        try {
            const stats = (0, ai_1.getActiveKeyStats)();
            const envPool = (0, config_1.buildKeyPoolFromEnv)();
            const providers = {};
            let total = 0, active = 0, blocked = 0;
            for (const k of envPool) {
                const prov = k.provider || 'unknown';
                if (!providers[prov])
                    providers[prov] = { active: 0, blocked: 0, total: 0 };
                providers[prov].total += 1;
                total += 1;
                if (k.status === 'active' || k.status === 'valid') {
                    providers[prov].active += 1;
                    active += 1;
                }
                else {
                    providers[prov].blocked += 1;
                    blocked += 1;
                }
            }
            const keys = envPool.slice(0, 50).map((k, i) => ({
                id: k.id || `key-${i}`,
                name: k.name || k.id || `Key ${i + 1}`,
                provider: k.provider || 'unknown',
                status: k.status || 'unknown',
                usage: k.usage || 0,
                last_used: k.lastUsed || k.last_used || '—'
            }));
            res.json({ total, active, blocked, providers, keys, stats });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/admin/broadcast', auth_1.checkAdmin, adminAiLimiter, async (req, res) => {
        const { message } = req.body;
        if (!message || typeof message !== 'string')
            return res.status(400).json({ error: 'Invalid broadcast message' });
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
}
