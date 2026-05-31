"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSettingsRoutes = registerSettingsRoutes;
const database_1 = require("../../services/database");
const bot_instance_1 = require("../../services/bot_instance");
const auth_1 = require("../../middleware/auth");
function registerSettingsRoutes(app) {
    app.post('/api/settings/:userId/toggle', auth_1.checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const u = await database_1.DBService.getUser(uid);
        if (!u)
            return res.status(404).json({ error: 'Not found' });
        const next = u.is_active ? 0 : 1;
        await database_1.DBService.updateUser(uid, { is_active: next });
        res.json({ success: true, is_active: next });
    });
    app.get('/api/settings/:userId', auth_1.checkAuth, async (req, res) => {
        const u = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
        if (!u)
            return res.status(404).json({ error: 'Not found' });
        res.json({
            language: u.language,
            target_channel: u.target_channel,
            is_active: u.is_active,
            is_premium: u.is_premium,
            daily_digest: u.daily_digest,
            digest_time: u.digest_time,
            interval_minutes: Math.max(Number(u.interval_minutes) || 15, 1),
            keywords: (await database_1.DBService.getKeywords(parseInt(req.authenticatedUserId))).join(', '),
        });
    });
    app.post('/api/settings/:userId', auth_1.checkAuth, async (req, res) => {
        const { language, target_channel, keywords, daily_digest, digest_time, interval_minutes } = req.body;
        const userId = parseInt(req.authenticatedUserId);
        if (typeof target_channel === 'string' && target_channel.trim()) {
            const normalized = database_1.DBService.normalizeTargetChannel(target_channel);
            if (!normalized.startsWith('@') && !normalized.startsWith('-100'))
                return res.status(400).json({ error: 'Invalid target channel format' });
            try {
                const chat = await bot_instance_1.bot.getChat(normalized);
                const me = await bot_instance_1.bot.getMe();
                const member = await bot_instance_1.bot.getChatMember(chat.id, me.id);
                if (member.status !== 'administrator' && member.status !== 'creator')
                    return res.status(400).json({ error: 'Bot target kanalda admin emas' });
            }
            catch (e) {
                return res.status(400).json({ error: 'Channel verification failed' });
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
        if (interval_minutes !== undefined)
            updates.interval_minutes = Math.max(Math.min(Number(interval_minutes) || 15, 1440), 1);
        const ok = Object.keys(updates).length ? await database_1.DBService.updateUser(userId, updates) : true;
        if (!ok)
            return res.status(500).json({ error: 'Settings update failed' });
        if (keywords !== undefined)
            await database_1.DBService.setKeywords(userId, keywords);
        res.json({ success: true });
    });
    app.get('/api/settings/:userId/extended', auth_1.checkAuth, async (req, res) => {
        const u = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
        if (!u)
            return res.status(404).json({ error: 'Not found' });
        const keywords = await database_1.DBService.getKeywords(parseInt(req.authenticatedUserId));
        res.json({ language: u.language, target_channel: u.target_channel, is_active: u.is_active, is_premium: u.is_premium, keywords: keywords.join(', '), daily_digest: u.daily_digest, digest_time: u.digest_time, schedule_times: u.schedule_times, interval_minutes: Math.max(Number(u.interval_minutes) || 15, 1) });
    });
    app.post('/api/settings/:userId/extended', auth_1.checkAuth, async (req, res) => {
        const { language, target_channel, keywords, daily_digest, digest_time, schedule_times, interval_minutes } = req.body;
        const userId = parseInt(req.authenticatedUserId);
        const safeInterval = Math.max(Math.min(Number(interval_minutes) || 15, 1440), 1);
        if (typeof target_channel === 'string' && target_channel.trim()) {
            const normalized = database_1.DBService.normalizeTargetChannel(target_channel);
            if (!normalized.startsWith('@') && !normalized.startsWith('-100'))
                return res.status(400).json({ error: 'Invalid target channel format' });
            try {
                const chat = await bot_instance_1.bot.getChat(normalized);
                const me = await bot_instance_1.bot.getMe();
                const member = await bot_instance_1.bot.getChatMember(chat.id, me.id);
                if (member.status !== 'administrator' && member.status !== 'creator')
                    return res.status(400).json({ error: 'Bot target kanalda admin emas' });
            }
            catch {
                return res.status(400).json({ error: 'Channel verification failed' });
            }
        }
        const updates = {};
        if (language !== undefined)
            updates.language = language;
        if (target_channel !== undefined) {
            updates.target_channel = typeof target_channel === 'string' && !target_channel.trim() ? '' : target_channel;
        }
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
    app.get('/api/output-channels/:userId', auth_1.checkAuth, async (req, res) => {
        const u = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
        if (!u)
            return res.status(404).json({ error: 'Not found' });
        res.json({ primary: u.target_channel, extra: u.extra_channels || '', all: database_1.DBService.getUserOutputChannels(u) });
    });
    app.post('/api/output-channels/:userId', auth_1.checkAuth, async (req, res) => {
        if (!Array.isArray(req.body.channels))
            return res.status(400).json({ error: 'channels array required' });
        await database_1.DBService.setExtraChannels(parseInt(req.authenticatedUserId), req.body.channels);
        res.json({ success: true });
    });
}
